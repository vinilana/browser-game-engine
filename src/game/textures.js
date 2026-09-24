// Procedural PBR texture recipes for the VoxelCraft demo.
// Each recipe paints into a TexCtx: r,g,b (sRGB), a, h (height), rough, metal, emit, aoExtra.
import { hex, mixColor, gradient, clamp, smoothstep, lerp } from '../engine/voxel/TextureSynth.js';

// ----------------------------------------------------------------------------
// Reusable painters
// ----------------------------------------------------------------------------
function paintStone(ctx, base = hex(0x7d7c79), opts = {}) {
  const var1 = opts.variation ?? 0.08;
  ctx.normalStrength = opts.normal ?? 2.0;
  ctx.aoStrength = 1.3;
  ctx.each((u, v, i, x, y) => {
    const big = ctx.fbm(u, v, 2, 3, 0.5);
    const mid = ctx.fbm(u + 0.37, v + 0.11, 6, 4, 0.55);
    const grain = ctx.white(x, y) - 0.5;
    const wu = u + ctx.fbm(u, v, 4, 2) * 0.05, wv = v + ctx.fbm(v, u, 4, 2) * 0.05;
    const w = ctx.worley(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1, 4, 1);
    const edgeVis = smoothstep(0.1, 0.45, ctx.fbm(u + 3.1, v, 5, 2));
    const crack = smoothstep(0.035, 0.0, w.f2 - w.f1) * edgeVis;
    const speck = ctx.white(x, y, 7) > 0.975 ? (ctx.white(x, y, 9) - 0.5) * 0.5 : 0;
    const t = 1 + big * var1 * 2.2 + mid * 0.12 + grain * 0.07 + speck - crack * 0.35;
    const warm = big * 0.012;
    ctx.setColor(i, [base[0] * t + warm, base[1] * t, base[2] * t - warm]);
    ctx.h[i] = 0.55 + mid * 0.22 + big * 0.1 + grain * 0.05 - crack * 0.3;
    ctx.rough[i] = 0.8 + mid * 0.08 - Math.abs(speck) * 0.4;
  });
}

function paintDirt(ctx, base = hex(0x6e4c33), opts = {}) {
  ctx.normalStrength = opts.normal ?? 2.2;
  ctx.aoStrength = 1.4;
  ctx.each((u, v, i, x, y) => {
    const n = ctx.fbm(u, v, 4, 5, 0.6);
    const humus = smoothstep(-0.1, 0.5, ctx.fbm(u + 0.5, v + 0.2, 3, 3));
    const clod = ctx.worley(u, v, 18, 1);
    const clodH = (1 - clod.f1) * 0.6 * (0.6 + ctx.hashf(clod.id) * 0.4) + ctx.fbm(u, v, 32, 2) * 0.2;
    const clodTone = 0.94 + ctx.hashf(clod.id, 1) * 0.12;
    const peb = ctx.worley(u, v, 10, 1);
    const pn = ctx.fbm(u, v, 24, 2) * 0.12;
    const pebble = smoothstep(0.26, 0.2, peb.f1 + pn) * (ctx.hashf(peb.id) > 0.82 ? 1 : 0);
    const pcol = mixColor(hex(0x6f665c), hex(0x4a3f37), ctx.hashf(peb.id, 3)).map((k) => k * (0.8 + (1 - peb.f1 * 3) * 0.25));
    const grain = (ctx.white(x, y) - 0.5) * 0.1;
    let c = mixColor(base, hex(0x3e2a1d), humus * 0.55 + (0.5 - n * 0.5) * 0.25);
    c = c.map((k) => k * clodTone * (0.85 + clodH * 0.25) * (1 + grain));
    c = mixColor(c, pcol, pebble);
    ctx.setColor(i, c);
    ctx.h[i] = 0.35 + clodH * 0.3 + n * 0.15 + pebble * 0.3;
    ctx.rough[i] = 0.96 - pebble * 0.12;
  });
}

function paintGrassBlades(ctx, count, lumMin, lumMax, lenMin, lenMax) {
  const s = ctx.size;
  const k = s / 128;
  for (let b = 0; b < count; b++) {
    const x = ctx.rng() * s, y = ctx.rng() * s;
    const ang = ctx.rng() * Math.PI * 2;
    const len = (lenMin + ctx.rng() * (lenMax - lenMin)) * k;
    const lum = lumMin + ctx.rng() * (lumMax - lumMin);
    const hue = ctx.rng();
    ctx.stroke(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, 1.1 * k, 0.4 * k, (i, cov, t) => {
      const l = lum * (0.8 + 0.35 * t);
      const c = [l * (0.95 + hue * 0.1), l, l * (0.9 + hue * 0.08)];
      ctx.r[i] = lerp(ctx.r[i], c[0], cov);
      ctx.g[i] = lerp(ctx.g[i], c[1], cov);
      ctx.b[i] = lerp(ctx.b[i], c[2], cov);
      ctx.h[i] = Math.max(ctx.h[i], lerp(ctx.h[i], 0.55 + t * 0.4, cov));
    });
  }
}

/** Grey-scale grass (tinted by biome color). */
function paintGrassTop(ctx) {
  ctx.normalStrength = 1.4;
  ctx.aoStrength = 1.2;
  const s = ctx.size, k = s / 128;
  ctx.each((u, v, i) => {
    const n = ctx.fbm(u, v, 3, 4);
    const l = 0.46 + n * 0.06;
    ctx.setColor(i, [l, l * 0.98, l * 0.9]);
    ctx.h[i] = 0.25 + n * 0.08;
    ctx.rough[i] = 0.88;
  });
  // clumps of blades leaning in a common direction
  for (let c = 0; c < 170; c++) {
    const cx = ctx.rng() * s, cy = ctx.rng() * s;
    const lean = ctx.rng() * Math.PI * 2;
    const tone = 0.62 + ctx.rng() * 0.3;
    const dry = ctx.rng() < 0.12 ? 1 : 0;
    const blades = 10 + Math.floor(ctx.rng() * 12);
    for (let b = 0; b < blades; b++) {
      const x = cx + (ctx.rng() - 0.5) * 12 * k, y = cy + (ctx.rng() - 0.5) * 12 * k;
      const a = lean + (ctx.rng() - 0.5) * 1.1;
      const len = (4 + ctx.rng() * 7) * k;
      const lum = tone * (0.8 + ctx.rng() * 0.3);
      ctx.stroke(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 1.0 * k, 0.35 * k, (i, cov, t) => {
        const l = lum * (0.75 + 0.35 * t);
        const col = dry ? [l * 1.12, l * 1.02, l * 0.7] : [l, l, l * 0.94];
        ctx.r[i] = lerp(ctx.r[i], col[0], cov);
        ctx.g[i] = lerp(ctx.g[i], col[1], cov);
        ctx.b[i] = lerp(ctx.b[i], col[2], cov);
        ctx.h[i] = Math.max(ctx.h[i], lerp(ctx.h[i], 0.5 + t * 0.4, cov));
        ctx.rough[i] = 0.8;
      });
    }
  }
  ctx.each((u, v, i) => {
    const patch = ctx.fbm(u + 0.3, v, 2, 3);
    const m = 0.93 + patch * 0.12;
    ctx.r[i] *= m; ctx.g[i] *= m; ctx.b[i] *= m;
  });
}

