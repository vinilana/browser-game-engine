// Procedural tree / bush geometry (bark + alpha-tested leaf cards) with wind weights.
import { Vector3 } from 'three';
import { MeshBuilder } from '../../engine/geometry/MeshBuilder.js';
import { mulberry32 } from '../../engine/math/rng.js';

const ATTR = { attributes: { aWind: 1 } };

function card(b, center, normal, up, size, canopyCenter, wind) {
  // quad facing `normal`, oriented with `up`; lighting normal bends outward from the canopy
  const n = new Vector3(...normal).normalize();
  const r = new Vector3().crossVectors(new Vector3(...up), n).normalize();
  const u = new Vector3().crossVectors(n, r).normalize();
  const c = new Vector3(...center);
  const out = c.clone().sub(new Vector3(...canopyCenter)).normalize();
  const ln = out.multiplyScalar(0.75).addScaledVector(n, 0.25).normalize();
  const h = size / 2;
  const P = (sx, sy) => { const p = c.clone().addScaledVector(r, sx * h).addScaledVector(u, sy * h); return [p.x, p.y, p.z]; };
  b.set({ aWind: [wind] });
  b.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [[0, 1], [1, 1], [1, 0], [0, 0]], [ln.x, ln.y, ln.z]);
}

function randDir(rnd) {
  const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
}

/** Broadleaf tree (~9-11 m). */
export function buildOak(seed) {
  const rnd = mulberry32(seed * 7919 + 1);
  const bark = new MeshBuilder(ATTR);
  const leaves = new MeshBuilder(ATTR);
  bark.uvScale = 0.5;
  const H = 4.2 + rnd() * 1.2;
  // trunk with a slight bend and root flare
  let p = [0, -0.3, 0];
  const bendX = (rnd() - 0.5) * 0.5, bendZ = (rnd() - 0.5) * 0.5;
  const segs = 4;
  let r = 0.5;
  for (let s = 0; s < segs; s++) {
    const t1 = (s + 1) / segs;
    const q = [bendX * t1 * t1, H * t1, bendZ * t1 * t1];
    const r1 = s === 0 ? 0.3 : 0.3 - t1 * 0.1;
    bark.set({ aWind: [t1 * 0.08] });
    bark.cylinder(p, q, r, r1, 9, { caps: false });
    p = q; r = r1;
  }
  const top = p;
  const canopy = [top[0], H + 2.4, top[2]];
  const R = [3.4 + rnd() * 0.8, 2.5 + rnd() * 0.5, 3.4 + rnd() * 0.8];
  // main branches
  const nb = 4 + Math.floor(rnd() * 2);
  const tips = [];
  for (let k = 0; k < nb; k++) {
    const a = (k / nb) * Math.PI * 2 + rnd() * 0.6;
    const y0 = H * (0.75 + rnd() * 0.25);
    const out = 1.8 + rnd() * 1.4, up = 1.4 + rnd() * 1.4;
    const start = [top[0] * (y0 / H), y0, top[2] * (y0 / H)];
    const end = [start[0] + Math.cos(a) * out, y0 + up, start[2] + Math.sin(a) * out];
    bark.set({ aWind: [0.25] });
    bark.cylinder(start, end, 0.14, 0.06, 6, { caps: false });
    tips.push(end);
    const sub = [end[0] + Math.cos(a + 0.8) * 1.1, end[1] + 0.8, end[2] + Math.sin(a + 0.8) * 1.1];
    bark.set({ aWind: [0.45] });
    bark.cylinder(end, sub, 0.06, 0.025, 5, { caps: false });
    tips.push(sub);
  }
  // leaf cards distributed in the canopy volume, denser near branch tips
  const cards = 46 + Math.floor(rnd() * 12);
  for (let c = 0; c < cards; c++) {
    let pos;
    if (c < tips.length * 3) {
      const t = tips[c % tips.length];
      pos = [t[0] + (rnd() - 0.5) * 1.6, t[1] + (rnd() - 0.3) * 1.2, t[2] + (rnd() - 0.5) * 1.6];
    } else {
      const d = randDir(rnd), k = Math.cbrt(0.25 + rnd() * 0.75);
      pos = [canopy[0] + d[0] * R[0] * k, canopy[1] + d[1] * R[1] * k, canopy[2] + d[2] * R[2] * k];
    }
    const nrm = randDir(rnd);
    const size = 2.0 + rnd() * 1.0;
    card(leaves, pos, nrm, [0, 1, 0.01], size, canopy, 0.6 + rnd() * 0.4);
  }
  return { bark: bark.build(), leaves: leaves.build(), height: canopy[1] + R[1] };
}

