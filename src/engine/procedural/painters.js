// Reusable procedural PBR "painters" for TexCtx (see voxel/TextureSynth.js).
// Every painter produces seamless (tileable) albedo, height, roughness,
// metalness and cavity so textures can repeat across large surfaces.
import { hex, mixColor, clamp, smoothstep, lerp } from '../voxel/TextureSynth.js';

const col = (i, ctx) => [ctx.r[i], ctx.g[i], ctx.b[i]];

// ---------------------------------------------------------------------------
// Natural ground
// ---------------------------------------------------------------------------

/** Meadow grass seen from above: multi-scale color, blade strokes, clover, bare spots. */
export function paintGrass(ctx, o = {}) {
  const dark = hex(o.dark ?? 0x2c3d16), mid = hex(o.mid ?? 0x4e6224), light = hex(o.light ?? 0x70803a), dry = hex(o.dry ?? 0x8a8445);
  const s = ctx.size, k = s / 256;
  ctx.normalStrength = o.normal ?? 1.3;
  ctx.aoStrength = 1.2;
  ctx.each((u, v, i) => {
    const n1 = ctx.fbm(u, v, 2, 4), n2 = ctx.fbm(u + 0.3, v + 0.7, 6, 3), n3 = ctx.fbm(u, v, 18, 2);
    let c = mixColor(dark, mid, clamp(0.55 + n1 * 0.8 + n3 * 0.3, 0, 1));
    c = mixColor(c, dry, smoothstep(0.15, 0.55, n2) * (o.dryness ?? 0.35));
    ctx.setColor(i, c);
    ctx.h[i] = 0.3 + n3 * 0.1;
    ctx.rough[i] = 0.85;
  });
  const blades = Math.round((o.blades ?? 5200) * k * k);
  for (let b = 0; b < blades; b++) {
    const x = ctx.rng() * s, y = ctx.rng() * s;
    const a = (o.lean ?? 0) + (ctx.rng() - 0.5) * Math.PI * 1.4;
    const len = (3 + ctx.rng() * 7) * k;
    const t = ctx.rng();
    const bc = t < 0.12 ? dry : t < 0.55 ? mid : light;
    const lum = 0.75 + ctx.rng() * 0.45;
    ctx.stroke(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 0.9 * k, 0.3 * k, (i, cov, tt) => {
      const l = lum * (0.8 + tt * 0.35);
      ctx.r[i] = lerp(ctx.r[i], bc[0] * l, cov);
      ctx.g[i] = lerp(ctx.g[i], bc[1] * l, cov);
      ctx.b[i] = lerp(ctx.b[i], bc[2] * l, cov);
      ctx.h[i] = Math.max(ctx.h[i], lerp(ctx.h[i], 0.45 + tt * 0.45, cov));
    });
  }
  // clover / tiny flowers
  const flowers = Math.round((o.flowers ?? 60) * k * k);
  for (let f = 0; f < flowers; f++) {
    const x = ctx.rng() * s, y = ctx.rng() * s;
    const fc = ctx.rng() < 0.6 ? hex(0xe8e4d0) : ctx.rng() < 0.5 ? hex(0xd8c040) : hex(0xa070c0);
    ctx.ellipse(x, y, 1.3 * k, 1.3 * k, 0, (i, cov) => {
      ctx.setColor(i, mixColor(col(i, ctx), fc, cov * 0.9));
      ctx.h[i] = Math.max(ctx.h[i], 0.8 * cov);
    });
  }
  // bare soil spots
  if (o.bare) {
    ctx.each((u, v, i) => {
      const b = smoothstep(0.35, 0.6, ctx.fbm(u + 1.3, v, 5, 3)) * o.bare;
      if (b > 0) {
        ctx.setColor(i, mixColor(col(i, ctx), hex(0x5a4631), b));
        ctx.h[i] = lerp(ctx.h[i], 0.25, b);
      }
    });
  }
}

