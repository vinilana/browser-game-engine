// Voxel lighting (skylight + block light flood fill) and column meshing.
// Operates on a padded region (column + 16 blocks on each side) so light that
// crosses column borders is exact (light never travels further than 15 blocks).
import { RenderType, Tint, Waving } from './BlockRegistry.js';

export const CHUNK = 32;
export const PAD = 16;
export const PS = CHUNK + PAD * 2; // 64
export const SY = PS * PS;
export const WORLD_HEIGHT = 256;

// Face tables ----------------------------------------------------------------
// corners in order TL, BL, BR, TR (uv (0,0), (0,1), (1,1), (1,0))
const FACE_CORNERS = [
  [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]], // +X
  [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]], // -X
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], // +Y
  [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], // -Y
  [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]], // +Z
  [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]], // -Z
];
const FACE_UV = [[0, 0], [0, 1], [1, 1], [1, 0]];
const FACE_NORMAL = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const idxDelta = (dx, dy, dz) => dx + dz * PS + dy * SY;
const FACE_DELTA = FACE_NORMAL.map(([x, y, z]) => idxDelta(x, y, z));

// Per face, per vertex: index deltas (relative to the voxel in front of the face)
// of side1, side2 and corner neighbours used for AO and smooth lighting.
const AO_DELTAS = FACE_CORNERS.map((corners, f) => {
  const n = FACE_NORMAL[f];
  const axisN = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
  const axes = [0, 1, 2].filter((a) => a !== axisN);
  return corners.map((c) => {
    const d = [0, 0, 0];
    const e = [0, 0, 0];
    d[axes[0]] = c[axes[0]] ? 1 : -1;
    e[axes[1]] = c[axes[1]] ? 1 : -1;
    const s1 = idxDelta(d[0], d[1], d[2]);
    const s2 = idxDelta(e[0], e[1], e[2]);
    return [s1, s2, s1 + s2];
  });
});

// Growable vertex/index storage ------------------------------------------------
class MeshBuilder {
  constructor(cap = 4096) {
    this.cap = cap;
    this.pos = new Int16Array(cap * 4);
    this.d0 = new Uint8Array(cap * 4);
    this.d1 = new Uint8Array(cap * 4);
    this.tint = new Uint8Array(cap * 4);
    this.idx = new Uint32Array(cap * 1.5);
    this.vcount = 0;
    this.icount = 0;
  }

  _grow() {
    const cap = this.cap * 2;
    const g = (A, n) => { const b = new A.constructor(n); b.set(A); return b; };
    this.pos = g(this.pos, cap * 4);
    this.d0 = g(this.d0, cap * 4);
    this.d1 = g(this.d1, cap * 4);
    this.tint = g(this.tint, cap * 4);
    this.idx = g(this.idx, cap * 1.5);
    this.cap = cap;
  }

  vertex(x16, y16, z16, layer, flags, u16, v16, ao, sky, blk, mat, tr, tg, tb) {
    if (this.vcount >= this.cap) this._grow();
    const o = this.vcount * 4;
    this.pos[o] = x16; this.pos[o + 1] = y16; this.pos[o + 2] = z16; this.pos[o + 3] = layer;
    this.d0[o] = flags; this.d0[o + 1] = u16; this.d0[o + 2] = v16; this.d0[o + 3] = ao;
    this.d1[o] = sky; this.d1[o + 1] = blk; this.d1[o + 2] = mat; this.d1[o + 3] = 0;
    this.tint[o] = tr; this.tint[o + 1] = tg; this.tint[o + 2] = tb; this.tint[o + 3] = 255;
    return this.vcount++;
  }

  quad(v0, flip) {
    const i = this.icount;
    const I = this.idx;
    if (!flip) {
      I[i] = v0; I[i + 1] = v0 + 1; I[i + 2] = v0 + 2;
      I[i + 3] = v0; I[i + 4] = v0 + 2; I[i + 5] = v0 + 3;
    } else {
      I[i] = v0 + 1; I[i + 1] = v0 + 2; I[i + 2] = v0 + 3;
      I[i + 3] = v0 + 1; I[i + 4] = v0 + 3; I[i + 5] = v0;
    }
    this.icount += 6;
  }

  result() {
    const v = this.vcount;
    const index = v <= 65535 ? Uint16Array.from(this.idx.subarray(0, this.icount)) : this.idx.slice(0, this.icount);
    return {
      vcount: v,
      icount: this.icount,
      pos: this.pos.slice(0, v * 4),
      d0: this.d0.slice(0, v * 4),
      d1: this.d1.slice(0, v * 4),
      tint: this.tint.slice(0, v * 4),
      idx: index,
    };
  }
}

