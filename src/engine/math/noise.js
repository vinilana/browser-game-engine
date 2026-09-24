// Noise library: seeded simplex 2D/3D, fractal helpers and tileable noise
// (gradient + Worley) used for procedural texture synthesis.
import { mulberry32, hash2i, hash32 } from './rng.js';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

export class Simplex {
  constructor(seed = 1337) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** 2D simplex noise in [-1, 1]. */
  noise2(xin, yin) {
    const perm = this.perm, pm = this.permMod12;
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { const gi = pm[ii + perm[jj]] * 3; t0 *= t0; n0 = t0 * t0 * (GRAD3[gi] * x0 + GRAD3[gi + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { const gi = pm[ii + i1 + perm[jj + j1]] * 3; t1 *= t1; n1 = t1 * t1 * (GRAD3[gi] * x1 + GRAD3[gi + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { const gi = pm[ii + 1 + perm[jj + 1]] * 3; t2 *= t2; n2 = t2 * t2 * (GRAD3[gi] * x2 + GRAD3[gi + 1] * y2); }
    return 70 * (n0 + n1 + n2);
  }

  /** 3D simplex noise in [-1, 1]. */
  noise3(xin, yin, zin) {
    const perm = this.perm, pm = this.permMod12;
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) { const gi = pm[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n0 = t0 * t0 * (GRAD3[gi] * x0 + GRAD3[gi + 1] * y0 + GRAD3[gi + 2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) { const gi = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n1 = t1 * t1 * (GRAD3[gi] * x1 + GRAD3[gi + 1] * y1 + GRAD3[gi + 2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) { const gi = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n2 = t2 * t2 * (GRAD3[gi] * x2 + GRAD3[gi + 1] * y2 + GRAD3[gi + 2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) { const gi = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n3 = t3 * t3 * (GRAD3[gi] * x3 + GRAD3[gi + 1] * y3 + GRAD3[gi + 2] * z3); }
    return 32 * (n0 + n1 + n2 + n3);
  }

  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise3(x * freq, y * freq, z * freq);
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal in [0, 1] — sharp crests, good for mountains/rivers. */
  ridged2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, freq = 1, norm = 0, prev = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.noise2(x * freq, y * freq));
      n *= n;
      sum += n * amp * prev;
      prev = n;
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }
}

// ---------------------------------------------------------------------------
// Tileable noise for textures. Coordinates are in [0, 1) texture space and the
// result wraps perfectly on the unit square.
// ---------------------------------------------------------------------------

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const mod = (a, n) => ((a % n) + n) % n;

export class TileNoise {
  constructor(seed = 1) {
    this.seed = seed | 0;
  }

  _grad(ix, iy, period, dx, dy) {
    const h = hash2i(mod(ix, period), mod(iy, period), this.seed);
    const a = (h / 4294967296) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  }

  /** Periodic gradient noise, approx [-1, 1]. u,v in [0,1), `period` lattice cells per tile. */
  perlin(u, v, period) {
    const x = u * period, y = v * period;
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const n00 = this._grad(ix, iy, period, fx, fy);
    const n10 = this._grad(ix + 1, iy, period, fx - 1, fy);
    const n01 = this._grad(ix, iy + 1, period, fx, fy - 1);
    const n11 = this._grad(ix + 1, iy + 1, period, fx - 1, fy - 1);
    const sx = fade(fx), sy = fade(fy);
    const a = n00 + (n10 - n00) * sx;
    const b = n01 + (n11 - n01) * sx;
    return (a + (b - a) * sy) * 1.414;
  }

  /** Periodic value noise in [0, 1]. */
  value(u, v, period) {
    const x = u * period, y = v * period;
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = fade(x - ix), fy = fade(y - iy);
    const r = (a, b) => hash2i(mod(a, period), mod(b, period), this.seed + 77) / 4294967296;
    const a = r(ix, iy), b = r(ix + 1, iy), c = r(ix, iy + 1), d = r(ix + 1, iy + 1);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  }

  /** Periodic fbm, approx [-1, 1]. `period` = base cell count (integer). */
  fbm(u, v, period, octaves = 4, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, p = period;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.perlin(u, v, p);
      norm += amp; amp *= gain; p *= 2;
    }
    return sum / norm;
  }

  /** Anisotropic periodic fbm: stretched along one axis (for wood grain, bark). */
  fbmAniso(u, v, periodU, periodV, octaves = 4, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, pu = periodU, pv = periodV;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this._perlinAniso(u, v, pu, pv);
      norm += amp; amp *= gain; pu *= 2; pv *= 2;
    }
    return sum / norm;
  }

  _perlinAniso(u, v, pu, pv) {
    const x = u * pu, y = v * pv;
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const g = (a, b, dx, dy) => {
      const h = hash2i(mod(a, pu), mod(b, pv), this.seed + 911);
      const ang = (h / 4294967296) * Math.PI * 2;
      return Math.cos(ang) * dx + Math.sin(ang) * dy;
    };
    const n00 = g(ix, iy, fx, fy), n10 = g(ix + 1, iy, fx - 1, fy);
    const n01 = g(ix, iy + 1, fx, fy - 1), n11 = g(ix + 1, iy + 1, fx - 1, fy - 1);
    const sx = fade(fx), sy = fade(fy);
    const a = n00 + (n10 - n00) * sx, b = n01 + (n11 - n01) * sx;
    return (a + (b - a) * sy) * 1.414;
  }

  /**
   * Periodic Worley/cellular noise. Returns an object reused between calls:
   * { f1, f2, id, cx, cy } where f1/f2 are distances in cell units,
   * id is a hash of the nearest cell and cx/cy its feature point (in [0,1) uv).
   */
  worley(u, v, cells, jitter = 1, out = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 }) {
    const x = u * cells, y = v * cells;
    const ix = Math.floor(x), iy = Math.floor(y);
    let f1 = 1e9, f2 = 1e9, id = 0, bx = 0, by = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox, cy = iy + oy;
        const wx = mod(cx, cells), wy = mod(cy, cells);
        const h = hash2i(wx, wy, this.seed + 1013);
        const px = cx + 0.5 + ((h & 0xffff) / 65535 - 0.5) * jitter;
        const py = cy + 0.5 + ((h >>> 16) / 65535 - 0.5) * jitter;
        const dx = px - x, dy = py - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; id = h; bx = px; by = py; }
        else if (d < f2) { f2 = d; }
      }
    }
    out.f1 = f1; out.f2 = f2; out.id = id;
    out.cx = mod(bx / cells, 1); out.cy = mod(by / cells, 1);
    return out;
  }
}

/** Smoothstep helper. */
export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function lerp(a, b, t) { return a + (b - a) * t; }

export { hash32 };
