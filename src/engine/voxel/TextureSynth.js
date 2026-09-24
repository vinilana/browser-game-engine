// Procedural PBR texture synthesis. A recipe paints albedo/alpha, height,
// roughness, metalness and emission into float buffers; the context then
// derives tangent-space normals and cavity AO and packs 3 RGBA8 layers:
//   albedo   : sRGB color + alpha (cutout / tint mask)
//   normal   : tangent normal (xyz * 0.5 + 0.5) + height
//   material : roughness, metalness, ambient occlusion, emission
import { TileNoise, smoothstep, clamp, lerp } from '../math/noise.js';
import { hash2i, mulberry32, seedFromString } from '../math/rng.js';

export function hex(c) {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

export function mixColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scaleColor(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Multi-stop gradient: stops = [[t, [r,g,b]], ...] sorted by t. */
export function gradient(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      return mixColor(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return stops[stops.length - 1][1];
}

export class TexCtx {
  constructor(size, name) {
    this.size = size;
    this.name = name;
    this.seed = seedFromString(name);
    this.noise = new TileNoise(this.seed);
    this.rng = mulberry32(this.seed);
    const n = size * size;
    this.r = new Float32Array(n);
    this.g = new Float32Array(n);
    this.b = new Float32Array(n);
    this.a = new Float32Array(n).fill(1);
    this.h = new Float32Array(n).fill(0.5);
    this.rough = new Float32Array(n).fill(0.8);
    this.metal = new Float32Array(n);
    this.emit = new Float32Array(n);
    this.aoExtra = new Float32Array(n).fill(1);
    this.normalStrength = 2.0;
    this.aoStrength = 1.0;
    this.aoRadius = 2;
    this.flatNormals = false;
    this._w = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };
  }

  /** Iterates all pixels: fn(u, v, i, x, y) with u,v in [0,1). */
  each(fn) {
    const s = this.size;
    for (let y = 0; y < s; y++) {
      const v = (y + 0.5) / s;
      for (let x = 0; x < s; x++) fn((x + 0.5) / s, v, y * s + x, x, y);
    }
  }

  setColor(i, c) { this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2]; }

  // noise helpers ------------------------------------------------------------
  fbm(u, v, period, oct = 4, gain = 0.5) { return this.noise.fbm(u, v, period, oct, gain); }
  aniso(u, v, pu, pv, oct = 4, gain = 0.5) { return this.noise.fbmAniso(u, v, pu, pv, oct, gain); }
  value(u, v, period) { return this.noise.value(u, v, period); }
  worley(u, v, cells, jitter = 1) { return this.noise.worley(u, v, cells, jitter, this._w); }
  /** Per-pixel white noise in [0,1). */
  white(x, y, salt = 0) { return hash2i(x, y, this.seed + salt) / 4294967296; }
  /** Hash of an integer id to [0,1). */
  hashf(id, salt = 0) { return hash2i(id | 0, salt, this.seed) / 4294967296; }

  // painting helpers (with wrap-around) -------------------------------------
  /**
   * Draws an anti-aliased capsule (line with round caps) in pixel space.
   * cb(i, coverage, t) is called per covered pixel; t = position along the segment.
   */
  stroke(x0, y0, x1, y1, w0, w1, cb, wrap = true) {
    const s = this.size;
    const minX = Math.floor(Math.min(x0, x1) - Math.max(w0, w1) - 1);
    const maxX = Math.ceil(Math.max(x0, x1) + Math.max(w0, w1) + 1);
    const minY = Math.floor(Math.min(y0, y1) - Math.max(w0, w1) - 1);
    const maxY = Math.ceil(Math.max(y0, y1) + Math.max(w0, w1) + 1);
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1e-6;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        let t = ((cx - x0) * dx + (cy - y0) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = x0 + dx * t - cx, qy = y0 + dy * t - cy;
        const d = Math.sqrt(qx * qx + qy * qy);
        const w = w0 + (w1 - w0) * t;
        const cov = clamp(w - d + 0.5, 0, 1);
        if (cov <= 0) continue;
        let ix = px, iy = py;
        if (wrap) { ix = ((ix % s) + s) % s; iy = ((iy % s) + s) % s; }
        else if (ix < 0 || iy < 0 || ix >= s || iy >= s) continue;
        cb(iy * s + ix, cov, t);
      }
    }
  }

  /** Anti-aliased rotated ellipse. cb(i, coverage, nx, ny) with nx,ny in [-1,1] ellipse coords. */
  ellipse(cx, cy, rx, ry, angle, cb, wrap = true) {
    const s = this.size;
    const r = Math.max(rx, ry) + 1;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    for (let py = Math.floor(cy - r); py <= Math.ceil(cy + r); py++) {
      for (let px = Math.floor(cx - r); px <= Math.ceil(cx + r); px++) {
        const dx = px + 0.5 - cx, dy = py + 0.5 - cy;
        const lx = (dx * ca + dy * sa) / rx;
        const ly = (-dx * sa + dy * ca) / ry;
        const d = Math.sqrt(lx * lx + ly * ly);
        const edge = (1 - d) * Math.min(rx, ry);
        const cov = clamp(edge + 0.5, 0, 1);
        if (cov <= 0) continue;
        let ix = px, iy = py;
        if (wrap) { ix = ((ix % s) + s) % s; iy = ((iy % s) + s) % s; }
        else if (ix < 0 || iy < 0 || ix >= s || iy >= s) continue;
        cb(iy * s + ix, cov, lx, ly);
      }
    }
  }

  // finishing ---------------------------------------------------------------
  _heightAt(x, y) {
    const s = this.size;
    x = ((x % s) + s) % s; y = ((y % s) + s) % s;
    return this.h[y * s + x];
  }

  /** Packs into RGBA8 layers. */
  finish() {
    const s = this.size, n = s * s;
    const albedo = new Uint8Array(n * 4);
    const normal = new Uint8Array(n * 4);
    const material = new Uint8Array(n * 4);
    // blurred height for cavity AO
    const R = this.aoRadius;
    const blur = new Float32Array(n);
    if (this.aoStrength > 0) {
      const tmp = new Float32Array(n);
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          let acc = 0;
          for (let k = -R; k <= R; k++) acc += this._heightAt(x + k, y);
          tmp[y * s + x] = acc / (2 * R + 1);
        }
      }
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          let acc = 0;
          for (let k = -R; k <= R; k++) acc += tmp[(((y + k) % s + s) % s) * s + x];
          blur[y * s + x] = acc / (2 * R + 1);
        }
      }
    }
    const scale = this.normalStrength * (s / 64);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = y * s + x;
        const o = i * 4;
        albedo[o] = clamp(this.r[i], 0, 1) * 255 + 0.5;
        albedo[o + 1] = clamp(this.g[i], 0, 1) * 255 + 0.5;
        albedo[o + 2] = clamp(this.b[i], 0, 1) * 255 + 0.5;
        albedo[o + 3] = clamp(this.a[i], 0, 1) * 255 + 0.5;
        let nx = 0, ny = 0, nz = 1;
        if (!this.flatNormals) {
          const dhdx = (this._heightAt(x + 1, y) - this._heightAt(x - 1, y)) * 0.5;
          const dhdv = (this._heightAt(x, y + 1) - this._heightAt(x, y - 1)) * 0.5;
          nx = -dhdx * scale; ny = dhdv * scale; nz = 1;
          const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
          nx /= l; ny /= l; nz /= l;
        }
        normal[o] = (nx * 0.5 + 0.5) * 255 + 0.5;
        normal[o + 1] = (ny * 0.5 + 0.5) * 255 + 0.5;
        normal[o + 2] = (nz * 0.5 + 0.5) * 255 + 0.5;
        normal[o + 3] = clamp(this.h[i], 0, 1) * 255 + 0.5;
        const cav = this.aoStrength > 0 ? clamp(1 - Math.max(0, blur[i] - this.h[i]) * 4 * this.aoStrength, 0.25, 1) : 1;
        material[o] = clamp(this.rough[i], 0.02, 1) * 255 + 0.5;
        material[o + 1] = clamp(this.metal[i], 0, 1) * 255 + 0.5;
        material[o + 2] = clamp(cav * this.aoExtra[i], 0, 1) * 255 + 0.5;
        material[o + 3] = clamp(this.emit[i], 0, 1) * 255 + 0.5;
      }
    }
    return { albedo, normal, material };
  }
}

/**
 * Runs a set of recipes: recipes = { name: (ctx) => void }.
 * Returns packed layers for the requested names.
 */
export function synthesize(recipes, names, size) {
  const out = [];
  for (const name of names) {
    const ctx = new TexCtx(size, name);
    const fn = recipes[name];
    if (!fn) throw new Error('Missing texture recipe ' + name);
    fn(ctx);
    out.push({ name, ...ctx.finish() });
  }
  return out;
}

export { smoothstep, clamp, lerp };