/** Bare soil with clods and small stones. */
export function paintSoil(ctx, o = {}) {
  const base = hex(o.base ?? 0x5f4733), dark = hex(o.dark ?? 0x3a2b1f);
  ctx.normalStrength = o.normal ?? 2.0;
  ctx.aoStrength = 1.4;
  ctx.each((u, v, i, x, y) => {
    const n = ctx.fbm(u, v, 3, 5, 0.6);
    const humus = smoothstep(-0.1, 0.5, ctx.fbm(u + 0.5, v + 0.2, 4, 3));
    const clod = ctx.worley(u, v, o.clods ?? 28, 1);
    const clodH = (1 - clod.f1) * 0.6 * (0.6 + ctx.hashf(clod.id) * 0.4);
    const peb = ctx.worley(u, v, o.pebbles ?? 16, 1);
    const pebble = smoothstep(0.26, 0.19, peb.f1 + ctx.fbm(u, v, 32, 2) * 0.1) * (ctx.hashf(peb.id) > (o.pebbleRarity ?? 0.8) ? 1 : 0);
    const pcol = mixColor(hex(0x7a7166), hex(0x4d443c), ctx.hashf(peb.id, 3));
    const grain = (ctx.white(x, y) - 0.5) * 0.12;
    let c = mixColor(base, dark, humus * 0.5 + (0.5 - n * 0.5) * 0.25);
    c = c.map((q) => q * (0.9 + clodH * 0.25) * (1 + grain));
    c = mixColor(c, pcol, pebble);
    ctx.setColor(i, c);
    ctx.h[i] = 0.35 + clodH * 0.3 + n * 0.15 + pebble * 0.35;
    ctx.rough[i] = (o.rough ?? 0.95) - pebble * 0.15;
  });
}

/** Forest floor: fallen leaves, needles, twigs and moss. */
export function paintForestFloor(ctx, o = {}) {
  paintSoil(ctx, { base: 0x4a3826, dark: 0x2a2018, pebbleRarity: 0.95 });
  const s = ctx.size, k = s / 256;
  const leafCols = [hex(0x7a4a20), hex(0x8e6a2a), hex(0x5a3a1c), hex(0x6b5a28), hex(0x9a5a22)];
  for (let l = 0; l < 1300 * k * k; l++) {
    const x = ctx.rng() * s, y = ctx.rng() * s, a = ctx.rng() * Math.PI;
    const len = (4 + ctx.rng() * 6) * k;
    const c = leafCols[Math.floor(ctx.rng() * leafCols.length)].map((q) => q * (0.7 + ctx.rng() * 0.5));
    const hh = 0.5 + ctx.rng() * 0.4;
    ctx.ellipse(x, y, len / 2, len * 0.28, a, (i, cov, lx, ly) => {
      if (cov < 0.4) return;
      const dome = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly));
      ctx.setColor(i, c.map((q) => q * (0.85 + dome * 0.2)));
      ctx.h[i] = Math.max(ctx.h[i], hh + dome * 0.1);
      ctx.rough[i] = 0.8;
    });
  }
  for (let t = 0; t < 60 * k * k; t++) {
    const x = ctx.rng() * s, y = ctx.rng() * s, a = ctx.rng() * Math.PI * 2, len = (8 + ctx.rng() * 20) * k;
    ctx.stroke(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 0.9 * k, 0.6 * k, (i, cov) => {
      ctx.setColor(i, mixColor(col(i, ctx), hex(0x3b2b1c), cov));
      ctx.h[i] = Math.max(ctx.h[i], 0.85 * cov);
    });
  }
  ctx.each((u, v, i) => {
    const m = smoothstep(0.25, 0.6, ctx.fbm(u + 2.1, v, 4, 4)) * (o.moss ?? 0.6);
    if (m > 0) { ctx.setColor(i, mixColor(col(i, ctx), hex(0x3c4c1c), m)); ctx.rough[i] = lerp(ctx.rough[i], 0.95, m); }
  });
}