function paintPlanks(ctx, base, dark) {
  const s = ctx.size;
  const boards = 4;
  ctx.normalStrength = 1.6;
  ctx.each((u, v, i, x, y) => {
    const bi = Math.floor(v * boards);
    const bv = v * boards - bi;
    const seamU = (ctx.hashf(bi, 7) * 0.8 + 0.1);
    const segment = bi % 2 === 0 ? (u < seamU ? 0 : 1) : 0;
    const bid = bi * 3 + segment;
    const grain = ctx.aniso(u + ctx.hashf(bid) * 3.7, v, 2, 24, 4, 0.55);
    const rings = Math.sin((v * 40 + grain * 6 + ctx.hashf(bid, 2) * 10) * 1.3) * 0.5 + 0.5;
    const tone = 0.9 + ctx.hashf(bid, 5) * 0.2;
    let c = mixColor(base, dark, clamp(rings * 0.35 + grain * 0.5 + 0.2, 0, 1));
    c = c.map((k) => k * tone);
    const gap = Math.min(bv, 1 - bv) * s / boards;
    const seamD = Math.abs(u - seamU) * s;
    let edge = smoothstep(0, 1.6, gap);
    if (bi % 2 === 0) edge *= smoothstep(0, 1.4, seamD);
    c = c.map((k) => k * (0.35 + 0.65 * edge));
    ctx.setColor(i, c);
    ctx.h[i] = 0.4 + edge * 0.4 + grain * 0.08;
    ctx.rough[i] = 0.62 + grain * 0.1 + (1 - edge) * 0.3;
    ctx.aoExtra[i] = 0.6 + 0.4 * edge;
  });
}

function paintBark(ctx, base, dark, opts = {}) {
  ctx.normalStrength = opts.normal ?? 2.8;
  ctx.aoStrength = 1.6;
  const pu = opts.pu ?? 12, pv = opts.pv ?? 2;
  ctx.each((u, v, i, x, y) => {
    const wu = u + ctx.fbm(u, v, 4, 3) * 0.035;
    const ridge = 1 - Math.abs(ctx.aniso(wu, v, pu, pv, 4, 0.5));
    const fissure = smoothstep(0.78, 0.97, ridge);
    const plate = ctx.aniso(wu + 0.3, v, Math.max(2, pu >> 1), pv + 1, 3, 0.5);
    const crossR = 1 - Math.abs(ctx.aniso(u, v + 0.17, 4, 10, 2, 0.5));
    const cross = smoothstep(0.9, 0.99, crossR) * (1 - fissure);
    const fine = ctx.fbm(u, v, 24, 2) * 0.08 + (ctx.white(x, y) - 0.5) * 0.08;
    const lichen = opts.lichen ? smoothstep(0.35, 0.7, ctx.fbm(u + 1.7, v, 3, 4)) * 0.5 : 0;
    let c = mixColor(base, dark, clamp(fissure * 0.9 + cross * 0.5 + (0.5 - plate) * 0.25, 0, 1));
    c = c.map((k) => k * (1 + fine));
    if (lichen > 0) c = mixColor(c, [0.42, 0.47, 0.3], lichen * (1 - fissure));
    ctx.setColor(i, c);
    ctx.h[i] = 0.55 + plate * 0.18 - fissure * 0.5 - cross * 0.2 + fine * 0.3;
    ctx.rough[i] = 0.88 + fissure * 0.1;
  });
}

function paintLogTop(ctx, wood, ringCol, barkCol) {
  ctx.normalStrength = 1.4;
  ctx.each((u, v, i) => {
    const dx = u - 0.5, dy = v - 0.5;
    const warp = ctx.fbm(u, v, 3, 3) * 0.035;
    const d = Math.sqrt(dx * dx + dy * dy) + warp;
    const rings = Math.pow(Math.sin(d * 58) * 0.5 + 0.5, 3);
    const n = ctx.fbm(u, v, 12, 3);
    let c = mixColor(wood, ringCol, rings * 0.7 + n * 0.1);
    const bark = smoothstep(0.43, 0.46, Math.max(Math.abs(dx), Math.abs(dy)) + warp);
    c = mixColor(c, barkCol.map((k) => k * (0.8 + n * 0.3)), bark);
    const crack = smoothstep(0.02, 0.0, Math.abs(Math.atan2(dy, dx) - 0.7 - n * 0.2)) * (d < 0.35 ? 1 : 0) * smoothstep(0.05, 0.2, d);
    c = c.map((k) => k * (1 - crack * 0.5));
    ctx.setColor(i, c);
    ctx.h[i] = 0.6 - rings * 0.06 - crack * 0.3 - bark * 0.1 + n * 0.03;
    ctx.rough[i] = 0.75;
  });
}

function paintLeaves(ctx, opts) {
  const s = ctx.size, k = s / 128;
  ctx.normalStrength = 2.0;
  ctx.aoStrength = 0.8;
  ctx.a.fill(0);
  ctx.h.fill(0);
  ctx.each((u, v, i) => { ctx.setColor(i, opts.dark); ctx.rough[i] = 0.6; });
  // twigs
  for (let t = 0; t < 18; t++) {
    const x = ctx.rng() * s, y = ctx.rng() * s, a = ctx.rng() * Math.PI * 2, l = (12 + ctx.rng() * 20) * k;
    ctx.stroke(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.9 * k, 0.5 * k, (i, cov) => {
      if (cov > 0.4) { ctx.a[i] = 1; ctx.setColor(i, opts.twig); ctx.h[i] = 0.3; }
    });
  }
  const count = Math.round(opts.count * (s / 128) * (s / 128));
  for (let l = 0; l < count; l++) {
    const x = ctx.rng() * s, y = ctx.rng() * s;
    const ang = ctx.rng() * Math.PI;
    const len = (opts.len[0] + ctx.rng() * (opts.len[1] - opts.len[0])) * k;
    const wid = len * (opts.width[0] + ctx.rng() * (opts.width[1] - opts.width[0]));
    const shade = opts.lum[0] + ctx.rng() * (opts.lum[1] - opts.lum[0]);
    const hueShift = (ctx.rng() - 0.5) * opts.hue;
    const tilt = ctx.rng() * 0.5 + 0.5;
    const layerH = ctx.rng();
    ctx.ellipse(x, y, len / 2, wid / 2, ang, (i, cov, lx, ly) => {
      if (cov < 0.5) return;
      const dome = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly));
      const vein = smoothstep(0.12, 0.0, Math.abs(ly)) * 0.18;
      const hNew = layerH * 0.6 + dome * 0.4 * tilt;
      if (ctx.a[i] > 0 && ctx.h[i] > hNew) return;
      const lum = shade * (0.82 + dome * 0.25 + lx * 0.08) * (1 - vein);
      ctx.r[i] = opts.base[0] * lum * (1 + hueShift);
      ctx.g[i] = opts.base[1] * lum;
      ctx.b[i] = opts.base[2] * lum * (1 - hueShift);
      ctx.a[i] = 1;
      ctx.h[i] = hNew;
      ctx.rough[i] = 0.45 + (1 - dome) * 0.2;
    });
  }
}

function paintNeedles(ctx, base, count) {
  const s = ctx.size, k = s / 128;
  ctx.normalStrength = 1.6;
  ctx.a.fill(0);
  ctx.h.fill(0);
  ctx.each((u, v, i) => { ctx.setColor(i, base.map((c) => c * 0.4)); ctx.rough[i] = 0.55; });
  for (let b = 0; b < 26; b++) {
    const x = ctx.rng() * s, y = ctx.rng() * s, a = ctx.rng() * Math.PI * 2, l = (20 + ctx.rng() * 25) * k;
    const x1 = x + Math.cos(a) * l, y1 = y + Math.sin(a) * l;
    ctx.stroke(x, y, x1, y1, 0.9 * k, 0.6 * k, (i, cov) => {
      if (cov > 0.4) { ctx.a[i] = 1; ctx.setColor(i, hex(0x3a2a1c)); ctx.h[i] = 0.2; }
    });
    // needles along the branch
    for (let n = 0; n < l / k * 1.4; n++) {
      const t = ctx.rng();
      const px = x + (x1 - x) * t, py = y + (y1 - y) * t;
      const side = ctx.rng() > 0.5 ? 1 : -1;
      const na = a + side * (0.6 + ctx.rng() * 0.5);
      const nl = (5 + ctx.rng() * 5) * k;
      const lum = 0.7 + ctx.rng() * 0.5;
      ctx.stroke(px, py, px + Math.cos(na) * nl, py + Math.sin(na) * nl, 0.65 * k, 0.4 * k, (i, cov, tt) => {
        if (cov < 0.45) return;
        ctx.a[i] = 1;
        ctx.setColor(i, base.map((c) => c * lum * (0.85 + tt * 0.3)));
        ctx.h[i] = 0.4 + tt * 0.3 + ctx.rng() * 0.1;
      });
    }
  }
  for (let b = 0; b < count; b++) {
    const x = ctx.rng() * s, y = ctx.rng() * s, a = ctx.rng() * Math.PI * 2, l = (5 + ctx.rng() * 6) * k;
    const lum = 0.6 + ctx.rng() * 0.6;
    ctx.stroke(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.6 * k, 0.35 * k, (i, cov) => {
      if (cov < 0.5) return;
      ctx.a[i] = 1;
      ctx.setColor(i, base.map((c) => c * lum));
      ctx.h[i] = Math.max(ctx.h[i], 0.5 + ctx.rng() * 0.3);
    });
  }
}

