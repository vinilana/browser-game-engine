// Generates a tileable 3D RGBA8 noise volume for volumetric clouds:
//   R = Perlin-Worley, G/B/A = Worley fBm at increasing frequencies.
import { hash3i } from '../math/rng.js';

const mod = (a, n) => ((a % n) + n) % n;
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function grad3(ix, iy, iz, p, dx, dy, dz) {
  const h = hash3i(mod(ix, p), mod(iy, p), mod(iz, p), 91) & 15;
  // 12 gradient directions of classic Perlin noise
  const u = h < 8 ? dx : dy;
  const v = h < 4 ? dy : (h === 12 || h === 14 ? dx : dz);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function perlin3(x, y, z, p) {
  x *= p; y *= p; z *= p;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const l = (a, b, t) => a + (b - a) * t;
  const n000 = grad3(ix, iy, iz, p, fx, fy, fz);
  const n100 = grad3(ix + 1, iy, iz, p, fx - 1, fy, fz);
  const n010 = grad3(ix, iy + 1, iz, p, fx, fy - 1, fz);
  const n110 = grad3(ix + 1, iy + 1, iz, p, fx - 1, fy - 1, fz);
  const n001 = grad3(ix, iy, iz + 1, p, fx, fy, fz - 1);
  const n101 = grad3(ix + 1, iy, iz + 1, p, fx - 1, fy, fz - 1);
  const n011 = grad3(ix, iy + 1, iz + 1, p, fx, fy - 1, fz - 1);
  const n111 = grad3(ix + 1, iy + 1, iz + 1, p, fx - 1, fy - 1, fz - 1);
  return l(l(l(n000, n100, u), l(n010, n110, u), v), l(l(n001, n101, u), l(n011, n111, u), v), w);
}

function worley3(x, y, z, cells, seed) {
  x *= cells; y *= cells; z *= cells;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let best = 1e9;
  for (let oz = -1; oz <= 1; oz++) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox, cy = iy + oy, cz = iz + oz;
        const h = hash3i(mod(cx, cells), mod(cy, cells), mod(cz, cells), seed);
        const px = cx + (h & 1023) / 1023;
        const py = cy + ((h >>> 10) & 1023) / 1023;
        const pz = cz + ((h >>> 20) & 1023) / 1023;
        const dx = px - x, dy = py - y, dz = pz - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
    }
  }
  return Math.min(1, Math.sqrt(best));
}

function worleyFbm(x, y, z, f, seed) {
  return (1 - worley3(x, y, z, f, seed)) * 0.625 +
    (1 - worley3(x, y, z, f * 2, seed + 1)) * 0.25 +
    (1 - worley3(x, y, z, f * 4, seed + 2)) * 0.125;
}

self.onmessage = (e) => {
  const size = e.data.size || 64;
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size, w = z / size;
        let pf = 0, amp = 1, norm = 0, p = 4;
        for (let o = 0; o < 4; o++) { pf += perlin3(u, v, w, p) * amp; norm += amp; amp *= 0.5; p *= 2; }
        pf = pf / norm * 0.5 + 0.5;
        const g = worleyFbm(u, v, w, 4, 11);
        const b = worleyFbm(u, v, w, 8, 23);
        const a = worleyFbm(u, v, w, 16, 37);
        // Perlin-Worley: perlin dilated by worley
        let pw = (pf - (g - 1)) / (2 - g);
        pw = Math.max(0, Math.min(1, (pw - 0.25) / 0.75));
        data[i++] = pw * 255;
        data[i++] = g * 255;
        data[i++] = b * 255;
        data[i++] = a * 255;
      }
    }
  }
  self.postMessage({ size, data }, [data.buffer]);
};