export function paintSand(ctx, o = {}) {
  const base = hex(o.base ?? 0xc9b58a);
  ctx.normalStrength = o.normal ?? 1.2;
  ctx.each((u, v, i, x, y) => {
    const n = ctx.fbm(u, v, 3, 4);
    const rip = Math.sin((u * 7 + v * 3 + ctx.fbm(u, v, 2, 2) * 0.9) * Math.PI * 2) * 0.5 + 0.5;
    const g = ctx.white(x, y);
    let c = base.map((q) => q * (1 + n * 0.07 + (g - 0.5) * 0.12));
    if (g > 0.994) c = hex(0x6d6558);
    ctx.setColor(i, c);
    ctx.h[i] = 0.5 + rip * 0.14 * (o.ripples ?? 1) + (g - 0.5) * 0.1 + n * 0.1;
    ctx.rough[i] = 0.92;
  });
}

/** Weathered cliff rock with strata, cracks and lichen. */
export function paintRock(ctx, o = {}) {
  // natural weathered rock: large warped plates, faceted surface, broken cracks, strata and lichen
  const base = hex(o.base ?? 0x7a756d), dark = hex(o.dark ?? 0x3e3a35);
  ctx.normalStrength = o.normal ?? 2.4;
  ctx.aoStrength = 1.6;
  ctx.each((u, v, i, x, y) => {
    const wu = u + ctx.fbm(u, v, 3, 3) * 0.07, wv = v + ctx.fbm(u + 0.37, v + 0.61, 3, 3) * 0.07;
    let w = ctx.worley(wu, wv, o.plates ?? 3, 1);
    const edge = w.f2 - w.f1, plateId = w.id;
    w = ctx.worley(u, v, 11, 1);
    const facet = ctx.hashf(w.id, 7), facetEdge = w.f2 - w.f1;
    const strata = Math.sin((wv + ctx.fbm(u, v, 2, 2) * 0.05) * Math.PI * 2 * (o.layers ?? 7)) * 0.5 + 0.5;
    const n = ctx.fbm(u, v, 5, 5, 0.55);
    const broken = smoothstep(0.35, 0.6, ctx.fbm(u + 1.7, v, 9, 2));
    const crack = smoothstep(0.03, 0.0, edge) * broken + smoothstep(0.012, 0.0, facetEdge) * 0.25;
    const grain = (ctx.white(x, y) - 0.5) * 0.08;
    let c = mixColor(dark, base, clamp(0.5 + n * 0.55 + strata * 0.12 + ctx.hashf(plateId) * 0.1 + facet * 0.08, 0, 1));
    c = c.map((q) => q * (1 + grain) * (1 - crack * 0.35));
    const lichen = smoothstep(0.4, 0.72, ctx.fbm(u + 3.3, v, 6, 3)) * (o.lichen ?? 0.35);
    if (lichen > 0) c = mixColor(c, hex(0x7c8250), lichen * (1 - crack));
    ctx.setColor(i, c);
    ctx.h[i] = 0.35 + ctx.hashf(plateId, 3) * 0.12 + facet * 0.12 + n * 0.3 + strata * 0.06 - crack * 0.3;
    ctx.rough[i] = 0.8 + crack * 0.1;
  });
}

export function paintMud(ctx, o = {}) {
  paintSoil(ctx, { base: o.base ?? 0x44372a, dark: 0x271f18, pebbleRarity: 0.93, rough: 0.6 });
  ctx.each((u, v, i) => {
    const puddle = smoothstep(0.3, 0.55, ctx.fbm(u, v, 3, 4));
    if (puddle > 0) {
      ctx.setColor(i, col(i, ctx).map((q) => q * (1 - puddle * 0.35)));
      ctx.rough[i] = lerp(ctx.rough[i], 0.08, puddle);
      ctx.h[i] = lerp(ctx.h[i], 0.2, puddle);
    }
  });
}

/** Compacted path / building ground with embedded stones and wheel ruts. */
export function paintPath(ctx, o = {}) {
  paintSoil(ctx, { base: o.base ?? 0x7a6650, dark: 0x4a3d30, pebbles: 22, pebbleRarity: 0.6, clods: 40 });
  ctx.each((u, v, i) => {
    const straw = ctx.fbm(u * 1.0, v, 20, 2);
    if (straw > 0.55) ctx.setColor(i, mixColor(col(i, ctx), hex(0xb09a5a), (straw - 0.55) * 1.5));
  });
}

