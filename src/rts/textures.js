// Procedural PBR textures for "Reinos" (terrain layers, architecture, vegetation).
import {
  paintGrass, paintSoil, paintForestFloor, paintSand, paintRock, paintMud, paintPath, paintFarmland,
  paintMasonry, paintPlaster, paintPlanks, paintRoofTiles, paintThatch, paintShingles, paintCloth,
  paintBark, paintLeafCluster, paintNeedleCluster, paintGrassTuft,
} from '../engine/procedural/painters.js';
import { hex, mixColor } from '../engine/voxel/TextureSynth.js';
import { smoothstep, clamp } from '../engine/math/noise.js';

export const TERRAIN_LAYERS = ['grass', 'grass_dry', 'dirt', 'forest', 'sand', 'rock', 'mud', 'path'];
export const TERRAIN_SCALES = [3.5, 3.5, 3.0, 3.2, 4.0, 7.0, 3.0, 3.0];

function paintOre(ctx, veinColor, metal) {
  paintRock(ctx, { base: 0x6d665d, dark: 0x35302a, layers: 3, lichen: 0.15 });
  ctx.each((u, v, i) => {
    const w = ctx.worley(u, v, 9, 1);
    const n = ctx.fbm(u, v, 8, 3);
    const vein = smoothstep(0.08, 0.0, Math.abs(ctx.fbm(u * 1.0, v, 3, 4) - 0.1)) + (ctx.hashf(w.id) > 0.8 ? smoothstep(0.35, 0.1, w.f1) : 0);
    const a = clamp(vein * (0.7 + n * 0.5), 0, 1);
    if (a <= 0) return;
    ctx.setColor(i, mixColor([ctx.r[i], ctx.g[i], ctx.b[i]], veinColor.map((q) => q * (0.75 + n * 0.4)), a));
    ctx.metal[i] = metal * a;
    ctx.rough[i] = ctx.rough[i] * (1 - a) + 0.3 * a;
    ctx.h[i] += a * 0.15;
  });
}

export const RTS_RECIPES = {
  grass: (ctx) => paintGrass(ctx, { bare: 0.25 }),
  grass_dry: (ctx) => paintGrass(ctx, { dark: 0x4a4424, mid: 0x7a7038, light: 0x9a8e52, dry: 0xa89a5e, dryness: 0.6, bare: 0.4, flowers: 30 }),
  dirt: (ctx) => paintSoil(ctx),
  forest: (ctx) => paintForestFloor(ctx),
  sand: (ctx) => paintSand(ctx),
  rock: (ctx) => paintRock(ctx),
  mud: (ctx) => paintMud(ctx),
  path: (ctx) => paintPath(ctx),
  farmland: (ctx) => paintFarmland(ctx),
  masonry: (ctx) => paintMasonry(ctx),
  masonry_dark: (ctx) => paintMasonry(ctx, { stone: 0x7a7266, stone2: 0x5f574c, mortar: 0x6a6358, rows: 8 }),
  plaster: (ctx) => paintPlaster(ctx),
  planks: (ctx) => paintPlanks(ctx),
  planks_dark: (ctx) => paintPlanks(ctx, { base: 0x4d3825, dark: 0x2c1f14, weathered: 0.2 }),
  roof_tiles: (ctx) => paintRoofTiles(ctx),
  thatch: (ctx) => paintThatch(ctx),
  shingles: (ctx) => paintShingles(ctx),
  cloth: (ctx) => paintCloth(ctx),
  bark_oak: (ctx) => paintBark(ctx),
  bark_pine: (ctx) => paintBark(ctx, { base: 0x5a3f2c, dark: 0x2a1c12, pu: 7, pv: 4, lichen: 0.15 }),
  leaves_oak: (ctx) => paintLeafCluster(ctx, { base: [0.3, 0.42, 0.14] }),
  leaves_pine: (ctx) => paintNeedleCluster(ctx),
  leaves_bush: (ctx) => paintLeafCluster(ctx, { base: [0.24, 0.36, 0.14], leaves: 55, len: 11, clusters: 9 }),
  grass_tuft: (ctx) => paintGrassTuft(ctx, { base: [0.32, 0.43, 0.14], blades: 90 }),
  wheat: (ctx) => paintGrassTuft(ctx, { base: [0.75, 0.62, 0.3], blades: 60, dry: 0.3 }),
  gold_ore: (ctx) => paintOre(ctx, hex(0xe8b830), 1),
  stone_ore: (ctx) => paintRock(ctx, { base: 0xa39c90, dark: 0x6a645a, layers: 2, lichen: 0.1 }),
};

export const RTS_TEXTURES = Object.keys(RTS_RECIPES);