/** Conifer (~14-18 m) with drooping whorls of needle sprays. */
export function buildPine(seed) {
  const rnd = mulberry32(seed * 104729 + 3);
  const bark = new MeshBuilder(ATTR);
  const leaves = new MeshBuilder(ATTR);
  bark.uvScale = 0.5;
  const H = 13 + rnd() * 4;
  bark.set({ aWind: [0] });
  bark.cylinder([0, -0.3, 0], [0, H * 0.5, 0], 0.36, 0.22, 8, { caps: false });
  bark.set({ aWind: [0.12] });
  bark.cylinder([0, H * 0.5, 0], [0, H, 0], 0.22, 0.03, 7, { caps: false });
  const start = 2.6 + rnd() * 1.2;
  const canopyC = [0, H * 0.55, 0];
  for (let y = start; y < H - 0.4; y += 0.85 + rnd() * 0.35) {
    const t = (y - start) / (H - start);
    const L = 3.6 * (1 - t) + 0.7;
    const count = 5 + Math.floor(rnd() * 3);
    const rot = rnd() * Math.PI * 2;
    for (let k = 0; k < count; k++) {
      const a = rot + (k / count) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
      const dx = Math.cos(a), dz = Math.sin(a);
      // card from the trunk outward, drooping
      const droop = 0.35 + rnd() * 0.25;
      const w = 1.1 + L * 0.35;
      const p0 = [dx * 0.1, y, dz * 0.1];
      const p1 = [dx * L, y - L * droop, dz * L];
      const side = [-dz * w / 2, 0.15, dx * w / 2];
      const wind = 0.3 + t * 0.5 + 0.3;
      leaves.set({ aWind: [wind] });
      const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 + 0.2, (p0[2] + p1[2]) / 2];
      const out = new Vector3(mid[0] - canopyC[0], (mid[1] - canopyC[1]) * 0.4, mid[2] - canopyC[2]).normalize();
      const ln = out.clone().multiplyScalar(0.6).add(new Vector3(0, 0.8, 0)).normalize();
      leaves.quad(
        [p0[0] - side[0], p0[1] - side[1], p0[2] - side[2]],
        [p0[0] + side[0], p0[1] + side[1], p0[2] + side[2]],
        [p1[0] + side[0], p1[1] + side[1], p1[2] + side[2]],
        [p1[0] - side[0], p1[1] - side[1], p1[2] - side[2]],
        [[0, 1], [1, 1], [1, 0], [0, 0]], [ln.x, ln.y, ln.z],
      );
      // a second, more vertical card fills the silhouette
      if (rnd() < 0.5) {
        const c = [dx * L * 0.55, y - L * droop * 0.5 + 0.2, dz * L * 0.55];
        card(leaves, c, [dx, 0.2, dz], [0, 1, 0], L * 0.8, canopyC, wind);
      }
    }
  }
  card(leaves, [0, H - 0.3, 0], [1, 0, 0.3], [0, 1, 0], 1.6, [0, H - 2, 0], 0.9);
  card(leaves, [0, H - 0.3, 0], [0.3, 0, 1], [0, 1, 0], 1.6, [0, H - 2, 0], 0.9);
  return { bark: bark.build(), leaves: leaves.build(), height: H };
}

export function buildStump() {
  const b = new MeshBuilder(ATTR);
  b.uvScale = 0.5;
  b.set({ aWind: [0] });
  b.cylinder([0, -0.3, 0], [0, 0.45, 0], 0.4, 0.3, 9, { caps: true });
  return b.build();
}

/** Round bush of leaf cards; returns leaves + optional berry positions. */
export function buildBush(seed, { radius = 0.9, cards = 18, berries = 0 } = {}) {
  const rnd = mulberry32(seed * 31337 + 7);
  const leaves = new MeshBuilder(ATTR);
  const c = [0, radius * 0.8, 0];
  for (let k = 0; k < cards; k++) {
    const d = randDir(rnd);
    d[1] = Math.abs(d[1]) * 0.8 + 0.1;
    const p = [c[0] + d[0] * radius * 0.7, c[1] + d[1] * radius * 0.6, c[2] + d[2] * radius * 0.7];
    card(leaves, p, randDir(rnd), [0, 1, 0.01], radius * 1.3, [0, radius * 0.4, 0], 0.5);
  }
  const berryPts = [];
  for (let k = 0; k < berries; k++) {
    const d = randDir(rnd);
    d[1] = Math.abs(d[1]) * 0.7 + 0.2;
    berryPts.push([d[0] * radius * 0.85, radius * 0.8 + d[1] * radius * 0.55, d[2] * radius * 0.85]);
  }
  return { leaves: leaves.build(), berries: berryPts };
}

/** Grass tuft: three crossed cards. */
export function buildTuft(w = 0.7, h = 0.5) {
  // splayed cards leaning outward so the tuft still reads from a high RTS camera
  const b = new MeshBuilder(ATTR);
  const N = 5;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2 + (k % 2) * 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    const tx = -sa, tz = ca;                     // tangent
    const r0 = 0.04, r1 = w * 0.42, hw0 = w * 0.22, hw1 = w * 0.3;
    const v0 = b.vertexCount;
    b.set({ aWind: [0] });
    b.vertex([ca * r0 - tx * hw0, 0, sa * r0 - tz * hw0], [0, 1, 0], 0, 1);
    b.vertex([ca * r0 + tx * hw0, 0, sa * r0 + tz * hw0], [0, 1, 0], 1, 1);
    b.set({ aWind: [1] });
    b.vertex([ca * r1 + tx * hw1, h, sa * r1 + tz * hw1], [0, 1, 0], 1, 0);
    b.vertex([ca * r1 - tx * hw1, h, sa * r1 - tz * hw1], [0, 1, 0], 0, 0);
    b.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
  }
  return b.build();
}