/** Ploughed farmland furrows. */
export function paintFarmland(ctx) {
  paintSoil(ctx, { base: 0x5a4230, dark: 0x2f2319, pebbleRarity: 0.95 });
  ctx.each((u, v, i) => {
    const f = Math.sin(v * Math.PI * 2 * 8 + ctx.fbm(u, v, 3, 2) * 0.6) * 0.5 + 0.5;
    ctx.h[i] = ctx.h[i] * 0.5 + f * 0.5;
    ctx.setColor(i, col(i, ctx).map((q) => q * (0.8 + f * 0.3)));
  });
}

// ---------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------

/** Rubble / ashlar stone masonry. `rows` stone courses per tile. */
export function paintMasonry(ctx, o = {}) {
  const rows = o.rows ?? 6;
  const s = ctx.size;
  ctx.normalStrength = o.normal ?? 2.6;
  ctx.aoStrength = 2.0;
  const mortar = hex(o.mortar ?? 0x8a8276);
  ctx.each((u, v, i, x, y) => {
    const row = Math.floor(v * rows);
    const rv = v * rows - row;
    const jit = ctx.hashf(row, 5);
    const cols = Math.max(2, Math.round(rows * (o.aspect ?? 0.55)));
    const uu = (u + jit) % 1;
    const cw = uu * cols;
    const c = Math.floor(cw + ctx.fbm(u, v, 4, 2) * 0.15);
    const cu = cw - c;
    const id = row * 131 + ((c % cols) + cols) % cols;
    const e = Math.min(Math.min(cu, 1 - cu) / cols * s * 0.5, Math.min(rv, 1 - rv) / rows * s);
    const inStone = smoothstep(1.2, 3.2, e + ctx.fbm(u, v, 16, 2) * 1.5);
    const tone = 0.8 + ctx.hashf(id) * 0.35;
    const n = ctx.fbm(u + id * 0.013, v, 12, 3);
    const baseC = mixColor(hex(o.stone ?? 0x9a9284), hex(o.stone2 ?? 0x7e7466), ctx.hashf(id, 2));
    const stoneC = baseC.map((q) => q * tone * (1 + n * 0.12));
    const dirt = smoothstep(0.7, 1.0, v) * (o.grime ?? 0.25);
    let cc = mixColor(mortar.map((q) => q * (0.85 + n * 0.1)), stoneC, inStone);
    cc = cc.map((q) => q * (1 - dirt * 0.5));
    ctx.setColor(i, cc);
    ctx.h[i] = 0.2 + inStone * (0.5 + smoothstep(0, 8, e) * 0.2) + n * 0.08;
    ctx.rough[i] = lerp(0.95, 0.82, inStone);
  });
}

/** Lime-washed plaster with stains and damage exposing brick/stone. */
export function paintPlaster(ctx, o = {}) {
  const base = hex(o.base ?? 0xd9d0bc);
  ctx.normalStrength = o.normal ?? 1.1;
  ctx.aoStrength = 0.8;
  ctx.each((u, v, i, x, y) => {
    const n = ctx.fbm(u, v, 4, 5);
    const stain = smoothstep(0.2, 0.7, ctx.fbm(u + 1.7, v * 0.5, 3, 4)) * 0.18;
    const drip = smoothstep(0.6, 0.95, ctx.aniso(u, v, 12, 1, 3)) * 0.12;
    const chip = smoothstep(0.62, 0.7, ctx.fbm(u + 4.2, v + 1.1, 5, 4));
    let c = base.map((q) => q * (0.95 + n * 0.06 - stain - drip + (ctx.white(x, y) - 0.5) * 0.03));
    c = mixColor(c, hex(o.under ?? 0x8f7d68), chip * 0.85);
    ctx.setColor(i, c);
    ctx.h[i] = 0.6 + n * 0.08 - chip * 0.25;
    ctx.rough[i] = 0.9;
  });
}