function paintOre(ctx, oreCol, opts = {}) {
  paintStone(ctx);
  const s = ctx.size, k = s / 128;
  const blobs = opts.blobs ?? 7;
  for (let b = 0; b < blobs; b++) {
    const cx = (0.12 + ctx.rng() * 0.76) * s, cy = (0.12 + ctx.rng() * 0.76) * s;
    const r = (opts.size ?? 7) * k * (0.7 + ctx.rng() * 0.6);
    const seed = ctx.rng() * 10;
    const R = Math.ceil(r * 1.6);
    for (let y = Math.floor(cy - R); y <= cy + R; y++) {
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        if (x < 0 || y < 0 || x >= s || y >= s) continue;
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const d = Math.sqrt(dx * dx + dy * dy) / r;
        const nn = ctx.fbm(x / s + seed, y / s, 16, 2) * 0.55;
        if (d + nn > 1) continue;
        const i = y * s + x;
        const e = 1 - (d + nn);
        const facet = ctx.worley(x / s, y / s, 40, 1);
        const shade = 0.7 + 0.5 * (1 - facet.f1) + (ctx.hashf(facet.id) - 0.5) * 0.3;
        ctx.setColor(i, oreCol.map((c) => clamp(c * shade, 0, 1)));
        ctx.h[i] = ctx.h[i] + 0.25 * smoothstep(0, 0.4, e);
        ctx.rough[i] = opts.rough ?? 0.5;
        ctx.metal[i] = opts.metal ?? 0;
        ctx.emit[i] = (opts.emit ?? 0) * smoothstep(0.1, 0.6, e);
      }
    }
  }
}

function paintBrickPattern(ctx, rows, cols, mortarPx, brickFn, mortarCol) {
  const s = ctx.size;
  ctx.normalStrength = 2.4;
  ctx.aoStrength = 1.6;
  ctx.each((u, v, i, x, y) => {
    const row = Math.floor(v * rows);
    const off = (row % 2) * 0.5;
    const uu = (u + off / cols) % 1;
    const col = Math.floor(uu * cols);
    const bu = uu * cols - col, bv = v * rows - row;
    const ex = Math.min(bu, 1 - bu) * s / cols, ey = Math.min(bv, 1 - bv) * s / rows;
    const e = Math.min(ex, ey);
    const inBrick = smoothstep(mortarPx * 0.5, mortarPx * 0.5 + 1.2, e);
    const id = row * 97 + (col + (row % 2) * 13);
    const bc = brickFn(u, v, id, bu, bv, x, y);
    const mn = ctx.fbm(u, v, 16, 2);
    const m = mortarCol.map((c) => c * (0.9 + mn * 0.2));
    ctx.setColor(i, mixColor(m, bc.color, inBrick));
    const bevel = smoothstep(mortarPx * 0.5, mortarPx * 0.5 + 3, e);
    ctx.h[i] = 0.2 + inBrick * 0.45 + bevel * 0.15 + (bc.h ?? 0) * inBrick;
    ctx.rough[i] = lerp(0.95, bc.rough ?? 0.8, inBrick);
  });
}

function paintMetalBlock(ctx, col, rough) {
  const s = ctx.size;
  ctx.normalStrength = 1.2;
  ctx.aoStrength = 0.6;
  ctx.each((u, v, i, x, y) => {
    const brushed = ctx.aniso(u, v, 64, 2, 3, 0.6) * 0.5 + (ctx.white(x, y) - 0.5) * 0.05;
    const e = Math.min(u, 1 - u, v, 1 - v) * s;
    const bevel = smoothstep(0, 5 * s / 128, e);
    const inner = smoothstep(9 * s / 128, 10 * s / 128, e);
    const dirt = smoothstep(0.2, 0.8, ctx.fbm(u, v, 3, 4)) * 0.25;
    const c = col.map((k) => k * (0.9 + brushed * 0.25) * (1 - dirt * 0.4) * (0.75 + 0.25 * bevel));
    ctx.setColor(i, c);
    ctx.metal[i] = 1;
    ctx.rough[i] = rough + Math.abs(brushed) * 0.15 + dirt * 0.3 + (1 - inner) * 0.05;
    ctx.h[i] = 0.3 + bevel * 0.4 + inner * 0.1 + brushed * 0.03;
  });
}

function crossPlantBase(ctx) {
  ctx.a.fill(0);
  ctx.h.fill(0.5);
  ctx.flatNormals = true;
  ctx.aoStrength = 0;
}

