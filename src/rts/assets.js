// GPU textures + shared materials for "Reinos".
import {
  DataArrayTexture, DataTexture, RGBAFormat, UnsignedByteType, RepeatWrapping, LinearFilter,
  LinearMipmapLinearFilter, SRGBColorSpace, DoubleSide, Color,
} from 'three';
import { GBufferMaterial } from '../engine/render/materials/GBufferMaterial.js';
import { RTS_TEXTURES, TERRAIN_LAYERS } from './textures.js';
import { TEAMS } from './config.js';

function tex2D(data, size, srgb) {
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export async function loadAssets(pool, size, onProgress) {
  const names = RTS_TEXTURES;
  const per = Math.max(1, Math.ceil(names.length / (pool.size * 2)));
  let done = 0;
  const jobs = [];
  for (let i = 0; i < names.length; i += per) {
    const slice = names.slice(i, i + per);
    jobs.push(pool.run('textures', { names: slice, size }).then((r) => {
      done += slice.length;
      onProgress?.(done / names.length);
      return r;
    }));
  }
  const results = (await Promise.all(jobs)).flat();
  const byName = new Map(results.map((t) => [t.name, t]));

  // terrain layer arrays
  const L = TERRAIN_LAYERS.length;
  const bytes = size * size * 4;
  const arr = (key, srgb) => {
    const data = new Uint8Array(bytes * L);
    TERRAIN_LAYERS.forEach((n, i) => data.set(byName.get(n)[key], i * bytes));
    const t = new DataArrayTexture(data, size, size, L);
    t.format = RGBAFormat; t.type = UnsignedByteType;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8;
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const terrain = { albedo: arr('albedo', true), normal: arr('normal', false), material: arr('material', false) };

  const maps = {};
  for (const [n, t] of byName) {
    if (TERRAIN_LAYERS.includes(n)) continue;
    maps[n] = { map: tex2D(t.albedo, size, true), normalMap: tex2D(t.normal, size, false), materialMap: tex2D(t.material, size, false) };
  }
  return { terrain, maps, raw: byName };
}

/** Shared materials for buildings, trees and props. */
export function createMaterials(assets) {
  const M = assets.maps;
  const mat = (name, opts = {}) => new GBufferMaterial({ ...M[name], roughness: 1, metalness: 1, ...opts });
  const m = {
    masonry: mat('masonry', { uvScale: [0.5, 0.5] }),
    masonryDark: mat('masonry_dark', { uvScale: [0.5, 0.5] }),
    plaster: mat('plaster', { uvScale: [0.4, 0.4] }),
    wood: mat('planks_dark', { uvScale: [0.6, 0.6] }),
    planks: mat('planks', { uvScale: [0.5, 0.5] }),
    roofTiles: mat('roof_tiles', { uvScale: [0.45, 0.45], side: DoubleSide }),
    thatch: mat('thatch', { uvScale: [0.4, 0.4], side: DoubleSide }),
    shingles: mat('shingles', { uvScale: [0.45, 0.45], side: DoubleSide }),
    bark: mat('bark_oak', { uvScale: [1, 1], wind: true }),
    barkPine: mat('bark_pine', { uvScale: [1, 1], wind: true }),
    leavesOak: mat('leaves_oak', { side: DoubleSide, alphaTest: 0.5, wind: true, flags: 1, metalness: 0 }),
    leavesPine: mat('leaves_pine', { side: DoubleSide, alphaTest: 0.5, wind: true, flags: 1, metalness: 0 }),
    leavesBush: mat('leaves_bush', { side: DoubleSide, alphaTest: 0.5, wind: true, flags: 1, metalness: 0 }),
    tuft: mat('grass_tuft', { side: DoubleSide, alphaTest: 0.5, wind: true, flags: 2, metalness: 0, alphaMaxLod: 1.5 }),
    wheat: mat('wheat', { side: DoubleSide, alphaTest: 0.5, wind: true, flags: 2, metalness: 0, alphaMaxLod: 1.5 }),
    farmland: mat('farmland', { uvScale: [0.35, 0.35] }),
    goldOre: mat('gold_ore', { uvScale: [0.5, 0.5] }),
    stoneOre: mat('stone_ore', { uvScale: [0.5, 0.5] }),
    berry: new GBufferMaterial({ color: new Color(0.45, 0.02, 0.03), roughness: 0.35 }),
    iron: new GBufferMaterial({ color: new Color(0.55, 0.55, 0.56), roughness: 0.4, metalness: 1 }),
    straw: mat('thatch', { uvScale: [1, 1] }),
  };
  m.cloth = TEAMS.map((t) => mat('cloth', { color: new Color(...t.color), uvScale: [0.8, 0.8], side: DoubleSide, wind: true, metalness: 0 }));
  return m;
}