/** Vertical or horizontal wooden planks with grain and knots. */
export function paintPlanks(ctx, o = {}) {
  const boards = o.boards ?? 6;
  const base = hex(o.base ?? 0x7a5a3a), dark = hex(o.dark ?? 0x4a3422);
  const s = ctx.size;
  const vertical = o.vertical !== false;
  ctx.normalStrength = o.normal ?? 1.8;
  ctx.aoStrength = 1.5;
  ctx.each((u, v, i) => {
    const a = vertical ? u : v, b = vertical ? v : u;
    const bi = Math.floor(a * boards);
    const ba = a * boards - bi;
    const grain = vertical ? ctx.aniso(u + ctx.hashf(bi) * 3.1, v, 24, 2, 4, 0.55) : ctx.aniso(u, v + ctx.hashf(bi) * 3.1, 2, 24, 4, 0.55);
    const rings = Math.sin((ba * 7 + grain * 5 + ctx.hashf(bi, 2) * 9) * 1.4) * 0.5 + 0.5;
    const knot = ctx.worley(u, v, 4, 1);
    const k = smoothstep(0.12, 0.0, knot.f1) * (ctx.hashf(knot.id) > 0.7 ? 1 : 0);
    const tone = 0.85 + ctx.hashf(bi, 5) * 0.3;
    const weather = smoothstep(0.2, 0.8, ctx.fbm(u, v, 3, 3)) * (o.weathered ?? 0.3);
    let c = mixColor(base, dark, clamp(rings * 0.35 + grain * 0.5 + 0.2 + k * 0.6, 0, 1)).map((q) => q * tone);
    c = mixColor(c, hex(0x7d7870), weather);
    const gap = Math.min(ba, 1 - ba) * s / boards;
    const edge = smoothstep(0, 1.6, gap);
    c = c.map((q) => q * (0.3 + 0.7 * edge));
    ctx.setColor(i, c);
    ctx.h[i] = 0.4 + edge * 0.4 + grain * 0.06 - k * 0.1;
    ctx.rough[i] = 0.75 + weather * 0.15;
    void b;
  });
}

/** Clay roof tiles in overlapping rows. */
export function paintRoofTiles(ctx, o = {}) {
  const rows = o.rows ?? 8, cols = o.cols ?? 6;
  const s = ctx.size;
  ctx.normalStrength = o.normal ?? 3.0;
  ctx.aoStrength = 2.0;
  ctx.each((u, v, i) => {
    const row = Math.floor(v * rows);
    const rv = v * rows - row;
    const off = (row % 2) * 0.5;
    const cu = (u * cols + off) % 1;
    const c = Math.floor(u * cols + off);
    const id = row * 97 + c;
    const curve = Math.sin(cu * Math.PI);
    const lip = smoothstep(0.75, 1.0, rv);
    const tone = 0.8 + ctx.hashf(id) * 0.35;
    const n = ctx.fbm(u, v, 10, 3);
    const moss = smoothstep(0.45, 0.75, ctx.fbm(u + 2, v, 4, 3)) * (o.moss ?? 0.2);
    let cc = mixColor(hex(o.base ?? 0x9a4a2c), hex(o.base2 ?? 0x7a3a22), ctx.hashf(id, 3)).map((q) => q * tone * (0.75 + curve * 0.35) * (1 + n * 0.1));
    cc = cc.map((q) => q * (1 - lip * 0.55));
    cc = mixColor(cc, hex(0x55603a), moss);
    ctx.setColor(i, cc);
    ctx.h[i] = curve * 0.5 + (1 - rv) * 0.35 + n * 0.05;
    ctx.rough[i] = 0.7 + moss * 0.25;
  });
  void s;
}