// Lighting ----------------------------------------------------------------------
/**
 * @param {import('./BlockRegistry.js').BlockRegistry} reg
 * @param {Uint8Array} blocks padded region PS*PS*H
 * @param {number} H region height
 * @returns {{sky: Uint8Array, blk: Uint8Array}}
 */
export function computeLight(reg, blocks, H) {
  const N = SY * H;
  const sky = new Uint8Array(N);
  const blk = new Uint8Array(N);
  const op = reg.lightOpacity;
  const em = reg.emission;
  const qcap = 1 << 21;
  const queue = new Int32Array(qcap);
  const mask = qcap - 1;

  // vertical sunlight
  for (let z = 0; z < PS; z++) {
    for (let x = 0; x < PS; x++) {
      let level = 15;
      for (let y = H - 1; y >= 0; y--) {
        const i = y * SY + z * PS + x;
        const o = op[blocks[i]];
        if (o >= 15) level = 0;
        else if (o > 0) level = Math.max(0, level - o);
        sky[i] = level;
        if (level === 0 && o >= 15) {
          // everything below stays 0 until a transparent gap (caves stay dark)
          for (let yy = y - 1; yy >= 0; yy--) sky[yy * SY + z * PS + x] = 0;
          break;
        }
      }
    }
  }

  const flood = (L, qhead, qtail) => {
    while (qhead !== qtail) {
      const i = queue[qhead];
      qhead = (qhead + 1) & mask;
      const lv = L[i];
      if (lv <= 1) continue;
      const x = i & 63, z = (i >> 6) & 63, y = (i / SY) | 0;
      // 6 neighbours
      for (let f = 0; f < 6; f++) {
        let j;
        if (f === 0) { if (x === PS - 1) continue; j = i + 1; }
        else if (f === 1) { if (x === 0) continue; j = i - 1; }
        else if (f === 2) { if (y === H - 1) continue; j = i + SY; }
        else if (f === 3) { if (y === 0) continue; j = i - SY; }
        else if (f === 4) { if (z === PS - 1) continue; j = i + PS; }
        else { if (z === 0) continue; j = i - PS; }
        const o = op[blocks[j]];
        if (o >= 15) continue;
        const nl = lv - (o > 1 ? o : 1);
        if (nl > L[j]) {
          L[j] = nl;
          queue[qtail] = j;
          qtail = (qtail + 1) & mask;
        }
      }
    }
  };

  // seeds for horizontal skylight spread
  let tail = 0;
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < PS; z++) {
      for (let x = 0; x < PS; x++) {
        const i = y * SY + z * PS + x;
        const lv = sky[i];
        if (lv <= 1) continue;
        const t = lv - 1;
        if ((x > 0 && sky[i - 1] < t && op[blocks[i - 1]] < 15) ||
            (x < PS - 1 && sky[i + 1] < t && op[blocks[i + 1]] < 15) ||
            (z > 0 && sky[i - PS] < t && op[blocks[i - PS]] < 15) ||
            (z < PS - 1 && sky[i + PS] < t && op[blocks[i + PS]] < 15) ||
            (y > 0 && sky[i - SY] < t && op[blocks[i - SY]] < 15)) {
          queue[tail] = i;
          tail = (tail + 1) & mask;
        }
      }
    }
  }
  flood(sky, 0, tail);

  // block light
  tail = 0;
  for (let i = 0; i < N; i++) {
    const e = em[blocks[i]];
    if (e > 0) {
      blk[i] = e;
      queue[tail] = i;
      tail = (tail + 1) & mask;
    }
  }
  flood(blk, 0, tail);
  return { sky, blk };
}

// Meshing -------------------------------------------------------------------------
/**
 * @param {import('./BlockRegistry.js').BlockRegistry} reg
 * @param {Uint8Array} blocks padded region
 * @param {Uint8Array} sky
 * @param {Uint8Array} blk
 * @param {number} H
 * @param {Uint8Array} tints CHUNK*CHUNK*6 (grass rgb, foliage rgb) for the central column
 * @param {{skipDark?: boolean, seed?: number, cx:number, cz:number}} opts
 */
