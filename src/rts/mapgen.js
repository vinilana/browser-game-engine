// Procedural map generation for "Reinos": terrain, water, splat layers,
// forests, resources and balanced starting positions.
import { Simplex, smoothstep, clamp, lerp } from '../engine/math/noise.js';
import { mulberry32, hash2i } from '../engine/math/rng.js';
import { MAP_SIZE, WATER_LEVEL } from './config.js';

export const LAYER = { GRASS: 0, DRY: 1, DIRT: 2, FOREST: 3, SAND: 4, ROCK: 5, MUD: 6, PATH: 7 };

export class MapGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    const s = (k) => new Simplex((this.seed * 7919 + k * 104729) | 0);
    this.nBase = s(1); this.nHill = s(2); this.nRidge = s(3); this.nMoist = s(4); this.nForest = s(5);
    this.nDetail = s(6); this.nDirt = s(7); this.nLake = s(8);
    this.size = MAP_SIZE;
    const rnd = mulberry32(this.seed ^ 0x9e3779b9);
    // starting positions on opposite corners with a little randomness
    const m = 72 + rnd() * 10;
    this.starts = [
      { x: m, z: MAP_SIZE - m },
      { x: MAP_SIZE - m, z: m },
    ];
    if (rnd() < 0.5) this.starts = [{ x: m, z: m }, { x: MAP_SIZE - m, z: MAP_SIZE - m }];
    // lakes: one central-ish, two small ponds
    const c = MAP_SIZE / 2;
    const perp = { x: this.starts[1].z - this.starts[0].z, z: -(this.starts[1].x - this.starts[0].x) };
    const pl = Math.hypot(perp.x, perp.z);
    perp.x /= pl; perp.z /= pl;
    const side = rnd() < 0.5 ? -1 : 1;
    this.lakes = [
      { x: c + perp.x * side * 70, z: c + perp.z * side * 70, r: 26 + rnd() * 8 },
      { x: c - perp.x * side * 95, z: c - perp.z * side * 95, r: 12 + rnd() * 5 },
    ];
  }

  /** Natural terrain height (without start flattening), valid everywhere. */
  baseHeight(x, z) {
    const b = this.nBase.fbm2(x * 0.006, z * 0.006, 4) * 9;
    const hills = Math.max(0, this.nHill.fbm2(x * 0.012 + 3, z * 0.012, 3)) * 14;
    const ridge = Math.pow(this.nRidge.ridged2(x * 0.009, z * 0.009, 4), 3) * 26;
    const ridgeMask = smoothstep(0.1, 0.45, this.nRidge.fbm2(x * 0.004 + 9, z * 0.004, 2));
    const detail = this.nDetail.fbm2(x * 0.05, z * 0.05, 3) * 0.7;
    // raise the land outside the playable area into rolling hills
    const cx = Math.max(0, Math.max(-x, x - MAP_SIZE)), cz = Math.max(0, Math.max(-z, z - MAP_SIZE));
    const outside = Math.hypot(cx, cz);
    return 7 + b + hills + ridge * ridgeMask + detail + Math.min(60, outside * 0.12) * smoothstep(0, 60, outside);
  }

  lakeDepth(x, z) {
    let d = 0;
    for (const l of this.lakes) {
      const warp = this.nLake.fbm2(x * 0.03, z * 0.03, 3) * 0.35;
      const r = Math.hypot(x - l.x, z - l.z) / l.r + warp;
      if (r < 1.25) d = Math.max(d, smoothstep(1.25, 0.35, r));
    }
    return d;
  }

  /** Playable-map height including lakes and flattened start areas. */
  height(x, z) {
    let h = this.baseHeight(x, z);
    // flatten starting areas
    for (const s of this.starts) {
      const d = Math.hypot(x - s.x, z - s.z);
      const w = smoothstep(52, 30, d);
      if (w > 0) {
        const hs = this.baseHeightSmooth(s.x, s.z);
        h = lerp(h, hs + (h - hs) * 0.15, w);
      }
    }
    const lake = this.lakeDepth(x, z);
    if (lake > 0) h = lerp(h, WATER_LEVEL - 4.5, lake);
    return h;
  }

  baseHeightSmooth(x, z) {
    // cached smooth height at start centers (terrain average)
    const key = `${Math.round(x)},${Math.round(z)}`;
    this._hs = this._hs || new Map();
    if (this._hs.has(key)) return this._hs.get(key);
    let sum = 0, n = 0;
    for (let dz = -24; dz <= 24; dz += 6) for (let dx = -24; dx <= 24; dx += 6) { sum += this.baseHeight(x + dx, z + dz); n++; }
    const v = Math.max(WATER_LEVEL + 3, sum / n);
    this._hs.set(key, v);
    return v;
  }

  forestDensity(x, z) {
    let f = this.nForest.fbm2(x * 0.018, z * 0.018, 4);
    f = smoothstep(0.02, 0.28, f);
    // map border belts of forest
    const edge = Math.min(x, z, MAP_SIZE - x, MAP_SIZE - z);
    f = Math.max(f, smoothstep(26, 8, edge) * 0.95);
    // keep start areas open, but with a wood line nearby
    for (const s of this.starts) {
      const d = Math.hypot(x - s.x, z - s.z);
      f *= smoothstep(22, 34, d);
    }
    return f;
  }

  generate() {
    const S = this.size;
    const n = S + 1;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = this.height(i, j);
    const splat = new Uint8Array(n * n * 8);
    const hAt = (i, j) => heights[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = i, z = j;
        const h = heights[j * n + i];
        const slope = Math.hypot(hAt(i + 1, j) - hAt(i - 1, j), hAt(i, j + 1) - hAt(i, j - 1)) * 0.5;
        const w = new Float32Array(8);
        const moist = this.nMoist.fbm2(x * 0.01, z * 0.01, 3);
        w[LAYER.GRASS] = 1;
        w[LAYER.DRY] = smoothstep(0.0, 0.35, -moist) * 0.9;
        const dirt = smoothstep(0.35, 0.6, this.nDirt.fbm2(x * 0.03, z * 0.03, 3));
        w[LAYER.DIRT] = dirt * 0.8;
        const forest = this.forestDensity(x, z);
        w[LAYER.FOREST] = smoothstep(0.25, 0.6, forest) * 1.3;
        const shore = smoothstep(WATER_LEVEL + 1.6, WATER_LEVEL + 0.4, h);
        w[LAYER.SAND] = shore * 1.6;
        w[LAYER.MUD] = smoothstep(WATER_LEVEL + 0.5, WATER_LEVEL - 0.5, h) * 1.2;
        w[LAYER.ROCK] = smoothstep(0.55, 0.9, slope) * 2;
        // trampled ground around the starting town centers
        for (const s of this.starts) {
          const d = Math.hypot(x - s.x, z - s.z);
          w[LAYER.PATH] = Math.max(w[LAYER.PATH], smoothstep(18, 9, d + this.nDirt.noise2(x * 0.2, z * 0.2) * 3) * 0.9);
          w[LAYER.DIRT] = Math.max(w[LAYER.DIRT], smoothstep(26, 14, d) * 0.4);
        }
        let sum = 0;
        for (let k = 0; k < 8; k++) sum += w[k];
        for (let k = 0; k < 8; k++) splat[(j * n + i) * 8 + k] = Math.round((w[k] / sum) * 255);
      }
    }

    const rnd = mulberry32(this.seed + 77);
    const trees = [];
    const resources = [];
    const animals = [];
    // occupancy bitmap (0.5 m cells) so placement checks stay O(1)
    const OR = 2, ON = S * OR;
    const occ = new Uint8Array(ON * ON);
    const mark = (x, z, r) => {
      const i0 = Math.max(0, Math.floor((x - r) * OR)), i1 = Math.min(ON - 1, Math.ceil((x + r) * OR));
      const j0 = Math.max(0, Math.floor((z - r) * OR)), j1 = Math.min(ON - 1, Math.ceil((z + r) * OR));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (Math.hypot((i + 0.5) / OR - x, (j + 0.5) / OR - z) <= r) occ[j * ON + i] = 1;
      }
    };
    const blocked = { push: ({ x, z, r }) => mark(x, z, r) };
    const heightAt = (x, z) => {
      const i = Math.floor(x), j = Math.floor(z);
      const tx = x - i, tz = z - j;
      return lerp(lerp(hAt(i, j), hAt(i + 1, j), tx), lerp(hAt(i, j + 1), hAt(i + 1, j + 1), tx), tz);
    };
    const slopeAt = (x, z) => Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) * 0.5;
    const free = (x, z, r) => {
      if (x < 4 || z < 4 || x > S - 4 || z > S - 4) return false;
      if (heightAt(x, z) < WATER_LEVEL + 0.8) return false;
      const i0 = Math.max(0, Math.floor((x - r) * OR)), i1 = Math.min(ON - 1, Math.ceil((x + r) * OR));
      const j0 = Math.max(0, Math.floor((z - r) * OR)), j1 = Math.min(ON - 1, Math.ceil((z + r) * OR));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (occ[j * ON + i] && Math.hypot((i + 0.5) / OR - x, (j + 0.5) / OR - z) <= r) return false;
      }
      return true;
    };
    for (const s of this.starts) blocked.push({ x: s.x, z: s.z, r: 12 });

    // --- per-player balanced resources -------------------------------------------
    const place = (type, s, dist, ang, r) => {
      for (let t = 0; t < 40; t++) {
        const a = ang + (rnd() - 0.5) * 0.6 * (t / 10 + 0.3);
        const d = dist + (rnd() - 0.5) * 6;
        const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
        if (free(x, z, r) && slopeAt(x, z) < 0.35) {
          resources.push({ type, x, z });
          blocked.push({ x, z, r: r + 2 });
          return { x, z };
        }
      }
      return null;
    };
    this.starts.forEach((s, pi) => {
      const base = rnd() * Math.PI * 2;
      place('gold', s, 26, base, 3);
      place('stone', s, 30, base + 2.1, 3);
      place('gold', s, 44, base + 3.6, 3);
      const b = place('berry', s, 17, base + 1.0, 1.1);
      if (b) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const x = b.x + Math.cos(a) * 2.6 + (rnd() - 0.5), z = b.z + Math.sin(a) * 2.6 + (rnd() - 0.5);
          resources.push({ type: 'berry', x, z }); blocked.push({ x, z, r: 1.6 });
        }
      }
      for (let k = 0; k < 4; k++) {
        const a = base + 4.6 + k * 0.4;
        animals.push({ type: 'sheep', x: s.x + Math.cos(a) * 11, z: s.z + Math.sin(a) * 11, owner: pi });
      }
      for (let herd = 0; herd < 2; herd++) {
        const a = base + 0.5 + herd * 3.1, d = 42 + rnd() * 8;
        for (let k = 0; k < 3; k++) animals.push({ type: 'deer', x: s.x + Math.cos(a) * d + (rnd() - 0.5) * 5, z: s.z + Math.sin(a) * d + (rnd() - 0.5) * 5 });
      }
      // a guaranteed wood line
      const wa = base + 5.3;
      for (let k = 0; k < 90; k++) {
        const d = 30 + rnd() * 16;
        const a = wa + (rnd() - 0.5) * 1.0;
        const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
        if (free(x, z, 1.4)) { trees.push(this._tree(x, z, heightAt(x, z), rnd)); blocked.push({ x, z, r: 1.3 }); }
      }
    });
    // contested middle resources
    const mid = { x: S / 2, z: S / 2 };
    for (let k = 0; k < 4; k++) place(k % 2 ? 'stone' : 'gold', mid, 38 + rnd() * 30, rnd() * Math.PI * 2, 3);
    for (let k = 0; k < 4; k++) {
      const a = rnd() * Math.PI * 2, d = 30 + rnd() * 60;
      for (let q = 0; q < 3; q++) animals.push({ type: 'deer', x: mid.x + Math.cos(a) * d + (rnd() - 0.5) * 6, z: mid.z + Math.sin(a) * d + (rnd() - 0.5) * 6 });
    }

    // --- forests ------------------------------------------------------------------
    const cell = 3.2;
    for (let gz = 0; gz < S / cell; gz++) {
      for (let gx = 0; gx < S / cell; gx++) {
        const x = (gx + 0.2 + rnd() * 0.6) * cell, z = (gz + 0.2 + rnd() * 0.6) * cell;
        const f = this.forestDensity(x, z);
        const p = f > 0.4 ? 0.85 * f : 0.012;
        if (rnd() > p) continue;
        if (slopeAt(x, z) > 0.8) continue;
        if (!free(x, z, 1.1)) continue;
        trees.push(this._tree(x, z, heightAt(x, z), rnd));
        blocked.push({ x, z, r: 1.0 });
      }
    }
    return { size: S, heights, splat, trees, resources, animals, starts: this.starts, lakes: this.lakes };
  }

  _tree(x, z, h, rnd) {
    const pineBias = smoothstep(14, 26, h) * 0.6 + 0.2 + this.nMoist.noise2(x * 0.02, z * 0.02) * 0.25;
    const species = rnd() < pineBias ? 'pine' : 'oak';
    return { x, z, species, variant: Math.floor(rnd() * 3), scale: 0.8 + rnd() * 0.45, rot: rnd() * Math.PI * 2 };
  }

  /** Scenery beyond the map for the engine's FarTerrain. */
  farSample(x, z, out) {
    const h = this.baseHeight(x, z);
    const f = smoothstep(0.0, 0.3, this.nForest.fbm2(x * 0.018, z * 0.018, 4)) * 0.8 + 0.2;
    const moist = this.nMoist.fbm2(x * 0.01, z * 0.01, 3);
    const grass = moist > 0 ? [78, 96, 40] : [104, 102, 56];
    const canopy = [54, 80, 32];
    // canopy bulge fades in past the border so the far terrain meets the map seamlessly
    const cx = Math.max(0, Math.max(-x, x - MAP_SIZE)), cz = Math.max(0, Math.max(-z, z - MAP_SIZE));
    const ramp = smoothstep(0, 30, Math.hypot(cx, cz));
    out.h = h + f * 9 * ramp;
    out.water = 0;
    out.forest = smoothstep(0.35, 0.8, f) * (0.3 + 0.7 * ramp);
    out.r = lerp(grass[0], canopy[0], f); out.g = lerp(grass[1], canopy[1], f); out.b = lerp(grass[2], canopy[2], f);
    return out;
  }
}

export { clamp, hash2i };