/** Straw thatch. */
export function paintThatch(ctx, o = {}) {
  const s = ctx.size, k = s / 256;
  ctx.normalStrength = o.normal ?? 2.2;
  ctx.aoStrength = 1.6;
  ctx.each((u, v, i) => {
    const n = ctx.fbm(u, v, 4, 3);
    ctx.setColor(i, hex(0x6e5a34).map((q) => q * (0.9 + n * 0.2)));
    ctx.h[i] = 0.3;
    ctx.rough[i] = 0.95;
  });
  for (let st = 0; st < 5200 * k * k; st++) {
    const x = ctx.rng() * s, y = ctx.rng() * s;
    const len = (14 + ctx.rng() * 22) * k;
    const a = Math.PI / 2 + (ctx.rng() - 0.5) * 0.25;
    const t = ctx.rng();
    const c = t < 0.3 ? hex(0xb89a5a) : t < 0.7 ? hex(0x9a7e46) : hex(0x6f5c36);
    const lum = 0.8 + ctx.rng() * 0.35;
    ctx.stroke(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 0.9 * k, 0.6 * k, (i, cov, tt) => {
      ctx.setColor(i, mixColor(col(i, ctx), c.map((q) => q * lum * (0.85 + tt * 0.2)), cov));
      ctx.h[i] = Math.max(ctx.h[i], 0.4 + tt * 0.4 + ctx.rng() * 0.05);
    });
  }
  ctx.each((u, v, i) => {
    const course = Math.sin(v * Math.PI * 2 * (o.courses ?? 5)) * 0.5 + 0.5;
    ctx.setColor(i, col(i, ctx).map((q) => q * (0.75 + course * 0.3)));
    ctx.h[i] = ctx.h[i] * 0.7 + course * 0.3;
    const moss = smoothstep(0.5, 0.8, ctx.fbm(u + 1.2, v, 3, 3)) * 0.25;
    if (moss > 0) ctx.setColor(i, mixColor(col(i, ctx), hex(0x4d5530), moss));
  });
}

/** Wood shingles. */
export function paintShingles(ctx, o = {}) {
  const rows = o.rows ?? 10, cols = o.cols ?? 7;
  ctx.normalStrength = 2.6;
  ctx.aoStrength = 1.8;
  ctx.each((u, v, i) => {
    const row = Math.floor(v * rows), rv = v * rows - row;
    const off = ctx.hashf(row, 9) * 0.6;
    const cw = (u * cols + off);
    const c = Math.floor(cw), cu = cw - c;
    const id = row * 71 + c;
    const edge = smoothstep(0.0, 0.06, Math.min(cu, 1 - cu));
    const grain = ctx.aniso(u + id * 0.1, v, 30, 3, 3, 0.5);
    const tone = 0.75 + ctx.hashf(id) * 0.4;
    let cc = mixColor(hex(0x6a5540), hex(0x4a4038), ctx.hashf(id, 2)).map((q) => q * tone * (1 + grain * 0.15));
    cc = cc.map((q) => q * (0.5 + 0.5 * edge) * (1 - smoothstep(0.8, 1, rv) * 0.5));
    ctx.setColor(i, cc);
    ctx.h[i] = (1 - rv) * 0.5 + edge * 0.3 + grain * 0.05;
    ctx.rough[i] = 0.85;
  });
}

/** Woven cloth (banners, tents). Neutral light color, tinted by the material. */
export function paintCloth(ctx) {
  const s = ctx.size;
  ctx.normalStrength = 0.8;
  ctx.each((u, v, i, x, y) => {
    const weave = (Math.sin(x * Math.PI * 0.5) * Math.sin(y * Math.PI * 0.5)) * 0.5 + 0.5;
    const n = ctx.fbm(u, v, 4, 3);
    const l = 0.82 + weave * 0.08 + n * 0.08;
    ctx.setColor(i, [l, l, l]);
    ctx.h[i] = 0.5 + weave * 0.2;
    ctx.rough[i] = 0.95;
  });
  void s;
}

// ---------------------------------------------------------------------------
// Vegetation
// ---------------------------------------------------------------------------