export function meshRegion(reg, blocks, sky, blk, H, tints, opts) {
  const opaqueB = new MeshBuilder(8192);
  const cutoutB = new MeshBuilder(4096);
  const transB = new MeshBuilder(2048);
  const RT = reg.renderType, OPQ = reg.opaque, LIQ = reg.liquid;
  const FL = reg.faceLayer, TINT = reg.tint, WAVE = reg.waving, MAT = reg.matFlags, LVL = reg.liquidLevel;
  const skipDark = !!opts.skipDark;
  const fancyLeaves = opts.fancyLeaves !== false;
  const baseX = opts.cx * CHUNK, baseZ = opts.cz * CHUNK;
  const aoL = [0, 0, 0, 0], skL = [0, 0, 0, 0], blL = [0, 0, 0, 0];

  const lightAt = (j, y) => (y >= H ? 15 : sky[j]);

  for (let y = 0; y < H; y++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const i = y * SY + (lz + PAD) * PS + (lx + PAD);
        const id = blocks[i];
        if (id === 0) continue;
        const rt = RT[id];
        if (rt === RenderType.NONE) continue;
        const ti = (lz * CHUNK + lx) * 6;
        const tintType = TINT[id];
        let tr = 255, tg = 255, tb = 255, tintMode = 0;
        if (tintType === Tint.GRASS || tintType === Tint.MASKED_GRASS) {
          tr = tints[ti]; tg = tints[ti + 1]; tb = tints[ti + 2];
          tintMode = tintType === Tint.MASKED_GRASS ? 2 : 1;
        } else if (tintType === Tint.FOLIAGE) {
          tr = tints[ti + 3]; tg = tints[ti + 4]; tb = tints[ti + 5]; tintMode = 1;
        }
        const wave = WAVE[id];
        const mat = MAT[id];

        if (rt === RenderType.CROSS) {
          emitCross(cutoutB, lx, y, lz, id, i, FL[id * 6 + 2], wave, tintMode, mat, tr, tg, tb, baseX, baseZ, sky, blk);
          continue;
        }
        if (rt === RenderType.TORCH) {
          emitTorch(opaqueB, lx, y, lz, FL[id * 6 + 2], i, sky, blk, mat);
          continue;
        }

        if (rt === RenderType.CUTOUT && fancyLeaves) {
          // leaves with an exposed face get extra crossed quads that break the cube silhouette
          let exposed = false;
          for (let f = 0; f < 6 && !exposed; f++) {
            if (f === 3 && y === 0) continue;
            const n = (f === 2 && y === H - 1) ? 0 : blocks[i + FACE_DELTA[f]];
            if (!OPQ[n] && RT[n] !== RenderType.CUTOUT) exposed = true;
          }
          if (exposed) emitLeafTufts(cutoutB, lx, y, lz, FL[id * 6 + 2], wave, tintMode, mat, tr, tg, tb, baseX, baseZ, sky[i], blk[i]);
        }
        const isLiquid = rt === RenderType.LIQUID;
        const builder = rt === RenderType.CUTOUT ? cutoutB : (isLiquid || rt === RenderType.GLASS) ? transB : opaqueB;
        const aboveLiquid = y + 1 < H && LIQ[blocks[i + SY]];
        const liquidTop = isLiquid && !aboveLiquid;
        // surface height (1/16 units) from the fluid level
        const lvl = LVL[id];
        const topH = !liquidTop ? 16 : lvl >= 8 ? 14 : Math.max(2, Math.round(lvl * 1.75));

        for (let f = 0; f < 6; f++) {
          if (f === 3 && y === 0) continue;
          let n = 0;
          if (!(f === 2 && y === H - 1)) n = blocks[i + FACE_DELTA[f]];
          const nrt = RT[n];
          let visible;
          if (rt === RenderType.OPAQUE || rt === RenderType.CACTUS) {
            visible = !OPQ[n];
            if (rt === RenderType.CACTUS && f !== 2 && f !== 3) visible = !OPQ[n] || true;
          } else if (rt === RenderType.CUTOUT) {
            visible = !OPQ[n] && nrt !== RenderType.CUTOUT;
          } else if (rt === RenderType.GLASS) {
            visible = !OPQ[n] && n !== id;
          } else if (isLiquid) {
            visible = !OPQ[n] && !LIQ[n];
            if (f === 2 && liquidTop && !OPQ[n]) visible = true;
            // step between fluid levels: show the side of the higher column
            if (!visible && LIQ[n] && f !== 2 && f !== 3 && liquidTop) {
              const nAbove = blocks[i + FACE_DELTA[f] + SY];
              const nTop = LIQ[nAbove] ? 16 : LVL[n] >= 8 ? 14 : Math.max(2, Math.round(LVL[n] * 1.75));
              visible = nTop < topH;
            }
          } else {
            visible = !OPQ[n];
          }
          if (!visible) continue;

          const front = i + FACE_DELTA[f];
          const fy = y + FACE_NORMAL[f][1];
          const frontSky = fy >= H ? 15 : sky[front];
          const frontBlk = fy >= H ? 0 : blk[front];
          if (skipDark && frontSky === 0 && frontBlk === 0 && !isLiquid) continue;

          // AO + smooth light
          const deltas = AO_DELTAS[f];
          const smooth = !isLiquid;
          for (let v = 0; v < 4; v++) {
            if (!smooth || fy >= H || fy < 0) {
              aoL[v] = 3; skL[v] = frontSky; blL[v] = frontBlk;
              continue;
            }
            const d = deltas[v];
            const j1 = front + d[0], j2 = front + d[1], j3 = front + d[2];
            const o1 = OPQ[blocks[j1]], o2 = OPQ[blocks[j2]], o3 = OPQ[blocks[j3]];
            aoL[v] = o1 && o2 ? 0 : 3 - (o1 + o2 + o3);
            let s = frontSky, b = frontBlk, c = 1;
            if (!o1) { s += sky[j1]; b += blk[j1]; c++; }
            if (!o2) { s += sky[j2]; b += blk[j2]; c++; }
            if (!o3 && !(o1 && o2)) { s += sky[j3]; b += blk[j3]; c++; }
            skL[v] = s / c; blL[v] = b / c;
          }

          let fmat = mat;
          if (LIQ[n] && !isLiquid) fmat |= 4; // underwater surface
          if (isLiquid) fmat |= 32;
          const layer = FL[id * 6 + f];
          const corners = FACE_CORNERS[f];
          const flags = f | (wave << 3) | (tintMode << 5);
          const v0 = builder.vcount;
          for (let v = 0; v < 4; v++) {
            const c = corners[v];
            let px = (lx + c[0]) * 16, py = (y + c[1]) * 16, pz = (lz + c[2]) * 16;
            if (rt === RenderType.CACTUS) {
              if (f === 0) px -= 1; else if (f === 1) px += 1; else if (f === 4) pz -= 1; else if (f === 5) pz += 1;
            }
            if (liquidTop && c[1] === 1) py = y * 16 + topH;
            builder.vertex(px, py, pz, layer, flags, FACE_UV[v][0] * 16, FACE_UV[v][1] * 16, aoL[v],
              Math.round(skL[v] * 17), Math.round(blL[v] * 17), fmat, tr, tg, tb);
          }
          const a02 = aoL[0] + aoL[2] + (skL[0] + skL[2]) * 0.1;
          const a13 = aoL[1] + aoL[3] + (skL[1] + skL[3]) * 0.1;
          builder.quad(v0, a02 < a13);

          // (see fancy leaves below)
          // water surfaces are also visible from below
          if (isLiquid && f === 2) {
            const u0 = builder.vcount;
            for (let v = 3; v >= 0; v--) {
              const c = corners[v];
              builder.vertex((lx + c[0]) * 16, y * 16 + (c[1] ? topH : 0), (lz + c[2]) * 16, layer,
                3 | (tintMode << 5), FACE_UV[v][0] * 16, FACE_UV[v][1] * 16, 3,
                Math.round(frontSky * 17), Math.round(frontBlk * 17), fmat | 64, tr, tg, tb);
            }
            builder.quad(u0, false);
          }
        }
      }
    }
  }

  return { opaque: opaqueB.result(), cutout: cutoutB.result(), translucent: transB.result() };
}