// ----------------------------------------------------------------------------
// Recipes
// ----------------------------------------------------------------------------
export const TEXTURE_RECIPES = {
  stone: (ctx) => paintStone(ctx),

  granite: (ctx) => {
    paintStone(ctx, hex(0x9a6f5e), { variation: 0.07 });
    ctx.each((u, v, i, x, y) => {
      const w = ctx.worley(u, v, 26, 1);
      const t = ctx.hashf(w.id);
      if (t > 0.6) ctx.setColor(i, mixColor([ctx.r[i], ctx.g[i], ctx.b[i]], t > 0.85 ? hex(0x2f2522) : hex(0xc79a88), 0.7));
    });
  },
  andesite: (ctx) => {
    paintStone(ctx, hex(0x898989), { variation: 0.05 });
    ctx.each((u, v, i, x, y) => {
      const w = ctx.worley(u, v, 30, 1);
      const t = ctx.hashf(w.id);
      if (t > 0.7) ctx.setColor(i, mixColor([ctx.r[i], ctx.g[i], ctx.b[i]], t > 0.9 ? hex(0x5b5b5b) : hex(0xaaaaaa), 0.6));
    });
  },
  diorite: (ctx) => {
    paintStone(ctx, hex(0xc4c2bd), { variation: 0.04 });
    ctx.each((u, v, i) => {
      const w = ctx.worley(u, v, 22, 1);
      const t = ctx.hashf(w.id);
      if (t > 0.72 && w.f1 < 0.45) ctx.setColor(i, hex(0x4a4a48));
    });
  },

  cobblestone: (ctx) => {
    ctx.normalStrength = 3.2;
    ctx.aoStrength = 2.0;
    ctx.each((u, v, i, x, y) => {
      const w = ctx.worley(u, v, 5, 1);
      const edge = w.f2 - w.f1;
      const bulge = smoothstep(0.02, 0.45, edge);
      const id = w.id;
      const tone = 0.75 + ctx.hashf(id) * 0.5;
      const warm = ctx.hashf(id, 2) * 0.06;
      const n = ctx.fbm(u, v, 16, 3);
      let c = [0.5 * tone + warm, 0.5 * tone + warm * 0.5, 0.49 * tone];
      c = c.map((k) => k * (1 + n * 0.15));
      const mortar = smoothstep(0.1, 0.03, edge);
      c = mixColor(c, hex(0x3a3836), mortar);
      ctx.setColor(i, c);
      ctx.h[i] = bulge * 0.75 + n * 0.08 + 0.05;
      ctx.rough[i] = 0.82 + mortar * 0.15;
    });
  },

  mossy_cobblestone: (ctx) => {
    TEXTURE_RECIPES.cobblestone(ctx);
    ctx.each((u, v, i, x, y) => {
      const m = ctx.fbm(u + 0.2, v + 0.7, 3, 4);
      const lowH = 1 - ctx.h[i];
      const moss = smoothstep(0.05, 0.35, m + lowH * 0.35 - 0.1);
      if (moss <= 0) return;
      const g = ctx.fbm(u, v, 24, 2);
      const mc = [0.28 + g * 0.08, 0.42 + g * 0.1, 0.14];
      ctx.setColor(i, mixColor([ctx.r[i], ctx.g[i], ctx.b[i]], mc, moss));
      ctx.rough[i] = lerp(ctx.rough[i], 0.95, moss);
      ctx.h[i] += moss * 0.08 * (ctx.white(x, y) + 0.5);
    });
  },

  stone_bricks: (ctx) => {
    paintBrickPattern(ctx, 2, 2, 3 * ctx.size / 128, (u, v, id) => {
      const n = ctx.fbm(u, v, 8, 4);
      const t = 0.92 + ctx.hashf(id) * 0.14;
      const crack = smoothstep(0.03, 0, Math.abs(ctx.fbm(u + id, v, 4, 3))) * (ctx.hashf(id, 3) > 0.6 ? 1 : 0);
      return { color: [0.5 * t * (1 + n * 0.15) * (1 - crack * 0.3), 0.5 * t * (1 + n * 0.15) * (1 - crack * 0.3), 0.49 * t * (1 + n * 0.15) * (1 - crack * 0.3)], h: n * 0.1 - crack * 0.2, rough: 0.8 };
    }, hex(0x444340));
  },

  bricks: (ctx) => {
    paintBrickPattern(ctx, 4, 2, 3.5 * ctx.size / 128, (u, v, id, bu, bv, x, y) => {
      const n = ctx.fbm(u, v, 10, 4);
      const base = mixColor(hex(0x9b4a33), hex(0x7a3526), ctx.hashf(id));
      const burnt = smoothstep(0.4, 0.8, ctx.fbm(u + id * 0.1, v, 4, 2) + ctx.hashf(id, 9) * 0.3) * 0.3;
      const speck = (ctx.white(x, y) - 0.5) * 0.12;
      const c = base.map((k) => k * (1 + n * 0.2 + speck) * (1 - burnt));
      return { color: c, h: n * 0.12, rough: 0.85 };
    }, hex(0xb7b0a4));
  },

  dirt: (ctx) => paintDirt(ctx),
  coarse_dirt: (ctx) => {
    paintDirt(ctx, hex(0x6f4f35));
    ctx.each((u, v, i, x, y) => {
      const w = ctx.worley(u, v, 9, 1);
      if (ctx.hashf(w.id) > 0.55 && w.f1 < 0.4) {
        const g = 0.35 + ctx.hashf(w.id, 4) * 0.25;
        ctx.setColor(i, [g, g * 0.95, g * 0.9]);
        ctx.h[i] += 0.3 * (0.4 - w.f1);
      }
    });
  },
  podzol_top: (ctx) => {
    paintDirt(ctx, hex(0x5e4127));
    const s = ctx.size;
    for (let n = 0; n < 500; n++) {
      const x = ctx.rng() * s, y = ctx.rng() * s, a = ctx.rng() * 6.28, l = 4 + ctx.rng() * 6;
      const c = mixColor(hex(0x7a5020), hex(0x3d2a16), ctx.rng());
      ctx.stroke(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.8, 0.4, (i, cov) => {
        ctx.setColor(i, mixColor([ctx.r[i], ctx.g[i], ctx.b[i]], c, cov));
        ctx.h[i] = Math.max(ctx.h[i], 0.7 * cov);
      });
    }
  },

  grass_top: (ctx) => paintGrassTop(ctx),

  grass_side: (ctx) => {
    paintDirt(ctx);
    const s = ctx.size;
    const edge = new Float32Array(s);
    for (let x = 0; x < s; x++) {
      edge[x] = (0.16 + 0.1 * (ctx.fbm(x / s, 0.5, 6, 3) * 0.5 + 0.5)) * s;
    }
    ctx.each((u, v, i, x, y) => {
      const n = ctx.fbm(u, v, 8, 3);
      if (y < edge[x]) {
        const l = 0.62 + n * 0.12 + (ctx.white(x, y) - 0.5) * 0.12;
        ctx.setColor(i, [l, l, l]);
        ctx.a[i] = 1;
        ctx.h[i] = 0.7 + n * 0.1;
        ctx.rough[i] = 0.7;
      } else {
        ctx.a[i] = 0;
      }
    });
    // hanging blades
    for (let b = 0; b < 140; b++) {
      const x = ctx.rng() * s;
      const x0 = Math.floor(x) % s;
      const y0 = edge[x0] - 2;
      const len = (3 + ctx.rng() * 9) * s / 128;
      const lum = 0.5 + ctx.rng() * 0.4;
      ctx.stroke(x, y0, x + (ctx.rng() - 0.5) * 3, y0 + len, 1.2 * s / 128, 0.3, (i, cov, t) => {
        ctx.setColor(i, mixColor([ctx.r[i], ctx.g[i], ctx.b[i]], [lum, lum, lum], cov));
        ctx.a[i] = Math.max(ctx.a[i], cov);
        ctx.h[i] = Math.max(ctx.h[i], 0.75 - t * 0.2);
      }, false);
    }
  },

  grass_snow_side: (ctx) => {
    paintDirt(ctx);
    const s = ctx.size;
    ctx.each((u, v, i, x, y) => {
      const e = (0.2 + 0.06 * ctx.fbm(u, 0.3, 8, 3)) * s;
      if (y < e) {
        const n = ctx.fbm(u, v, 8, 3);
        const c = [0.9 + n * 0.05, 0.93 + n * 0.05, 0.97];
        ctx.setColor(i, c);
        ctx.h[i] = 0.75 + n * 0.1;
        ctx.rough[i] = 0.55;
      } else if (y < e + 2) {
        ctx.setColor(i, mixColor([ctx.r[i], ctx.g[i], ctx.b[i]], [0.35, 0.3, 0.25], 0.5));
      }
    });
  },

  sand: (ctx) => {
    ctx.normalStrength = 1.3;
    ctx.each((u, v, i, x, y) => {
      const n = ctx.fbm(u, v, 4, 4);
      const rip = Math.sin((u * 5 + v * 2 + ctx.fbm(u, v, 3, 2) * 0.8) * Math.PI * 2 * 1.5) * 0.5 + 0.5;
      const g = ctx.white(x, y);
      const base = hex(0xdac99b);
      const t = 1 + n * 0.06 + (g - 0.5) * 0.14;
      let c = base.map((k) => k * t);
      if (g > 0.992) c = hex(0x6d6558);
      else if (g < 0.01) c = hex(0xf6efe0);
      ctx.setColor(i, c);
      ctx.h[i] = 0.5 + rip * 0.12 + (g - 0.5) * 0.12 + n * 0.1;
      ctx.rough[i] = 0.92;
    });
  },

  red_sand: (ctx) => {
    TEXTURE_RECIPES.sand(ctx);
    ctx.each((u, v, i) => { ctx.r[i] *= 1.05; ctx.g[i] *= 0.72; ctx.b[i] *= 0.55; });
  },

  gravel: (ctx) => {
    ctx.normalStrength = 3.0;
    ctx.aoStrength = 1.8;
    ctx.each((u, v, i, x, y) => {
      const w = ctx.worley(u, v, 11, 1);
      const bulge = smoothstep(0.0, 0.35, w.f2 - w.f1);
      const t = ctx.hashf(w.id);
      const base = t < 0.33 ? hex(0x8d8a86) : t < 0.66 ? hex(0x6c6865) : t < 0.85 ? hex(0x9b8f83) : hex(0x55504c);
      const n = ctx.fbm(u, v, 32, 2);
      const c = base.map((k) => k * (0.85 + bulge * 0.25 + n * 0.1));
      const gap = smoothstep(0.08, 0.0, w.f2 - w.f1);
      ctx.setColor(i, mixColor(c, hex(0x2c2a28), gap));
      ctx.h[i] = bulge * 0.7 + n * 0.05;
      ctx.rough[i] = 0.85;
    });
  },

  clay: (ctx) => {
    ctx.normalStrength = 1.0;
    ctx.each((u, v, i, x, y) => {
      const n = ctx.fbm(u, v, 3, 5);
      const c = hex(0xa2a7b4).map((k) => k * (1 + n * 0.06 + (ctx.white(x, y) - 0.5) * 0.03));
      ctx.setColor(i, c);
      ctx.h[i] = 0.5 + n * 0.12;
      ctx.rough[i] = 0.55 + n * 0.1;
    });
  },

  sandstone_side: (ctx) => {
    ctx.normalStrength = 2.0;
    ctx.each((u, v, i, x, y) => {
      const warp = ctx.fbm(u, v, 2, 3) * 0.08;
      const band = Math.sin((v + warp) * Math.PI * 2 * 6) * 0.5 + 0.5;
      const layer = Math.floor((v + warp) * 6);
      const n = ctx.fbm(u, v, 8, 4);
      const base = mixColor(hex(0xd9c99a), hex(0xc6b07c), (layer % 3) / 2);
      const c = base.map((k) => k * (0.92 + band * 0.08 + n * 0.06 + (ctx.white(x, y) - 0.5) * 0.06));
      const top = smoothstep(0.12, 0.02, v) * 0.1;
      ctx.setColor(i, c.map((k) => k * (1 + top)));
      ctx.h[i] = 0.5 + band * 0.18 + n * 0.1 - smoothstep(0.93, 1, Math.abs(Math.sin((v + warp) * Math.PI * 12))) * 0.3;
      ctx.rough[i] = 0.88;
    });
  },
  sandstone_top: (ctx) => {
    ctx.normalStrength = 1.4;
    ctx.each((u, v, i, x, y) => {
      const n = ctx.fbm(u, v, 5, 4);
      const pore = ctx.white(x, y) > 0.985 ? 0.25 : 0;
      const c = hex(0xdccd9f).map((k) => k * (0.95 + n * 0.07 - pore));
      ctx.setColor(i, c);
      ctx.h[i] = 0.5 + n * 0.12 - pore;
      ctx.rough[i] = 0.85;
    });
  },

  snow: (ctx) => {
    ctx.normalStrength = 0.9;
    ctx.each((u, v, i, x, y) => {
      const n = ctx.fbm(u, v, 3, 5);
      const hollow = smoothstep(0.1, -0.3, n);
      const c = [0.92 - hollow * 0.06, 0.94 - hollow * 0.04, 0.98];
      ctx.setColor(i, c);
      ctx.h[i] = 0.5 + n * 0.2;
      const sparkle = ctx.white(x, y) > 0.993;
      ctx.rough[i] = sparkle ? 0.12 : 0.62 + n * 0.1;
    });
  },

  ice: (ctx) => {
    ctx.normalStrength = 1.4;
    ctx.aoStrength = 0.4;
    ctx.each((u, v, i, x, y) => {
      const n = ctx.fbm(u, v, 3, 5);
      const w = ctx.worley(u, v, 4, 1);
      const crack = smoothstep(0.03, 0.0, w.f2 - w.f1);
      const frost = smoothstep(-0.1, 0.45, ctx.fbm(u + 0.4, v, 5, 4));
      const bub = smoothstep(0.07, 0.0, ctx.worley(u + 0.3, v, 18, 1).f1) * 0.25;
      let c = mixColor(hex(0x7d9cc2), hex(0xb4cbe2), clamp(0.35 + n * 0.5 + bub, 0, 1));
      c = mixColor(c, hex(0xeef2f7), 0.35 + frost * 0.6);
      c = mixColor(c, hex(0xf2f6fa), crack * 0.7);
      ctx.setColor(i, c.map((k) => k * (1 + (ctx.white(x, y) - 0.5) * 0.04)));
      ctx.h[i] = 0.6 - crack * 0.35 + frost * 0.08 + n * 0.05;
      ctx.rough[i] = lerp(0.18, 0.7, frost) + crack * 0.2;
    });
  },

  bedrock: (ctx) => {
    ctx.normalStrength = 3.5;
    ctx.each((u, v, i) => {
      const w = ctx.worley(u, v, 6, 1);
      const n = ctx.fbm(u, v, 6, 4);
      const t = ctx.hashf(w.id);
      const c = t > 0.5 ? hex(0x575757) : t > 0.2 ? hex(0x3b3b3b) : hex(0x777777);
      ctx.setColor(i, c.map((k) => k * (0.8 + n * 0.3)));
      ctx.h[i] = smoothstep(0, 0.4, w.f2 - w.f1) * (0.5 + t * 0.5) + n * 0.1;
      ctx.rough[i] = 0.9;
    });
  },

  oak_log: (ctx) => paintBark(ctx, hex(0x5e4a36), hex(0x241a12), { lichen: true }),
  oak_log_top: (ctx) => paintLogTop(ctx, hex(0xb08b58), hex(0x7d5f37), hex(0x5a4128)),
  birch_log: (ctx) => {
    const s = ctx.size;
    ctx.normalStrength = 1.8;
    ctx.each((u, v, i, x, y) => {
      const n = ctx.fbm(u, v, 6, 4);
      const c = hex(0xcfc9bb).map((k) => k * (0.92 + n * 0.1));
      ctx.setColor(i, c);
      ctx.h[i] = 0.6 + n * 0.08;
      ctx.rough[i] = 0.7;
    });
    for (let m = 0; m < 16; m++) {
      const x = ctx.rng() * s, y = ctx.rng() * s, l = (4 + ctx.rng() * 30) * s / 128;
      const w = (0.8 + ctx.rng() * 2.6) * s / 128;
      ctx.stroke(x, y, x + l, y + (ctx.rng() - 0.5) * 3, w, w * (0.2 + ctx.rng() * 0.8), (i, cov) => {
        ctx.setColor(i, mixColor([ctx.r[i], ctx.g[i], ctx.b[i]], hex(0x262422), cov * 0.95));
        ctx.h[i] -= cov * 0.25;
        ctx.rough[i] = 0.85;
      });
    }
  },
  birch_log_top: (ctx) => paintLogTop(ctx, hex(0xd5c290), hex(0xb49d68), hex(0xd9d4c7)),
  spruce_log: (ctx) => {
    paintBark(ctx, hex(0x4a3524), hex(0x1f150e), { pu: 8, pv: 4 });
    ctx.each((u, v, i) => {
      const w = ctx.worley(u, v * 1.0, 10, 1);
      const scale = smoothstep(0.0, 0.15, w.f2 - w.f1);
      ctx.h[i] = ctx.h[i] * 0.6 + scale * 0.4;
    });
  },
  spruce_log_top: (ctx) => paintLogTop(ctx, hex(0x9c7a4d), hex(0x6c5130), hex(0x3a2a1b)),

  oak_planks: (ctx) => paintPlanks(ctx, hex(0xb38b56), hex(0x7a5a33)),
  birch_planks: (ctx) => paintPlanks(ctx, hex(0xd6c38f), hex(0xa99466)),
  spruce_planks: (ctx) => paintPlanks(ctx, hex(0x7d5a36), hex(0x4d3620)),

  oak_leaves: (ctx) => paintLeaves(ctx, {
    base: [0.7, 0.72, 0.64], dark: [0.2, 0.22, 0.18], twig: hex(0x4b3a26),
    count: 560, len: [8, 15], width: [0.38, 0.55], lum: [0.5, 0.95], hue: 0.12,
  }),
  birch_leaves: (ctx) => paintLeaves(ctx, {
    base: [0.4, 0.5, 0.22], dark: [0.12, 0.16, 0.07], twig: hex(0x5a4a3a),
    count: 600, len: [7, 12], width: [0.5, 0.7], lum: [0.6, 1.05], hue: 0.15,
  }),
  spruce_leaves: (ctx) => paintNeedles(ctx, [0.2, 0.34, 0.24], 900),

  glass: (ctx) => {
    const s = ctx.size;
    ctx.normalStrength = 0.6;
    ctx.aoStrength = 0;
    ctx.each((u, v, i, x, y) => {
      const e = Math.min(x, y, s - 1 - x, s - 1 - y);
      const frame = e < 3 * s / 128 ? 1 : 0;
      const streak = smoothstep(0.012, 0.0, Math.abs(u - v - 0.3)) * 0.35 + smoothstep(0.008, 0.0, Math.abs(u - v + 0.1)) * 0.25;
      ctx.setColor(i, frame ? [0.85, 0.88, 0.88] : [0.9, 0.95, 0.96]);
      ctx.a[i] = frame ? 1 : streak;
      ctx.h[i] = frame ? 0.7 : 0.5 + ctx.fbm(u, v, 2, 2) * 0.02;
      ctx.rough[i] = frame ? 0.4 : 0.05;
    });
  },

  water: (ctx) => {
    ctx.flatNormals = true;
    ctx.each((u, v, i) => { ctx.setColor(i, [0.2, 0.4, 0.5]); ctx.rough[i] = 0.05; });
  },

  coal_ore: (ctx) => paintOre(ctx, hex(0x1d1d1f), { rough: 0.55, blobs: 7 }),
  iron_ore: (ctx) => paintOre(ctx, hex(0xd8a384), { rough: 0.5, metal: 0.4, blobs: 6 }),
  gold_ore: (ctx) => paintOre(ctx, hex(0xfcd34a), { rough: 0.3, metal: 1, blobs: 6 }),
  diamond_ore: (ctx) => paintOre(ctx, hex(0x6ff2e8), { rough: 0.08, metal: 0, blobs: 5, emit: 0.06 }),
  emerald_ore: (ctx) => paintOre(ctx, hex(0x2fd66b), { rough: 0.1, blobs: 4, emit: 0.04 }),

  torch: (ctx) => {
    const s = ctx.size;
    const px = s / 16;
    ctx.flatNormals = false;
    ctx.normalStrength = 1;
    ctx.each((u, v, i, x, y) => {
      const gx = x / px, gy = y / px;
      const n = ctx.fbm(u, v, 16, 2);
      ctx.a[i] = gx >= 7 && gx < 9 && gy >= 6 ? 1 : 0;
      if (gy >= 8) {
        // wooden stick
        const c = mixColor(hex(0x6e5233), hex(0x4a3520), clamp(n + 0.5 + (gx - 8) * 0.2, 0, 1));
        ctx.setColor(i, c);
        ctx.rough[i] = 0.85;
        ctx.h[i] = 0.5 + n * 0.1;
      } else if (gy >= 6) {
        // flame (emissive)
        const t = (gy - 6) / 2;
        const c = mixColor(hex(0xfff3b0), hex(0xff8a1c), t);
        ctx.setColor(i, c);
        ctx.emit[i] = 1;
        ctx.rough[i] = 1;
      } else {
        ctx.setColor(i, [1, 0.8, 0.4]);
        ctx.emit[i] = 1;
      }
    });
  },

  glowstone: (ctx) => {
    ctx.normalStrength = 2.5;
    ctx.each((u, v, i) => {
      const w = ctx.worley(u, v, 6, 1);
      const w2 = ctx.worley(u + 0.3, v + 0.1, 13, 1);
      const t = ctx.hashf(w.id);
      const bright = smoothstep(0.5, 0.0, w.f1) * (0.6 + t * 0.4) + smoothstep(0.3, 0, w2.f1) * 0.3;
      const c = mixColor(hex(0x8a6232), hex(0xffe39a), clamp(bright, 0, 1));
      ctx.setColor(i, c);
      ctx.emit[i] = clamp(bright * 1.2, 0.15, 1);
      ctx.h[i] = smoothstep(0, 0.3, w.f2 - w.f1) * 0.6 + bright * 0.2;
      ctx.rough[i] = 0.35;
    });
  },

  lava: (ctx) => {
    ctx.normalStrength = 1.6;
    ctx.each((u, v, i) => {
      const n = ctx.fbm(u, v, 3, 5);
      const w = ctx.worley(u + n * 0.08, v, 4, 1);
      const crust = smoothstep(0.25, 0.45, w.f1 + n * 0.25);
      const hot = 1 - crust;
      const c = mixColor(hex(0xffd35a), hex(0xd2410c), clamp(0.4 + n, 0, 1));
      ctx.setColor(i, mixColor(c, hex(0x3a1a0c), crust * 0.85));
      ctx.emit[i] = 0.25 + hot * 0.75;
      ctx.h[i] = crust * 0.5 + n * 0.1;
      ctx.rough[i] = 0.3 + crust * 0.6;
    });
  },

  tall_grass: (ctx) => {
    crossPlantBase(ctx);
    const s = ctx.size, k = s / 128;
    for (let b = 0; b < 46; b++) {
      const x = (0.08 + ctx.rng() * 0.84) * s;
      const h = (0.35 + ctx.rng() * 0.6) * s;
      const bend = (ctx.rng() - 0.5) * 22 * k;
      const lum = 0.5 + ctx.rng() * 0.45;
      const w = (1.6 + ctx.rng() * 1.6) * k;
      const x1 = x + bend, y1 = s - h;
      const segs = 6;
      for (let sgi = 0; sgi < segs; sgi++) {
        const t0 = sgi / segs, t1 = (sgi + 1) / segs;
        const xa = x + bend * t0 * t0, ya = s - h * t0;
        const xb = x + bend * t1 * t1, yb = s - h * t1;
        ctx.stroke(xa, ya, xb, yb, w * (1 - t0 * 0.85), w * (1 - t1 * 0.85), (i, cov, tt) => {
          if (cov < 0.35) return;
          const t = t0 + (t1 - t0) * tt;
          const l = lum * (0.55 + t * 0.55);
          ctx.setColor(i, [l * 0.98, l, l * 0.92]);
          ctx.a[i] = 1;
        }, false);
      }
      void x1; void y1;
    }
  },

  fern: (ctx) => {
    crossPlantBase(ctx);
    const s = ctx.size, k = s / 128;
    for (let f = 0; f < 7; f++) {
      const bx = (0.3 + ctx.rng() * 0.4) * s;
      const ang = -Math.PI / 2 + (ctx.rng() - 0.5) * 1.4;
      const len = (0.55 + ctx.rng() * 0.4) * s;
      const ex = bx + Math.cos(ang) * len, ey = s + Math.sin(ang) * len;
      ctx.stroke(bx, s, ex, ey, 1.2 * k, 0.5 * k, (i, cov) => {
        if (cov < 0.4) return;
        ctx.setColor(i, [0.35, 0.42, 0.3]); ctx.a[i] = 1;
      }, false);
      for (let l = 1; l < 14; l++) {
        const t = l / 14;
        const px = bx + (ex - bx) * t, py = s + (ey - s) * t;
        const ll = (1 - t) * 13 * k + 3 * k;
        for (const side of [-1, 1]) {
          const la = ang + side * 1.25;
          ctx.stroke(px, py, px + Math.cos(la) * ll, py + Math.sin(la) * ll, 1.6 * k, 0.4 * k, (i, cov) => {
            if (cov < 0.4) return;
            const lum = 0.6 + t * 0.3;
            ctx.setColor(i, [lum * 0.9, lum, lum * 0.85]); ctx.a[i] = 1;
          }, false);
        }
      }
    }
  },

  dandelion: (ctx) => flower(ctx, hex(0xf7d51e), hex(0xe0a800), 1),
  poppy: (ctx) => flower(ctx, hex(0xd8231f), hex(0x1a1410), 2),
  cornflower: (ctx) => flower(ctx, hex(0x4a6fe0), hex(0x28357a), 3),
  allium: (ctx) => flower(ctx, hex(0xb86be0), hex(0x7b3aa6), 4),

  dead_bush: (ctx) => {
    crossPlantBase(ctx);
    const s = ctx.size, k = s / 128;
    const branch = (x, y, a, l, w, d) => {
      const x1 = x + Math.cos(a) * l, y1 = y + Math.sin(a) * l;
      ctx.stroke(x, y, x1, y1, w, w * 0.6, (i, cov) => {
        if (cov < 0.4) return;
        ctx.setColor(i, mixColor(hex(0x8a6a3e), hex(0x5c4428), ctx.rng() * 0.5)); ctx.a[i] = 1;
      }, false);
      if (d > 0) {
        branch(x1, y1, a - 0.4 - ctx.rng() * 0.3, l * 0.7, w * 0.7, d - 1);
        branch(x1, y1, a + 0.4 + ctx.rng() * 0.3, l * 0.65, w * 0.7, d - 1);
      }
    };
    for (let b = 0; b < 3; b++) branch(s * (0.4 + ctx.rng() * 0.2), s, -Math.PI / 2 + (ctx.rng() - 0.5) * 1.2, 30 * k, 2.2 * k, 4);
  },

  sugar_cane: (ctx) => {
    crossPlantBase(ctx);
    const s = ctx.size, k = s / 128;
    for (const cx of [0.25, 0.52, 0.77]) {
      const x = (cx + (ctx.rng() - 0.5) * 0.05) * s;
      const w = 5.5 * k;
      ctx.each((u, v, i, px, py) => {
        const d = Math.abs(px + 0.5 - x);
        if (d > w) return;
        const seg = ((py + cx * 40) % (32 * k)) / (32 * k);
        const node = smoothstep(0.06, 0.0, Math.min(seg, 1 - seg));
        const shade = 0.75 + 0.35 * Math.cos((d / w) * 1.4);
        const c = mixColor(hex(0x9ccf6a), hex(0x6e9e45), node + (1 - shade) * 0.5).map((q) => q * shade);
        ctx.setColor(i, c);
        ctx.a[i] = 1;
      });
    }
    for (let l = 0; l < 6; l++) {
      const x = s * (0.2 + ctx.rng() * 0.6), y = s * ctx.rng(), a = (ctx.rng() > 0.5 ? -0.5 : -2.6) + (ctx.rng() - 0.5) * 0.4;
      ctx.stroke(x, y, x + Math.cos(a) * 30 * k, y + Math.sin(a) * 30 * k, 2.5 * k, 0.5 * k, (i, cov) => {
        if (cov < 0.4) return;
        ctx.setColor(i, hex(0x86b85a)); ctx.a[i] = 1;
      }, false);
    }
  },

  cactus_side: (ctx) => {
    const s = ctx.size;
    ctx.normalStrength = 2.4;
    ctx.each((u, v, i, x, y) => {
      const rib = Math.cos(u * Math.PI * 2 * 4) * 0.5 + 0.5;
      const n = ctx.fbm(u, v, 8, 3);
      const c = mixColor(hex(0x2f5c26), hex(0x5d8f3c), rib * 0.8 + n * 0.2);
      ctx.setColor(i, c);
      ctx.h[i] = 0.3 + rib * 0.5 + n * 0.05;
      ctx.rough[i] = 0.55;
    });
    for (let sp = 0; sp < 40; sp++) {
      const col = Math.floor(ctx.rng() * 4);
      const x = (col + 0.5) / 4 * s, y = ctx.rng() * s;
      ctx.ellipse(x, y, 1.5 * s / 128, 1.5 * s / 128, 0, (i, cov) => {
        ctx.setColor(i, mixColor([ctx.r[i], ctx.g[i], ctx.b[i]], hex(0xe8e0c0), cov));
        ctx.h[i] += 0.2 * cov;
      });
    }
  },
  cactus_top: (ctx) => {
    ctx.normalStrength = 2;
    ctx.each((u, v, i) => {
      const dx = u - 0.5, dy = v - 0.5;
      const a = Math.atan2(dy, dx), d = Math.sqrt(dx * dx + dy * dy);
      const rib = Math.cos(a * 8) * 0.5 + 0.5;
      const c = mixColor(hex(0x3b6e2e), hex(0x6a9f46), rib * smoothstep(0.1, 0.45, d) + 0.2);
      ctx.setColor(i, c);
      ctx.h[i] = 0.5 + rib * 0.2 * smoothstep(0.1, 0.4, d);
      ctx.rough[i] = 0.55;
    });
  },

  pumpkin_side: (ctx) => {
    ctx.normalStrength = 2.5;
    ctx.each((u, v, i) => {
      const rib = Math.pow(Math.abs(Math.sin(u * Math.PI * 5)), 0.6);
      const n = ctx.fbm(u, v, 6, 3);
      const c = mixColor(hex(0xa4520f), hex(0xe38b22), rib * 0.8 + n * 0.2);
      ctx.setColor(i, c);
      ctx.h[i] = 0.3 + rib * 0.6;
      ctx.rough[i] = 0.45;
    });
  },
  pumpkin_top: (ctx) => {
    ctx.normalStrength = 2.0;
    ctx.each((u, v, i) => {
      const dx = u - 0.5, dy = v - 0.5;
      const a = Math.atan2(dy, dx), d = Math.sqrt(dx * dx + dy * dy);
      const rib = Math.pow(Math.abs(Math.sin(a * 5)), 0.6);
      let c = mixColor(hex(0xa4520f), hex(0xe38b22), rib * 0.8);
      const stem = smoothstep(0.1, 0.07, d);
      c = mixColor(c, hex(0x5b4a26), stem);
      ctx.setColor(i, c);
      ctx.h[i] = 0.3 + rib * 0.4 + stem * 0.5;
      ctx.rough[i] = 0.5;
    });
  },

  iron_block: (ctx) => paintMetalBlock(ctx, hex(0xd4d4d4), 0.32),
  gold_block: (ctx) => paintMetalBlock(ctx, hex(0xffd35c), 0.22),
  copper_block: (ctx) => paintMetalBlock(ctx, hex(0xe0875a), 0.3),
  diamond_block: (ctx) => {
    ctx.normalStrength = 3;
    ctx.each((u, v, i, x, y) => {
      const w = ctx.worley(u, v, 5, 1);
      const t = ctx.hashf(w.id);
      const facet = (w.cx - u) * 0.8 + (w.cy - v) * 0.4;
      const c = mixColor(hex(0x5fd7d0), hex(0xc8fff9), clamp(t * 0.6 + facet * 2 + 0.3, 0, 1));
      const e = Math.min(u, 1 - u, v, 1 - v) * ctx.size;
      ctx.setColor(i, c.map((k) => k * (e < 4 ? 0.7 : 1)));
      ctx.h[i] = 0.5 + facet * 1.2 + (e < 4 ? -0.2 : 0);
      ctx.rough[i] = 0.05 + smoothstep(0.03, 0, w.f2 - w.f1) * 0.3;
      ctx.emit[i] = 0.02;
    });
  },

  obsidian: (ctx) => {
    ctx.normalStrength = 1.8;
    ctx.each((u, v, i) => {
      const n = ctx.fbm(u, v, 4, 5);
      const w = ctx.worley(u, v, 7, 1);
      const sheen = smoothstep(0.2, 0.6, n + 0.3) * 0.5;
      const c = mixColor(hex(0x0f0b16), hex(0x3b2358), sheen);
      ctx.setColor(i, c);
      ctx.h[i] = 0.5 + n * 0.2 + smoothstep(0.05, 0.0, w.f2 - w.f1) * -0.2;
      ctx.rough[i] = 0.12 + smoothstep(0.05, 0.0, w.f2 - w.f1) * 0.4;
    });
  },

  white_wool: (ctx) => {
    ctx.normalStrength = 2;
    const s = ctx.size;
    ctx.each((u, v, i) => {
      const n = ctx.fbm(u, v, 8, 3);
      ctx.setColor(i, hex(0xe9e9e4).map((k) => k * (0.92 + n * 0.08)));
      ctx.h[i] = 0.5 + n * 0.1;
      ctx.rough[i] = 1;
    });
    for (let f = 0; f < 2600; f++) {
      const x = ctx.rng() * s, y = ctx.rng() * s, a = ctx.rng() * 6.28, l = 3 + ctx.rng() * 4;
      const lum = 0.8 + ctx.rng() * 0.2;
      ctx.stroke(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.6, 0.4, (i, cov) => {
        ctx.setColor(i, mixColor([ctx.r[i], ctx.g[i], ctx.b[i]], [lum * 0.92, lum * 0.92, lum * 0.9], cov * 0.6));
        ctx.h[i] = Math.max(ctx.h[i], 0.6 * cov + 0.3);
      });
    }
  },

  bookshelf: (ctx) => {
    const s = ctx.size;
    paintPlanks(ctx, hex(0xb38b56), hex(0x7a5a33));
    const shelfH = s / 2;
    const cols = [hex(0x7a2b20), hex(0x2b4f7a), hex(0x2f6b35), hex(0x8a6a2a), hex(0x5a3a6a), hex(0x3b3b3b), hex(0x9a4a1a)];
    for (let shelf = 0; shelf < 2; shelf++) {
      let x = s * 0.06;
      const y0 = shelf * shelfH + s * 0.07, y1 = (shelf + 1) * shelfH - s * 0.07;
      while (x < s * 0.94) {
        const w = (4 + ctx.rng() * 6) * s / 128;
        const h = (y1 - y0) * (0.75 + ctx.rng() * 0.25);
        const col = cols[Math.floor(ctx.rng() * cols.length)];
        for (let yy = Math.floor(y1 - h); yy < y1; yy++) {
          for (let xx = Math.floor(x); xx < Math.min(x + w - 1, s * 0.94); xx++) {
            const i = yy * s + xx;
            const band = (yy - (y1 - h)) / h;
            const deco = Math.abs(band - 0.2) < 0.03 || Math.abs(band - 0.8) < 0.03 ? 1.4 : 1;
            const rr = Math.sin(((xx - x) / w) * Math.PI) * 0.4 + 0.6;
            ctx.setColor(i, col.map((k) => clamp(k * rr * deco, 0, 1)));
            ctx.h[i] = 0.5 + rr * 0.3;
            ctx.rough[i] = 0.6;
          }
        }
        x += w;
      }
    }
  },

  moss_block: (ctx) => {
    ctx.normalStrength = 2.2;
    ctx.aoStrength = 1.5;
    ctx.each((u, v, i, x, y) => {
      const n = ctx.fbm(u, v, 6, 5);
      const w = ctx.worley(u, v, 20, 1);
      const tuft = smoothstep(0.5, 0.0, w.f1);
      const c = mixColor(hex(0x3f5a1f), hex(0x6b8a2e), clamp(tuft * 0.6 + n * 0.5 + 0.2, 0, 1));
      ctx.setColor(i, c.map((k) => k * (0.9 + (ctx.white(x, y) - 0.5) * 0.2)));
      ctx.h[i] = tuft * 0.5 + n * 0.2 + 0.2;
      ctx.rough[i] = 0.95;
    });
  },

  crafting_table_top: (ctx) => {
    paintPlanks(ctx, hex(0xa47a45), hex(0x6b4d2a));
    const s = ctx.size;
    ctx.each((u, v, i, x, y) => {
      const e = Math.min(x, y, s - 1 - x, s - 1 - y);
      if (e < 6 * s / 128) { ctx.setColor(i, hex(0x5c3f22)); ctx.h[i] = 0.8; }
      const gx = Math.abs(u - 0.5), gy = Math.abs(v - 0.5);
      if ((Math.abs(gx - 0.17) < 0.01 || Math.abs(gy - 0.17) < 0.01) && gx < 0.35 && gy < 0.35) { ctx.setColor(i, hex(0x3d2a16)); ctx.h[i] = 0.2; }
    });
  },
};