export function paintBark(ctx, o = {}) {
  const base = hex(o.base ?? 0x5a4634), dark = hex(o.dark ?? 0x221910);
  ctx.normalStrength = o.normal ?? 3.0;
  ctx.aoStrength = 1.8;
  const pu = o.pu ?? 10, pv = o.pv ?? 2;
  ctx.each((u, v, i, x, y) => {
    const wu = u + ctx.fbm(u, v, 4, 3) * 0.035;
    const ridge = 1 - Math.abs(ctx.aniso(wu, v, pu, pv, 4, 0.5));
    const fissure = smoothstep(0.76, 0.97, ridge);
    const plate = ctx.aniso(wu + 0.3, v, Math.max(2, pu >> 1), pv + 1, 3, 0.5);
    const cross = smoothstep(0.9, 0.99, 1 - Math.abs(ctx.aniso(u, v + 0.17, 4, 10, 2, 0.5))) * (1 - fissure);
    const fine = ctx.fbm(u, v, 24, 2) * 0.08 + (ctx.white(x, y) - 0.5) * 0.08;
    const lichen = smoothstep(0.4, 0.75, ctx.fbm(u + 1.7, v, 3, 4)) * (o.lichen ?? 0.35);
    let c = mixColor(base, dark, clamp(fissure * 0.9 + cross * 0.5 + (0.5 - plate) * 0.25, 0, 1)).map((q) => q * (1 + fine));
    if (lichen > 0) c = mixColor(c, hex(0x6e7650), lichen * (1 - fissure));
    ctx.setColor(i, c);
    ctx.h[i] = 0.55 + plate * 0.18 - fissure * 0.5 - cross * 0.2 + fine * 0.3;
    ctx.rough[i] = 0.9;
  });
}

/**
 * A cluster of leaves on a transparent background (for foliage cards).
 * Leaves radiate from small twigs so the card reads as a branch tip.
 */
export function paintLeafCluster(ctx, o = {}) {
  const s = ctx.size, k = s / 256;
  ctx.normalStrength = 1.8;
  ctx.aoStrength = 0.9;
  ctx.a.fill(0);
  ctx.h.fill(0);
  const base = o.base ?? [0.34, 0.45, 0.16];
  ctx.each((u, v, i) => { ctx.setColor(i, base.map((q) => q * 0.35)); ctx.rough[i] = 0.6; });
  const clusters = o.clusters ?? 7;
  for (let c = 0; c < clusters; c++) {
    const cx = s * (0.2 + ctx.rng() * 0.6), cy = s * (0.2 + ctx.rng() * 0.6);
    const R = s * (0.16 + ctx.rng() * 0.12);
    // twig
    const ta = ctx.rng() * Math.PI * 2;
    ctx.stroke(cx - Math.cos(ta) * R, cy - Math.sin(ta) * R, cx, cy, 1.6 * k, 0.8 * k, (i, cov) => {
      if (cov < 0.4) return;
      ctx.a[i] = 1; ctx.setColor(i, hex(0x4a3824)); ctx.h[i] = Math.max(ctx.h[i], 0.2);
    }, false);
    const n = Math.round((o.leaves ?? 38) * (0.8 + ctx.rng() * 0.4));
    for (let l = 0; l < n; l++) {
      const a = ctx.rng() * Math.PI * 2;
      const r = Math.sqrt(ctx.rng()) * R;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const len = (o.len ?? 16) * k * (0.7 + ctx.rng() * 0.6);
      const wid = len * (o.width ?? 0.45);
      const ang = a + (ctx.rng() - 0.5) * 1.2;
      const shade = 0.6 + ctx.rng() * 0.5 + (r / R) * 0.15;
      const hue = (ctx.rng() - 0.5) * (o.hue ?? 0.18);
      const hh = 0.3 + ctx.rng() * 0.6;
      ctx.ellipse(x, y, len / 2, wid / 2, ang, (i, cov, lx, ly) => {
        if (cov < 0.5) return;
        const dome = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly));
        const hNew = hh + dome * 0.3;
        if (ctx.a[i] > 0 && ctx.h[i] > hNew) return;
        const vein = smoothstep(0.1, 0.0, Math.abs(ly)) * 0.15;
        const lum = shade * (0.8 + dome * 0.3 + lx * 0.06) * (1 - vein);
        ctx.r[i] = base[0] * lum * (1 + hue);
        ctx.g[i] = base[1] * lum;
        ctx.b[i] = base[2] * lum * (1 - hue);
        ctx.a[i] = 1;
        ctx.h[i] = hNew;
        ctx.rough[i] = 0.45 + (1 - dome) * 0.2;
      }, false);
    }
  }
}

