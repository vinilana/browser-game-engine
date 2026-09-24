// Terrain generator for VoxelCraft: continents, erosion-driven mountains with
// 3D overhangs, rivers, biomes (ocean, beach, plains, forest, birch forest,
// taiga, snowy tundra, desert, mountains), caves, ores and vegetation.
import { Simplex, smoothstep, clamp, lerp } from '../engine/math/noise.js';
import { hash2i, hash3i, mulberry32 } from '../engine/math/rng.js';
import { CHUNK } from '../engine/voxel/Mesher.js';
import { B } from './blocks.js';

export const WORLD_H = 256;
export const SEA = 62;
const H = WORLD_H;
const LAYER = CHUNK * CHUNK;

export const Biome = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH_FOREST: 4, TAIGA: 5, SNOWY: 6, DESERT: 7, MOUNTAINS: 8, RIVER: 9, FROZEN_OCEAN: 10,
};

function spline(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      const s = t * t * (3 - 2 * t);
      return lerp(pts[i - 1][1], pts[i][1], s);
    }
  }
  return pts[pts.length - 1][1];
}

const CONT_SPLINE = [
  [-0.7, -34], [-0.4, -22], [-0.24, -10], [-0.14, -2.5], [-0.08, 1.5], [0.0, 4], [0.15, 8], [0.35, 16], [0.7, 30],
];

export function createGenerator(seed) { return new WorldGenerator(seed); }