function flower(ctx, petal, center, kind) {
  crossPlantBase(ctx);
  const s = ctx.size, k = s / 128;
  const cx = s * 0.5, top = s * (0.35 + ctx.rng() * 0.1);
  // stem + leaves
  ctx.stroke(cx, s, cx + (ctx.rng() - 0.5) * 6 * k, top, 1.8 * k, 1.2 * k, (i, cov) => {
    if (cov < 0.4) return;
    ctx.setColor(i, hex(0x4f8a2f)); ctx.a[i] = 1;
  }, false);
  for (const side of [-1, 1]) {
    const ly = s * (0.7 + ctx.rng() * 0.15);
    ctx.ellipse(cx + side * 10 * k, ly, 11 * k, 3.5 * k, side * 0.5, (i, cov) => {
      if (cov < 0.5) return;
      ctx.setColor(i, hex(0x5c9a36)); ctx.a[i] = 1;
    }, false);
  }
  if (kind === 1) {
    // dandelion: fluffy ball of thin petals
    for (let p = 0; p < 60; p++) {
      const a = ctx.rng() * Math.PI * 2, r = (5 + ctx.rng() * 9) * k;
      ctx.stroke(cx, top, cx + Math.cos(a) * r, top + Math.sin(a) * r * 0.8, 1.4 * k, 0.8 * k, (i, cov) => {
        if (cov < 0.4) return;
        ctx.setColor(i, petal.map((q) => q * (0.85 + ctx.rng() * 0.2))); ctx.a[i] = 1; ctx.emit[i] = 0;
      }, false);
    }
  } else if (kind === 4) {
    for (let p = 0; p < 40; p++) {
      const a = ctx.rng() * Math.PI * 2, r = ctx.rng() * 12 * k;
      ctx.ellipse(cx + Math.cos(a) * r, top + Math.sin(a) * r, 2.5 * k, 2.5 * k, 0, (i, cov) => {
        if (cov < 0.5) return;
        ctx.setColor(i, mixColor(petal, center, ctx.rng() * 0.5)); ctx.a[i] = 1;
      }, false);
    }
  } else {
    const n = kind === 2 ? 4 : 7;
    for (let p = 0; p < n; p++) {
      const a = (p / n) * Math.PI * 2 + ctx.rng() * 0.3;
      const r = (kind === 2 ? 9 : 8) * k;
      ctx.ellipse(cx + Math.cos(a) * r * 0.8, top + Math.sin(a) * r * 0.6, r, r * (kind === 2 ? 0.75 : 0.45), a, (i, cov, lx) => {
        if (cov < 0.5) return;
        ctx.setColor(i, petal.map((q) => q * (0.75 + 0.3 * (1 - Math.abs(lx))))); ctx.a[i] = 1;
      }, false);
    }
    ctx.ellipse(cx, top, 3.5 * k, 3.5 * k, 0, (i, cov) => {
      if (cov < 0.5) return;
      ctx.setColor(i, center); ctx.a[i] = 1;
    }, false);
  }
}

export const TEXTURE_NAMES = Object.keys(TEXTURE_RECIPES);