/** Pine needle sprays on a transparent background. */
export function paintNeedleCluster(ctx, o = {}) {
  const s = ctx.size, k = s / 256;
  ctx.normalStrength = 1.4;
  ctx.a.fill(0);
  ctx.h.fill(0);
  const base = o.base ?? [0.16, 0.27, 0.17];
  ctx.each((u, v, i) => { ctx.setColor(i, base.map((q) => q * 0.4)); ctx.rough[i] = 0.55; });
  for (let b = 0; b < (o.branches ?? 9); b++) {
    const x0 = s * (0.15 + ctx.rng() * 0.7), y0 = s * (0.15 + ctx.rng() * 0.7);
    const a = ctx.rng() * Math.PI * 2, L = s * (0.22 + ctx.rng() * 0.2);
    const x1 = x0 + Math.cos(a) * L, y1 = y0 + Math.sin(a) * L;
    ctx.stroke(x0, y0, x1, y1, 1.5 * k, 0.8 * k, (i, cov) => {
      if (cov < 0.4) return;
      ctx.a[i] = 1; ctx.setColor(i, hex(0x3a2a1c)); ctx.h[i] = 0.2;
    }, false);
    const count = Math.round(L / k * 2.2);
    for (let nIdx = 0; nIdx < count; nIdx++) {
      const t = ctx.rng();
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      const side = ctx.rng() > 0.5 ? 1 : -1;
      const na = a + side * (0.5 + ctx.rng() * 0.5);
      const nl = (7 + ctx.rng() * 7) * k * (1 - t * 0.4);
      const lum = 0.7 + ctx.rng() * 0.55;
      ctx.stroke(px, py, px + Math.cos(na) * nl, py + Math.sin(na) * nl, 0.8 * k, 0.45 * k, (i, cov, tt) => {
        if (cov < 0.45) return;
        ctx.a[i] = 1;
        ctx.setColor(i, base.map((q) => q * lum * (0.85 + tt * 0.35)));
        ctx.h[i] = 0.4 + tt * 0.35;
      }, false);
    }
  }
}

/** Grass tuft card: blades rising from the bottom edge (for instanced ground cover). */
export function paintGrassTuft(ctx, o = {}) {
  const s = ctx.size, k = s / 256;
  ctx.a.fill(0);
  ctx.flatNormals = true;
  ctx.aoStrength = 0;
  const base = o.base ?? [0.3, 0.42, 0.14];
  for (let b = 0; b < (o.blades ?? 70); b++) {
    const x = (0.06 + ctx.rng() * 0.88) * s;
    const h = (0.35 + ctx.rng() * 0.62) * s;
    const bend = (ctx.rng() - 0.5) * 60 * k;
    const w = (2.5 + ctx.rng() * 3) * k;
    const lum = 0.62 + ctx.rng() * 0.45;
    const dry = ctx.rng() < (o.dry ?? 0.12);
    const segs = 8;
    for (let sg = 0; sg < segs; sg++) {
      const t0 = sg / segs, t1 = (sg + 1) / segs;
      ctx.stroke(x + bend * t0 * t0, s - h * t0, x + bend * t1 * t1, s - h * t1, w * (1 - t0 * 0.85), w * (1 - t1 * 0.85), (i, cov, tt) => {
        if (cov < 0.4) return;
        const t = t0 + (t1 - t0) * tt;
        const l = lum * (0.62 + t * 0.5);
        const c = dry ? [0.55 * l, 0.5 * l, 0.28 * l] : base.map((q) => q * l);
        ctx.setColor(i, c);
        ctx.a[i] = 1;
        ctx.rough[i] = 0.7;
      }, false);
    }
  }
}