export class WorldGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    const s = (k) => new Simplex((this.seed * 31 + k * 977) | 0);
    this.nCont = s(1); this.nEro = s(2); this.nPeaks = s(3); this.nTemp = s(4); this.nHum = s(5);
    this.nRiver = s(6); this.nDetail = s(7); this.nWarp = s(8); this.n3d = s(9); this.nCaveA = s(10);
    this.nCaveB = s(11); this.nCheese = s(12); this.nPatch = s(13); this.nFlower = s(14); this.nSurf = s(15);
    this._s = { h: 0, m: 0, o: 0, T: 0, Hm: 0, river: 0, cont: 0, biome: 0 };
  }

  /** Climate + surface height at a world column. Result object is reused. */
  sample(x, z, out = this._s) {
    const wx = x + this.nWarp.fbm2(x * 0.0021, z * 0.0021, 3) * 55;
    const wz = z + this.nWarp.fbm2(x * 0.0021 + 71.3, z * 0.0021 - 12.7, 3) * 55;
    const C = this.nCont.fbm2(wx * 0.00065, wz * 0.00065, 4) * 1.25 + 0.08;
    const E = this.nEro.fbm2(wx * 0.0010 + 20, wz * 0.0010, 3) * 1.3;
    const PV = this.nPeaks.ridged2(wx * 0.0032, wz * 0.0032, 5);
    const T = this.nTemp.fbm2(x * 0.00085, z * 0.00085, 3) * 1.4;
    const Hm = this.nHum.fbm2(x * 0.0011 + 100, z * 0.0011, 3) * 1.4;
    const det = this.nDetail.fbm2(x * 0.011, z * 0.011, 4);
    const det2 = this.nDetail.fbm2(x * 0.045 + 7, z * 0.045, 2);

    let h = SEA + spline(C, CONT_SPLINE);
    const land = smoothstep(-0.16, 0.05, C);
    const m = smoothstep(0.02, -0.42, E) * smoothstep(-0.1, 0.18, C);
    h += m * (Math.pow(PV, 1.7) * 112 + 8);
    const hillAmp = 5 + 11 * (1 - smoothstep(-0.25, 0.45, E));
    h += det * hillAmp * lerp(0.35, 1, land) + det2 * 1.2;

    // rivers
    const r = Math.abs(this.nRiver.fbm2(wx * 0.00115, wz * 0.00115, 3));
    const riverMask = smoothstep(0.042, 0.012, r) * smoothstep(-0.22, -0.06, C) * (1 - smoothstep(0.25, 0.55, m));
    const valley = smoothstep(0.11, 0.02, r) * smoothstep(-0.22, -0.06, C) * (1 - smoothstep(0.25, 0.55, m));
    if (valley > 0) h = Math.min(h, lerp(h, SEA + 1.5 + Math.max(0, h - SEA) * 0.25, valley));
    if (riverMask > 0) h = Math.min(h, lerp(h, SEA - 3.2, riverMask));

    const Tadj = T - Math.max(0, h - 95) * 0.0065;
    let biome;
    if (riverMask > 0.55) biome = Tadj < -0.5 ? Biome.FROZEN_OCEAN : Biome.RIVER;
    else if (h < SEA - 3) biome = Tadj < -0.5 ? Biome.FROZEN_OCEAN : Biome.OCEAN;
    else if (h <= SEA + 2.2 && C < -0.02 && m < 0.2) biome = Biome.BEACH;
    else if (m > 0.6 && h > 115) biome = Biome.MOUNTAINS;
    else if (Tadj > 0.38 && Hm < 0.05) biome = Biome.DESERT;
    else if (Tadj < -0.42) biome = Biome.SNOWY;
    else if (Tadj < -0.15) biome = Biome.TAIGA;
    else if (Hm > 0.28) biome = Tadj < 0.12 ? Biome.BIRCH_FOREST : Biome.FOREST;
    else if (Hm > 0.02) biome = Biome.FOREST;
    else biome = Biome.PLAINS;

    out.h = h; out.m = m; out.o = smoothstep(0.32, 0.72, m); out.T = Tadj; out.Hm = Hm;
    out.river = riverMask; out.cont = C; out.biome = biome;
    return out;
  }

  /** Low-detail sample for the distant heightfield LOD (height + average color). */
  farSample(x, z, out) {
    const s = this.sample(x, z, this._fs || (this._fs = {}));
    const hx = this.sample(x + 3, z, this._fs2 || (this._fs2 = {})).h;
    const hz = this.sample(x, z + 3, this._fs3 || (this._fs3 = {})).h;
    s.slope = Math.max(Math.abs(hx - s.h), Math.abs(hz - s.h)) / 3;
    const h = s.h;
    const g = this.grassTint(s.T, s.Hm);
    if (h < SEA) {
      const depth = Math.min(1, (SEA - h) / 18);
      out.h = SEA + 0.88;
      out.water = 1;
      out.r = 28 - depth * 14; out.g = 62 - depth * 30; out.b = 66 - depth * 24;
      if (s.T < -0.72) { out.r = 214; out.g = 220; out.b = 228; out.water = 0; }
      return out;
    }
    const n = this.nSurf.noise2(x * 0.06, z * 0.06);
    const surf = this._surfaceBlock(s, Math.floor(h), false, n, x, z);
    let c;
    if (surf === B.grass_block) c = [g[0] * 0.72, g[1] * 0.72, g[2] * 0.72];
    else if (surf === B.sand) c = [212, 196, 150];
    else if (surf === B.snow_block || surf === B.snowy_grass) c = [228, 232, 240];
    else if (surf === B.stone) c = [118, 117, 114];
    else if (surf === B.gravel) c = [120, 116, 111];
    else if (surf === B.podzol || surf === B.coarse_dirt || surf === B.dirt) c = [96, 72, 50];
    else c = [g[0] * 0.7, g[1] * 0.7, g[2] * 0.7];
    // forest canopy: raise and darken
    let cover = 0, canopy = c;
    switch (s.biome) {
      case Biome.FOREST: cover = 0.75; canopy = [g[0] * 0.8 * 0.55, g[1] * 0.88 * 0.55, g[2] * 0.74 * 0.55]; break;
      case Biome.BIRCH_FOREST: cover = 0.7; canopy = [88, 108, 52]; break;
      case Biome.TAIGA: cover = 0.7; canopy = [42, 66, 48]; break;
      case Biome.SNOWY: cover = 0.12; canopy = [60, 80, 66]; break;
      case Biome.PLAINS: cover = 0.05; canopy = [60, 85, 35]; break;
      case Biome.MOUNTAINS: cover = s.T < -0.3 ? 0 : 0.15; canopy = [42, 66, 48]; break;
      default: cover = 0;
    }
    if (s.o > 0.001 || s.slope > 1.5) cover *= 0.2;
    const patch = this.nPatch.noise2(x * 0.02, z * 0.02) * 0.5 + 0.5;
    cover *= 0.6 + patch * 0.6;
    cover = Math.min(1, cover);
    out.h = h + 0.6 + cover * 5.5;
    out.water = 0;
    out.r = c[0] + (canopy[0] - c[0]) * cover;
    out.g = c[1] + (canopy[1] - c[1]) * cover;
    out.b = c[2] + (canopy[2] - c[2]) * cover;
    return out;
  }

  grassTint(T, Hm) {
    const t = clamp((T + 0.7) / 1.4, 0, 1);
    const w = clamp((Hm + 0.6) / 1.2, 0, 1);
    const coldDry = [118, 136, 100], coldWet = [88, 122, 76];
    const warmDry = [160, 156, 80], warmWet = [92, 146, 50];
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const a = lerp(coldDry[k], coldWet[k], w);
      const b = lerp(warmDry[k], warmWet[k], w);
      out[k] = lerp(a, b, t);
    }
    return out;
  }

  generate(cx, cz) {
    const blocks = new Uint8Array(LAYER * H);
    const tints = new Uint8Array(LAYER * 6);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const S = CHUNK + 2;
    // heights with 1-block margin for slopes
    const hs = new Float32Array(S * S);
    const infos = new Array(LAYER);
    for (let z = -1; z <= CHUNK; z++) {
      for (let x = -1; x <= CHUNK; x++) {
        const inside = x >= 0 && z >= 0 && x < CHUNK && z < CHUNK;
        const s = this.sample(x0 + x, z0 + z, inside ? {} : this._s);
        hs[(z + 1) * S + (x + 1)] = s.h;
        if (inside) infos[z * CHUNK + x] = s;
      }
    }
    const idx = (x, y, z) => (y * CHUNK + z) * CHUNK + x;
    const topY = new Int16Array(LAYER).fill(-1);

    // --- base terrain -----------------------------------------------------
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const s = infos[z * CHUNK + x];
        const wx = x0 + x, wz = z0 + z;
        const h = s.h;
        const hi = Math.floor(h);
        const slope = Math.max(
          Math.abs(hs[(z + 1) * S + x + 2] - hs[(z + 1) * S + x]),
          Math.abs(hs[(z + 2) * S + x + 1] - hs[z * S + x + 1]),
        ) * 0.5;
        s.slope = slope;
        // tint
        const g = this.grassTint(s.T, s.Hm);
        const ti = (z * CHUNK + x) * 6;
        tints[ti] = g[0]; tints[ti + 1] = g[1]; tints[ti + 2] = g[2];
        tints[ti + 3] = g[0] * 0.8; tints[ti + 4] = g[1] * 0.88; tints[ti + 5] = g[2] * 0.74;

        const o = s.o;
        const yTop = Math.min(H - 2, o > 0 ? hi + 26 : hi);
        for (let y = 0; y <= yTop; y++) {
          let solid;
          if (o > 0 && Math.abs(y - h) < 26) {
            const n = this.n3d.fbm3(wx * 0.026, y * 0.034, wz * 0.026, 2);
            solid = (h - y) + o * 11 * n > 0;
          } else {
            solid = y <= hi;
          }
          if (solid) blocks[idx(x, y, z)] = B.stone;
        }
        // bedrock
        blocks[idx(x, 0, z)] = B.bedrock;
        const r = hash2i(wx, wz, this.seed + 5);
        for (let y = 1; y <= 3; y++) if (((r >>> (y * 3)) & 7) < 4 - y) blocks[idx(x, y, z)] = B.bedrock;
      }
    }

    // --- caves ---------------------------------------------------------------
    this._carveCaves(blocks, infos, x0, z0);

    // --- surface materials + water -----------------------------------------------
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const s = infos[z * CHUNK + x];
        const wx = x0 + x, wz = z0 + z;
        const biome = s.biome;
        const cold = s.T < -0.72;
        const surfNoise = this.nSurf.noise2(wx * 0.06, wz * 0.06);
        const depthDirt = 3 + Math.floor((surfNoise + 1) * 1.5);
        let depth = -1; // -1: in air above
        let top = -1;
        for (let y = H - 1; y >= 1; y--) {
          const i = idx(x, y, z);
          const b = blocks[i];
          if (b === 0) {
            depth = -1;
            // only open water bodies (nothing solid above) are flooded; caves stay dry
            if (y <= SEA && top < 0) blocks[i] = cold && y === SEA ? B.ice : B.water;
            continue;
          }
          if (b !== B.stone) { if (b === B.water || b === B.ice) depth = -1; continue; }
          depth++;
          if (top < 0) top = y;
          const under = y < SEA;
          const aboveIsWater = blocks[i + LAYER] === B.water || blocks[i + LAYER] === B.ice;
          if (depth === 0) {
            blocks[i] = this._surfaceBlock(s, y, under || aboveIsWater, surfNoise, wx, wz);
          } else if (depth < depthDirt) {
            blocks[i] = this._subsurfaceBlock(s, y, under, depth);
          }
          if (depth > 8 && y < top - 12) {
            // speed: everything below is stone already
          }
        }
        topY[z * CHUNK + x] = top;
      }
    }

    // --- ores & stone variants ------------------------------------------------------
    this._placeOres(blocks, cx, cz, infos);

    // --- vegetation ---------------------------------------------------------------------
    this._placeVegetation(blocks, infos, topY, x0, z0, cx, cz);
    this._placeTrees(blocks, x0, z0);

    return { blocks, tints };
  }

  _surfaceBlock(s, y, underwater, n, wx, wz) {
    const b = s.biome;
    if (underwater) {
      if (b === Biome.RIVER || b === Biome.FROZEN_OCEAN) return n > 0.35 ? B.clay : n > -0.2 ? B.sand : B.gravel;
      if (b === Biome.OCEAN) return y < SEA - 12 ? (n > 0.2 ? B.gravel : B.sand) : (n > 0.55 ? B.clay : B.sand);
      if (b === Biome.DESERT || b === Biome.BEACH) return B.sand;
      return y >= SEA - 2 ? B.sand : (n > 0.3 ? B.gravel : B.dirt);
    }
    if (y > 182 + n * 6) return B.snow_block;
    if (b === Biome.MOUNTAINS || (s.m > 0.45 && s.slope > 1.25)) {
      if (y > 158 + n * 8) return B.snow_block;
      if (s.slope > 1.2 || n > 0.45) return n > 0.7 ? B.gravel : B.stone;
      return s.T < -0.3 ? B.snowy_grass : B.grass_block;
    }
    if (s.slope > 2.2 && s.m > 0.2) return B.stone;
    switch (b) {
      case Biome.BEACH: return s.T < -0.4 ? B.gravel : B.sand;
      case Biome.DESERT: return B.sand;
      case Biome.SNOWY: return B.snowy_grass;
      case Biome.TAIGA: return n > 0.45 ? B.podzol : n < -0.55 ? B.coarse_dirt : B.grass_block;
      case Biome.RIVER: return B.sand;
      default: return B.grass_block;
    }
  }

  _subsurfaceBlock(s, y, underwater, depth) {
    const b = s.biome;
    if (b === Biome.DESERT) return depth < 3 ? B.sand : B.sandstone;
    if (b === Biome.BEACH || (underwater && (b === Biome.OCEAN || b === Biome.RIVER))) return depth < 3 ? B.sand : B.sandstone;
    if (b === Biome.MOUNTAINS && s.slope > 1.2) return B.stone;
    return B.dirt;
  }

  _carveCaves(blocks, infos, x0, z0) {
    const G = 4;
    const NX = CHUNK / G + 1;
    let maxTop = 0;
    for (const s of infos) maxTop = Math.max(maxTop, Math.floor(s.h) + (s.o > 0 ? 20 : 0));
    const yMax = Math.min(H - 8, maxTop + 2);
    const NY = Math.floor(yMax / G) + 2;
    const A = new Float32Array(NX * NX * NY);
    const Bn = new Float32Array(NX * NX * NY);
    const Cn = new Float32Array(NX * NX * NY);
    for (let gy = 0; gy < NY; gy++) {
      for (let gz = 0; gz < NX; gz++) {
        for (let gx = 0; gx < NX; gx++) {
          const wx = x0 + gx * G, wy = gy * G, wz = z0 + gz * G;
          const k = (gy * NX + gz) * NX + gx;
          A[k] = this.nCaveA.noise3(wx * 0.017, wy * 0.026, wz * 0.017);
          Bn[k] = this.nCaveB.noise3(wx * 0.017 + 40, wy * 0.026, wz * 0.017 - 13);
          Cn[k] = this.nCheese.noise3(wx * 0.011, wy * 0.02, wz * 0.011);
        }
      }
    }
    const tri = (arr, x, y, z) => {
      const fx = x / G, fy = y / G, fz = z / G;
      const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const k = (iy * NX + iz) * NX + ix;
      const k1 = k + NX * NX;
      const a = lerp(lerp(arr[k], arr[k + 1], tx), lerp(arr[k + NX], arr[k + NX + 1], tx), tz);
      const b = lerp(lerp(arr[k1], arr[k1 + 1], tx), lerp(arr[k1 + NX], arr[k1 + NX + 1], tx), tz);
      return lerp(a, b, ty);
    };
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const s = infos[z * CHUNK + x];
        const h = Math.floor(s.h);
        const dryLand = s.h > SEA + 3 && s.river < 0.1;
        const limit = dryLand ? Math.min(yMax, h + (s.o > 0 ? 20 : 0)) : Math.min(yMax, h - 6);
        for (let y = 4; y <= limit; y++) {
          const i = (y * CHUNK + z) * CHUNK + x;
          if (blocks[i] !== B.stone) continue;
          const a = tri(A, x, y, z), b = tri(Bn, x, y, z);
          const depthBelow = h - y;
          const thick = 0.0105 + (depthBelow > 12 ? 0.006 : 0) + (y < 30 ? 0.004 : 0);
          let cave = a * a + b * b < thick;
          if (!cave && y < 56 && depthBelow > 14) {
            const c = tri(Cn, x, y, z);
            cave = c > 0.58 - Math.max(0, (40 - y)) * 0.004;
          }
          if (!cave) continue;
          // keep a crust under water bodies and at the very surface of most places
          if (!dryLand && depthBelow < 7) continue;
          if (depthBelow < 1 && (hash2i(x0 + x, z0 + z, this.seed) & 3) !== 0) continue;
          blocks[i] = y <= 10 ? B.lava : 0;
        }
      }
    }
  }

  _placeOres(blocks, cx, cz, infos) {
    const rnd = mulberry32(hash2i(cx, cz, this.seed + 99));
    const setIfStone = (x, y, z, id) => {
      if (x < 0 || z < 0 || x >= CHUNK || z >= CHUNK || y < 1 || y >= H) return;
      const i = (y * CHUNK + z) * CHUNK + x;
      if (blocks[i] === B.stone) blocks[i] = id;
    };
    const vein = (id, count, size, yMin, yMax) => {
      for (let v = 0; v < count; v++) {
        let x = rnd() * CHUNK, y = yMin + rnd() * (yMax - yMin), z = rnd() * CHUNK;
        const n = size * (0.6 + rnd() * 0.8);
        let dx = rnd() - 0.5, dy = (rnd() - 0.5) * 0.5, dz = rnd() - 0.5;
        for (let k = 0; k < n; k++) {
          setIfStone(Math.floor(x), Math.floor(y), Math.floor(z), id);
          if (rnd() < 0.5) setIfStone(Math.floor(x + rnd() * 2 - 1), Math.floor(y + rnd() * 2 - 1), Math.floor(z + rnd() * 2 - 1), id);
          x += dx + (rnd() - 0.5) * 0.8; y += dy + (rnd() - 0.5) * 0.6; z += dz + (rnd() - 0.5) * 0.8;
        }
      }
    };
    const blob = (id, count, radius, yMin, yMax) => {
      for (let v = 0; v < count; v++) {
        const bx = rnd() * CHUNK, by = yMin + rnd() * (yMax - yMin), bz = rnd() * CHUNK;
        const r = radius * (0.6 + rnd() * 0.6);
        for (let y = Math.floor(by - r); y <= by + r; y++) {
          for (let z = Math.floor(bz - r); z <= bz + r; z++) {
            for (let x = Math.floor(bx - r); x <= bx + r; x++) {
              const d = ((x - bx) ** 2 + (y - by) ** 2 * 1.4 + (z - bz) ** 2) / (r * r);
              if (d < 1 - rnd() * 0.25) setIfStone(x, y, z, id);
            }
          }
        }
      }
    };
    blob(B.granite, 2, 5, 5, 90);
    blob(B.diorite, 2, 4.5, 5, 90);
    blob(B.andesite, 2, 5, 5, 90);
    blob(B.gravel, 1, 3.5, 5, 70);
    blob(B.dirt, 1, 3.5, 20, 80);
    vein(B.coal_ore, 22, 12, 6, 128);
    vein(B.iron_ore, 14, 7, 4, 72);
    vein(B.gold_ore, 3, 6, 4, 32);
    vein(B.diamond_ore, 2, 5, 3, 16);
    let m = 0;
    for (const s of infos) m = Math.max(m, s.m);
    if (m > 0.5) vein(B.emerald_ore, 2, 2, 5, 90);
  }

  _placeVegetation(blocks, infos, topY, x0, z0, cx, cz) {
    const rnd = mulberry32(hash2i(cx, cz, this.seed + 1234));
    const at = (x, y, z) => (y * CHUNK + z) * CHUNK + x;
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const s = infos[z * CHUNK + x];
        const top = topY[z * CHUNK + x];
        if (top < 1 || top >= H - 4) continue;
        const i = at(x, top, z);
        const ground = blocks[i];
        const above = at(x, top + 1, z);
        if (blocks[above] !== 0) continue;
        const wx = x0 + x, wz = z0 + z;
        const r = rnd();
        if (ground === B.grass_block || ground === B.podzol) {
          const flowerPatch = this.nFlower.noise2(wx * 0.035, wz * 0.035);
          const b = s.biome;
          let pGrass = b === Biome.PLAINS ? 0.42 : b === Biome.FOREST || b === Biome.BIRCH_FOREST ? 0.28 : b === Biome.TAIGA ? 0.22 : 0.2;
          if (b === Biome.MOUNTAINS) pGrass = 0.12;
          if (flowerPatch > 0.5 && r < 0.14 && b !== Biome.TAIGA) {
            const f = hash2i(Math.floor(wx / 12), Math.floor(wz / 12), this.seed + 7) % 4;
            blocks[above] = [B.dandelion, B.poppy, B.cornflower, B.allium][f];
          } else if (r < pGrass) {
            blocks[above] = (b === Biome.TAIGA || (b === Biome.FOREST && rnd() < 0.15)) && rnd() < 0.5 ? B.fern : B.tall_grass;
          } else if (r > 0.9996 && b !== Biome.TAIGA) {
            blocks[above] = B.pumpkin;
          }
          // sugar cane next to water
          if (top === SEA && r > 0.6 && r < 0.75) this._maybeCane(blocks, x, top, z, rnd);
        } else if (ground === B.sand) {
          if (s.biome === Biome.DESERT) {
            if (r < 0.006 && x > 0 && z > 0 && x < CHUNK - 1 && z < CHUNK - 1) {
              const hgt = 1 + Math.floor(rnd() * 3);
              let ok = true;
              for (let k = 1; k <= hgt && ok; k++) {
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (blocks[at(x + dx, top + k, z + dz)] !== 0) ok = false;
              }
              if (ok) for (let k = 1; k <= hgt; k++) blocks[at(x, top + k, z)] = B.cactus;
            } else if (r > 0.99) {
              blocks[above] = B.dead_bush;
            }
          } else if (top === SEA && r < 0.12) {
            this._maybeCane(blocks, x, top, z, rnd);
          }
        } else if (ground === B.snowy_grass && r < 0.05) {
          blocks[above] = B.fern;
        }
      }
    }
  }

  _maybeCane(blocks, x, top, z, rnd) {
    const at = (xx, y, zz) => (y * CHUNK + zz) * CHUNK + xx;
    if (x <= 0 || z <= 0 || x >= CHUNK - 1 || z >= CHUNK - 1) return;
    let water = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (blocks[at(x + dx, top, z + dz)] === B.water) water = true;
    if (!water) return;
    const h = 1 + Math.floor(rnd() * 3);
    for (let k = 1; k <= h; k++) blocks[at(x, top + k, z)] = B.sugar_cane;
  }

  _placeTrees(blocks, x0, z0) {
    const M = 5;
    const CELL = 5;
    const minX = x0 - M, maxX = x0 + CHUNK + M, minZ = z0 - M, maxZ = z0 + CHUNK + M;
    const at = (x, y, z) => (y * CHUNK + z) * CHUNK + x;
    const reg = this;
    const set = (wx, y, wz, id, force) => {
      const x = wx - x0, z = wz - z0;
      if (x < 0 || z < 0 || x >= CHUNK || z >= CHUNK || y < 1 || y >= H) return;
      const i = at(x, y, z);
      const cur = blocks[i];
      if (force) { if (cur === 0 || cur === B.tall_grass || cur === B.fern || cur === B.dirt || cur === B.grass_block || cur === B.snowy_grass || cur === B.podzol || cur === B.oak_leaves || cur === B.birch_leaves || cur === B.spruce_leaves || cur === B.dandelion || cur === B.poppy || cur === B.cornflower || cur === B.allium) blocks[i] = id; }
      else if (cur === 0 || cur === B.tall_grass || cur === B.fern || cur === B.dandelion || cur === B.poppy || cur === B.cornflower || cur === B.allium) blocks[i] = id;
    };
    const s = {};
    for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) {
      for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++) {
        const h = hash2i(gx, gz, this.seed + 4242);
        const tx = gx * CELL + (h & 7) % CELL;
        const tz = gz * CELL + ((h >>> 3) & 7) % CELL;
        if (tx < minX || tx >= maxX || tz < minZ || tz >= maxZ) continue;
        this.sample(tx, tz, s);
        if (s.o > 0.001 || s.river > 0.2) continue;
        let p;
        let type;
        const r2 = ((h >>> 8) & 1023) / 1023;
        switch (s.biome) {
          case Biome.FOREST: p = 0.62; type = r2 < 0.18 ? 'birch' : r2 < 0.3 ? 'bigoak' : 'oak'; break;
          case Biome.BIRCH_FOREST: p = 0.6; type = r2 < 0.8 ? 'birch' : 'oak'; break;
          case Biome.TAIGA: p = 0.55; type = r2 < 0.2 ? 'spruce_tall' : 'spruce'; break;
          case Biome.SNOWY: p = 0.08; type = 'spruce'; break;
          case Biome.PLAINS: p = 0.035; type = r2 < 0.3 ? 'bigoak' : 'oak'; break;
          case Biome.MOUNTAINS: p = 0.1; type = 'spruce'; break;
          default: p = 0;
        }
        const r1 = ((h >>> 18) & 1023) / 1023;
        if (r1 >= p) continue;
        const gy = Math.floor(s.h);
        if (gy <= SEA) continue;
        // deterministic ground test (identical in every column that sees this tree)
        const hx = this.sample(tx + 1, tz, {}).h - this.sample(tx - 1, tz, {}).h;
        const hz = this.sample(tx, tz + 1, {}).h - this.sample(tx, tz - 1, {}).h;
        this.sample(tx, tz, s);
        s.slope = Math.max(Math.abs(hx), Math.abs(hz)) * 0.5;
        const surf = this._surfaceBlock(s, gy, false, this.nSurf.noise2(tx * 0.06, tz * 0.06), tx, tz);
        if (surf !== B.grass_block && surf !== B.podzol && surf !== B.snowy_grass && surf !== B.coarse_dirt) continue;
        const ground = gy;
        const rnd = mulberry32(h ^ 0x5bd1e995);
        this._growTree(type, tx, ground + 1, tz, rnd, set);
      }
    }
  }

  _growTree(type, x, y, z, rnd, set) {
    const leavesBlob = (cx, cy, cz, rx, ry, rz, leaf, density = 1) => {
      for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
        for (let dz = -Math.ceil(rz); dz <= Math.ceil(rz); dz++) {
          for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
            const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz);
            if (d <= 1 && (d < 0.55 || rnd() < density)) set(cx + dx, cy + dy, cz + dz, leaf, false);
          }
        }
      }
    };
    if (type === 'oak' || type === 'birch') {
      const leaf = type === 'oak' ? B.oak_leaves : B.birch_leaves;
      const log = type === 'oak' ? B.oak_log : B.birch_log;
      const h = type === 'oak' ? 4 + Math.floor(rnd() * 3) : 5 + Math.floor(rnd() * 3);
      const top = y + h - 1;
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy <= -1 ? 2 : 1;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const corner = Math.abs(dx) === r && Math.abs(dz) === r;
            if (corner && (dy === 1 || rnd() < 0.55)) continue;
            if (dy === 1 && (Math.abs(dx) + Math.abs(dz) > 1)) continue;
            set(x + dx, top + dy, z + dz, leaf, false);
          }
        }
      }
      for (let k = 0; k < h; k++) set(x, y + k, z, log, true);
    } else if (type === 'bigoak') {
      const h = 6 + Math.floor(rnd() * 4);
      const top = y + h;
      leavesBlob(x, top - 1, z, 3.6, 2.4, 3.6, B.oak_leaves, 0.75);
      const branches = 2 + Math.floor(rnd() * 3);
      for (let b = 0; b < branches; b++) {
        const a = rnd() * Math.PI * 2;
        const len = 2 + Math.floor(rnd() * 2);
        const by = y + Math.floor(h * 0.55 + rnd() * h * 0.3);
        let bx = x, bz = z;
        for (let k = 1; k <= len; k++) {
          bx = x + Math.round(Math.cos(a) * k);
          bz = z + Math.round(Math.sin(a) * k);
          set(bx, by + Math.floor(k / 2), bz, B.oak_log, true);
        }
        leavesBlob(bx, by + Math.floor(len / 2) + 1, bz, 2.4, 1.6, 2.4, B.oak_leaves, 0.7);
      }
      for (let k = 0; k < h; k++) set(x, y + k, z, B.oak_log, true);
    } else {
      const tall = type === 'spruce_tall';
      const h = tall ? 12 + Math.floor(rnd() * 6) : 7 + Math.floor(rnd() * 5);
      const top = y + h;
      set(x, top, z, B.spruce_leaves, false);
      set(x, top + 1, z, B.spruce_leaves, false);
      let r = 0;
      const pattern = tall ? [1, 1, 2, 1, 2, 2, 3, 2, 3, 3, 2, 3] : [1, 1, 2, 1, 2, 3, 2, 3];
      let pi = 0;
      for (let yy = top - 1; yy >= y + 2 + (tall ? 3 : 0); yy--) {
        r = pattern[Math.min(pi++, pattern.length - 1)];
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const d = Math.abs(dx) + Math.abs(dz);
            if (d > r + (r > 1 ? 1 : 0)) continue;
            if (d === r + 1 && rnd() < 0.5) continue;
            set(x + dx, yy, z + dz, B.spruce_leaves, false);
          }
        }
      }
      for (let k = 0; k < h; k++) set(x, y + k, z, B.spruce_log, true);
    }
  }
}