function hash(x, z, s) {
  let h = (x * 374761393 + z * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function emitCross(b, lx, y, lz, id, i, layer, wave, tintMode, mat, tr, tg, tb, baseX, baseZ, sky, blk) {
  const wx = baseX + lx, wz = baseZ + lz;
  const ox = Math.round((hash(wx, wz, 1) - 0.5) * 5);
  const oz = Math.round((hash(wx, wz, 2) - 0.5) * 5);
  const hs = 16 + Math.round((hash(wx, wz, 3) - 0.5) * 3);
  const s = Math.round(sky[i] * 17), bl = Math.round(blk[i] * 17);
  const x0 = lx * 16 + ox, z0 = lz * 16 + oz, y0 = y * 16;
  const flags = 2 | (wave << 3) | (tintMode << 5);
  const planes = [[2, 2, 14, 14], [2, 14, 14, 2]];
  for (const [ax, az, bx, bz] of planes) {
    const v0 = b.vcount;
    b.vertex(x0 + ax, y0 + hs, z0 + az, layer, flags, 0, 0, 3, s, bl, mat, tr, tg, tb);
    b.vertex(x0 + ax, y0, z0 + az, layer, flags, 0, 16, 1, s, bl, mat, tr, tg, tb);
    b.vertex(x0 + bx, y0, z0 + bz, layer, flags, 16, 16, 1, s, bl, mat, tr, tg, tb);
    b.vertex(x0 + bx, y0 + hs, z0 + bz, layer, flags, 16, 0, 3, s, bl, mat, tr, tg, tb);
    b.quad(v0, false);
  }
}

function emitLeafTufts(b, lx, y, lz, layer, wave, tintMode, mat, tr, tg, tb, baseX, baseZ, skyL, blkL) {
  const wx = baseX + lx, wz = baseZ + lz;
  const s = Math.round(skyL * 17), bl = Math.round(blkL * 17);
  const cx = lx * 16 + 8 + Math.round((hash(wx, wz + y * 131, 11) - 0.5) * 5);
  const cy = y * 16 + 8 + Math.round((hash(wx + y * 17, wz, 12) - 0.5) * 5);
  const cz = lz * 16 + 8 + Math.round((hash(wx, wz - y * 7, 13) - 0.5) * 5);
  const flags = 2 | (wave << 3) | (tintMode << 5);
  const fmat = mat | 2;
  const theta0 = hash(wx * 3 + y, wz * 5, 14) * Math.PI;
  const half = 10 + Math.round(hash(wx, wz, y + 15) * 3); // ~0.62..0.81 blocks
  for (let q = 0; q < 2; q++) {
    const th = theta0 + q * Math.PI / 2;
    const tilt = (hash(wx + q, wz + y, 16) - 0.5) * 0.9;
    const rx = Math.cos(th), rz = Math.sin(th);
    // up vector tilted around the right axis
    const ux = -rz * Math.sin(tilt), uy = Math.cos(tilt), uz = rx * Math.sin(tilt);
    const v0 = b.vcount;
    const P = (sr, su) => [Math.round(cx + (rx * sr + ux * su) * half), Math.round(cy + uy * su * half), Math.round(cz + (rz * sr + uz * su) * half)];
    const c0 = P(-1, 1), c1 = P(-1, -1), c2 = P(1, -1), c3 = P(1, 1);
    b.vertex(c0[0], c0[1], c0[2], layer, flags, 0, 0, 3, s, bl, fmat, tr, tg, tb);
    b.vertex(c1[0], c1[1], c1[2], layer, flags, 0, 16, 2, s, bl, fmat, tr, tg, tb);
    b.vertex(c2[0], c2[1], c2[2], layer, flags, 16, 16, 2, s, bl, fmat, tr, tg, tb);
    b.vertex(c3[0], c3[1], c3[2], layer, flags, 16, 0, 3, s, bl, fmat, tr, tg, tb);
    b.quad(v0, false);
  }
}

// Torch: 2x10 (in 1/16 units) stick centred in the block.
const TORCH_BOX = { x0: 7, x1: 9, y0: 0, y1: 10, z0: 7, z1: 9 };
function emitTorch(b, lx, y, lz, layer, i, sky, blk, mat) {
  const s = Math.round(sky[i] * 17), bl = Math.round(blk[i] * 17);
  const X = lx * 16, Y = y * 16, Z = lz * 16;
  const { x0, x1, y0, y1, z0, z1 } = TORCH_BOX;
  for (let f = 0; f < 6; f++) {
    if (f === 3) continue;
    const corners = FACE_CORNERS[f];
    const v0 = b.vcount;
    for (let v = 0; v < 4; v++) {
      const c = corners[v];
      const px = X + (c[0] ? x1 : x0), py = Y + (c[1] ? y1 : y0), pz = Z + (c[2] ? z1 : z0);
      let u, vv;
      if (f === 2) { u = FACE_UV[v][0] ? 9 : 7; vv = FACE_UV[v][1] ? 8 : 6; }
      else { u = FACE_UV[v][0] ? 9 : 7; vv = FACE_UV[v][1] ? 16 : 6; }
      b.vertex(px, py, pz, layer, f, u, vv, 3, s, bl, mat, 255, 255, 255);
    }
    b.quad(v0, false);
  }
}
