// Procedural medieval buildings. Each builder returns { parts: {materialKey: geometry}, height, door, sails? }.
// Material keys: masonry, masonryDark, plaster, wood, planks, roofTiles, thatch, shingles, straw, iron, cloth (team).
import { MeshBuilder } from '../../engine/geometry/MeshBuilder.js';
import { mulberry32 } from '../../engine/math/rng.js';

class Parts {
  constructor() { this.b = {}; }
  get(k) { if (!this.b[k]) { this.b[k] = new MeshBuilder({ attributes: { aWind: 1 } }); } return this.b[k]; }
  build() {
    const out = {};
    for (const [k, b] of Object.entries(this.b)) if (b.vertexCount) out[k] = b.build();
    return out;
  }
}

/** Foundation plinth sunk into the ground (hides uneven terrain). */
function plinth(P, w, d, h = 0.5, mat = 'masonry') {
  P.get(mat).box(0, h / 2 - 0.8, 0, w, h + 1.6, d);
}

/** Half-timbered wall block: plaster box + oak beams. */
function timberWalls(P, cx, y0, cz, w, d, h, { braces = true, rnd = Math.random } = {}) {
  P.get('plaster').box(cx, y0 + h / 2, cz, w, h, d, { faces: ['px', 'nx', 'pz', 'nz'] });
  const W = P.get('wood');
  const t = 0.18;
  // corner posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) W.box(cx + sx * (w / 2), y0 + h / 2, cz + sz * (d / 2), t + 0.04, h, t + 0.04);
  // sill + top plates + mid rail
  for (const y of [y0 + 0.08, y0 + h - 0.08, y0 + h * 0.52]) {
    W.box(cx, y, cz + d / 2 + 0.03, w + 0.1, t * 0.9, t * 0.5);
    W.box(cx, y, cz - d / 2 - 0.03, w + 0.1, t * 0.9, t * 0.5);
    W.box(cx + w / 2 + 0.03, y, cz, t * 0.5, t * 0.9, d + 0.1);
    W.box(cx - w / 2 - 0.03, y, cz, t * 0.5, t * 0.9, d + 0.1);
  }
  // studs
  const studs = (len, place) => {
    const n = Math.max(1, Math.round(len / 1.4));
    for (let k = 1; k < n; k++) place(-len / 2 + (k / n) * len);
  };
  studs(w, (x) => { W.box(cx + x, y0 + h / 2, cz + d / 2 + 0.03, t * 0.8, h, t * 0.5); W.box(cx + x, y0 + h / 2, cz - d / 2 - 0.03, t * 0.8, h, t * 0.5); });
  studs(d, (z) => { W.box(cx + w / 2 + 0.03, y0 + h / 2, cz + z, t * 0.5, h, t * 0.8); W.box(cx - w / 2 - 0.03, y0 + h / 2, cz + z, t * 0.5, h, t * 0.8); });
  if (braces) {
    // diagonal braces near the corners
    const L = Math.hypot(1.2, h * 0.48);
    const ang = Math.atan2(h * 0.48, 1.2);
    for (const sx of [-1, 1]) {
      for (const [zz, face] of [[d / 2 + 0.04, 1], [-d / 2 - 0.04, -1]]) {
        W.push().translate(cx + sx * (w / 2 - 0.7), y0 + h * 0.26, cz + zz).rotate(0, 0, sx * ang * face * (face > 0 ? 1 : -1)).box(0, 0, 0, L, t * 0.7, t * 0.45).pop();
      }
    }
  }
  void rnd;
}

function door(P, x, z, face, w = 1.2, h = 2.1, y0 = 0) {
  const W = P.get('wood'), D = P.get('planks');
  if (face === 'pz' || face === 'nz') {
    const s = face === 'pz' ? 1 : -1;
    D.box(x, y0 + h / 2, z + s * 0.06, w, h, 0.1);
    W.box(x, y0 + h + 0.08, z + s * 0.1, w + 0.35, 0.18, 0.16);
    W.box(x - w / 2 - 0.1, y0 + h / 2, z + s * 0.1, 0.16, h, 0.16);
    W.box(x + w / 2 + 0.1, y0 + h / 2, z + s * 0.1, 0.16, h, 0.16);
  } else {
    const s = face === 'px' ? 1 : -1;
    D.box(x + s * 0.06, y0 + h / 2, z, 0.1, h, w);
    W.box(x + s * 0.1, y0 + h + 0.08, z, 0.16, 0.18, w + 0.35);
  }
}

function windowAt(P, x, y, z, face, w = 0.8, h = 0.9) {
  const W = P.get('wood'), D = P.get('masonryDark');
  if (face === 'pz' || face === 'nz') {
    const s = face === 'pz' ? 1 : -1;
    D.box(x, y, z + s * 0.02, w, h, 0.06);
    W.box(x, y - h / 2 - 0.06, z + s * 0.12, w + 0.3, 0.1, 0.2);
    W.box(x - w / 2 - 0.22, y, z + s * 0.1, 0.36, h + 0.1, 0.05);
    W.box(x + w / 2 + 0.22, y, z + s * 0.1, 0.36, h + 0.1, 0.05);
  } else {
    const s = face === 'px' ? 1 : -1;
    D.box(x + s * 0.02, y, z, 0.06, h, w);
    W.box(x + s * 0.12, y - h / 2 - 0.06, z, 0.2, 0.1, w + 0.3);
  }
}

function chimney(P, x, z, y0, h) {
  P.get('masonryDark').box(x, y0 + h / 2, z, 0.7, h, 0.7);
  P.get('masonryDark').box(x, y0 + h + 0.08, z, 0.85, 0.16, 0.85);
}

function banner(P, x, y, z, face, w = 0.9, h = 1.8) {
  const C = P.get('cloth');
  const Wd = P.get('wood');
  if (face === 'pz' || face === 'nz') {
    const s = face === 'pz' ? 1 : -1;
    Wd.box(x, y + 0.05, z + s * 0.2, w + 0.3, 0.08, 0.08);
    C.set({ aWind: [0.25] });
    C.box(x, y - h / 2, z + s * 0.18, w, h, 0.03);
    C.set({ aWind: [0] });
  } else {
    const s = face === 'px' ? 1 : -1;
    Wd.box(x + s * 0.2, y + 0.05, z, 0.08, 0.08, w + 0.3);
    C.set({ aWind: [0.25] });
    C.box(x + s * 0.18, y - h / 2, z, 0.03, h, w);
    C.set({ aWind: [0] });
  }
}

function flagpole(P, x, y0, z, h = 4) {
  P.get('wood').cylinder([x, y0, z], [x, y0 + h, z], 0.06, 0.04, 6);
  const C = P.get('cloth');
  C.set({ aWind: [0] });
  const v0 = C.vertexCount;
  const pts = [[x, y0 + h - 0.1], [x + 1.6, y0 + h - 0.35], [x + 1.6, y0 + h - 1.15], [x, y0 + h - 1.0]];
  // flag with increasing wind weight toward the free edge
  C.set({ aWind: [0] }); C.vertex([pts[0][0], pts[0][1], z], [0, 0, 1], 0, 0);
  C.set({ aWind: [1.4] }); C.vertex([pts[1][0], pts[1][1], z], [0, 0, 1], 1, 0);
  C.set({ aWind: [1.4] }); C.vertex([pts[2][0], pts[2][1], z], [0, 0, 1], 1, 1);
  C.set({ aWind: [0] }); C.vertex([pts[3][0], pts[3][1], z], [0, 0, 1], 0, 1);
  C.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
  C.set({ aWind: [0] });
}

function crate(P, x, z, y0 = 0, s = 0.8) { P.get('planks').box(x, y0 + s / 2, z, s, s, s); }
function barrel(P, x, z, y0 = 0) {
  P.get('planks').cylinder([x, y0, z], [x, y0 + 0.9, z], 0.34, 0.34, 10);
  P.get('iron').cylinder([x, y0 + 0.18, z], [x, y0 + 0.24, z], 0.36, 0.36, 10, { caps: false });
  P.get('iron').cylinder([x, y0 + 0.68, z], [x, y0 + 0.74, z], 0.36, 0.36, 10, { caps: false });
}
function logPile(P, x, z, len = 3, rows = 3, rot = 0) {
  const B = P.get('bark');
  B.push().translate(x, 0, z).rotate(0, rot, 0);
  for (let r = 0; r < rows; r++) {
    const n = rows - r + 1;
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 0.46;
      const y = 0.22 + r * 0.38;
      B.cylinder([-len / 2, y, off], [len / 2, y, off], 0.21, 0.21, 7);
    }
  }
  B.pop();
}
function fence(P, x0, z0, x1, z1, y0 = 0) {
  const W = P.get('wood');
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 2));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    W.box(x0 + (x1 - x0) * t, y0 + 0.55, z0 + (z1 - z0) * t, 0.14, 1.1, 0.14);
  }
  for (const y of [0.45, 0.9]) W.cylinder([x0, y0 + y, z0], [x1, y0 + y, z1], 0.05, 0.05, 5, { caps: false });
}

// ---------------------------------------------------------------------------
export const BUILDING_MODELS = {
  house(seed) {
    const rnd = mulberry32(seed + 17);
    const P = new Parts();
    plinth(P, 5.4, 4.8, 0.45);
    const h = 2.6;
    timberWalls(P, 0, 0.45, 0, 4.8, 4.2, h, { rnd });
    const roof = rnd() < 0.55 ? 'thatch' : 'shingles';
    P.get(roof).gable(0, 0.45 + h, 0, 4.8, 4.2, 2.3, { overhang: 0.55, thickness: 0.25, endBuilder: P.get('plaster') });
    P.get('wood').box(0, 0.45 + h + 2.3, 0, 5.9, 0.16, 0.16);
    door(P, 0.9, 2.1, 'pz', 1.0, 1.9, 0.45);
    windowAt(P, -1.2, 1.9, 2.1, 'pz');
    windowAt(P, 2.4, 1.9, 0.3, 'px');
    windowAt(P, -2.4, 1.9, -0.4, 'nx');
    chimney(P, -1.5, -1.1, 2.4, 3.3);
    barrel(P, 2.0, 2.6);
    crate(P, -2.6, 2.4, 0, 0.6);
    return { parts: P.build(), height: 6.4 };
  },

  town_center(seed) {
    const rnd = mulberry32(seed + 3);
    const P = new Parts();
    plinth(P, 13, 13, 0.7);
    // stone ground floor with arcade
    const M = P.get('masonry');
    M.box(0, 0.7 + 1.9, 0, 11, 3.8, 11);
    // upper timber floor with jetty
    timberWalls(P, 0, 4.5, 0, 11.8, 11.8, 3.2, { rnd });
    P.get('wood').box(0, 4.45, 0, 12.2, 0.3, 12.2);
    // hip-ish roof made of two crossing gables
    P.get('roofTiles').gable(0, 7.7, 0, 11.8, 11.8, 4.2, { overhang: 0.7, thickness: 0.3, endBuilder: P.get('plaster') });
    P.get('roofTiles').push().rotate(0, Math.PI / 2, 0).gable(0, 7.7, 0, 7.0, 11.8, 4.2, { overhang: 0.7, thickness: 0.3, gableEnds: false }).pop();
    // central bell tower
    M.box(0, 11.5, 0, 3.4, 5, 3.4);
    for (const [x, z] of [[1.7, 0], [-1.7, 0], [0, 1.7], [0, -1.7]]) {
      P.get('masonryDark').box(x * 1.02, 13.0, z * 1.02, Math.abs(z) > 0 ? 1.2 : 0.1, 1.4, Math.abs(x) > 0 ? 1.2 : 0.1);
    }
    P.get('roofTiles').pyramid(0, 14.0, 0, 3.6, 3.6, 3.4, { overhang: 0.35 });
    flagpole(P, 0, 17.3, 0, 3.2);
    // doorways on all sides + steps
    for (const [x, z, f] of [[0, 5.5, 'pz'], [0, -5.5, 'nz'], [5.5, 0, 'px'], [-5.5, 0, 'nx']]) {
      door(P, x, z, f, 1.8, 2.6, 0.7);
      if (f === 'pz' || f === 'nz') {
        const s = f === 'pz' ? 1 : -1;
        M.box(0, 0.35, z + s * 1.0, 3.2, 0.7, 1.4);
        banner(P, 2.3, 4.2, z, f, 1.0, 2.0);
        banner(P, -2.3, 4.2, z, f, 1.0, 2.0);
      } else {
        const s = f === 'px' ? 1 : -1;
        M.box(x + s * 1.0, 0.35, 0, 1.4, 0.7, 3.2);
      }
      for (const off of [-3.2, 3.2]) {
        if (f === 'pz' || f === 'nz') windowAt(P, off, 6.2, z + (f === 'pz' ? 0.35 : -0.35), f, 0.9, 1.0);
        else windowAt(P, x + (f === 'px' ? 0.35 : -0.35), 6.2, off, f, 0.9, 1.0);
      }
    }
    for (const [x, z] of [[5.9, 6.2], [-6.2, 5.8], [6.1, -6.0]]) barrel(P, x, z);
    crate(P, -6.3, -6.2); crate(P, -5.5, -6.4, 0, 0.6);
    return { parts: P.build(), height: 20.5 };
  },

  lumber_camp() {
    const P = new Parts();
    const W = P.get('wood');
    for (const [x, z] of [[-2.8, -1.6], [2.8, -1.6], [-2.8, 1.6], [2.8, 1.6]]) W.box(x, 1.45, z, 0.3, 2.9, 0.3);
    P.get('shingles').gable(0, 2.9, 0, 5.6, 3.2, 1.4, { overhang: 0.5, thickness: 0.2, gableEnds: false });
    W.box(0, 2.95, 0, 6.2, 0.2, 0.2);
    P.get('planks').box(0, 1.45, -1.62, 5.6, 2.9, 0.12);
    logPile(P, 0, 0.2, 4.2, 3);
    logPile(P, 1.6, 3.2, 3, 2, 0.1);
    // sawhorse + stump + axe
    W.box(-2.2, 0.55, 3.2, 1.6, 0.12, 0.12);
    for (const s of [-1, 1]) W.box(-2.2 + s * 0.6, 0.3, 3.2, 0.1, 0.6, 0.5);
    P.get('bark').cylinder([2.9, 0, -3.0], [2.9, 0.6, -3.0], 0.4, 0.38, 9);
    return { parts: P.build(), height: 4.6 };
  },

  mining_camp() {
    const P = new Parts();
    const W = P.get('wood');
    for (const [x, z] of [[-2.6, -1.4], [2.6, -1.4], [-2.6, 1.4], [2.6, 1.4]]) W.box(x, 1.4, z, 0.3, 2.8, 0.3);
    P.get('shingles').gable(0, 2.8, 0, 5.2, 2.8, 1.3, { overhang: 0.5, thickness: 0.2, gableEnds: false });
    P.get('planks').box(0, 1.4, -1.42, 5.2, 2.8, 0.12);
    // ore cart
    P.get('planks').box(1.8, 0.75, 2.8, 1.6, 0.7, 1.0);
    for (const s of [-1, 1]) for (const t of [-1, 1]) P.get('iron').cylinder([1.8 + t * 0.55, 0.3, 2.8 + s * 0.55], [1.8 + t * 0.55, 0.3, 2.8 + s * 0.62], 0.3, 0.3, 10);
    P.get('stoneOre').sphere([1.8, 1.15, 2.8], [0.65, 0.3, 0.4], 8, 5);
    P.get('stoneOre').sphere([-1.2, 0.3, 0.2], [0.9, 0.5, 0.8], 8, 5);
    P.get('goldOre').sphere([-2.2, 0.25, 0.6], [0.5, 0.35, 0.5], 7, 4);
    crate(P, -2.4, 2.8); crate(P, -1.6, 3.1, 0, 0.6); barrel(P, 2.8, -2.9);
    return { parts: P.build(), height: 4.4 };
  },

  mill() {
    const P = new Parts();
    plinth(P, 5.6, 5.6, 0.4, 'masonry');
    P.get('masonry').cylinder([0, 0, 0], [0, 7.2, 0], 2.5, 2.0, 16, { caps: false, uvScale: 0.5 });
    P.get('thatch').cone([0, 7.0, 0], [0, 10.4, 0], 2.6, 16, { uvScale: 0.5 });
    door(P, 0, 2.45, 'pz', 1.1, 2.0, 0.1);
    windowAt(P, 0, 4.6, 2.2, 'pz', 0.6, 0.7);
    P.get('wood').box(0, 7.4, 2.3, 0.3, 0.3, 1.0);
    // sails as a separate animated part
    const S = new MeshBuilder({ attributes: { aWind: 1 } });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      S.push().rotate(0, 0, a);
      S.box(0, 3.1, 0, 0.16, 6.2, 0.12);
      for (let r = 0; r < 6; r++) S.box(0.55, 1.0 + r * 0.95, 0.05, 1.0, 0.07, 0.05);
      S.box(1.05, 3.6, 0.05, 0.07, 5.2, 0.05);
      S.pop();
    }
    const sails = S.build();
    // canvas stretched over the lattice
    const C = new MeshBuilder({ attributes: { aWind: 1 } });
    for (let k = 0; k < 4; k++) {
      C.push().rotate(0, 0, (k / 4) * Math.PI * 2);
      C.box(0.56, 3.55, 0.1, 0.94, 5.0, 0.025, { uvScale: 0.6 });
      C.pop();
    }
    const sailsCloth = C.build();
    for (let x = -2.5; x <= 2.5; x += 1.25) {
      P.get('straw').box(x + 3.6, 0.3, -2.8, 1.0, 0.6, 0.8);
    }
    return { parts: P.build(), height: 11.5, sails, sailsCloth, sailsPos: [0, 7.4, 2.9] };
  },

  farm() {
    const P = new Parts();
    const F = P.get('farmland');
    F.box(0, 0.02, 0, 9.4, 0.08, 9.4, { faces: ['py'] });
    for (const [x0, z0, x1, z1] of [[-4.8, -4.8, 4.8, -4.8], [-4.8, -4.8, -4.8, 4.8]]) fence(P, x0, z0, x1, z1);
    return { parts: P.build(), height: 1.2 };
  },

  barracks(seed) {
    const rnd = mulberry32(seed + 5);
    const P = new Parts();
    plinth(P, 10, 6.6, 0.5);
    P.get('masonry').box(0, 0.5 + 1.2, -1.5, 9.4, 2.4, 6.0);
    timberWalls(P, 0, 2.9, -1.5, 9.4, 6.0, 2.2, { rnd });
    P.get('shingles').gable(0, 5.1, -1.5, 9.4, 6.0, 2.8, { overhang: 0.6, thickness: 0.25, endBuilder: P.get('plaster') });
    door(P, 0, 1.5, 'pz', 1.8, 2.3, 0.5);
    for (const x of [-3, 3]) { windowAt(P, x, 4.0, 1.55, 'pz'); banner(P, x, 2.6, 1.5, 'pz', 0.9, 1.6); }
    // training yard: weapon rack and dummy
    fence(P, -5, 5, 5, 5);
    const W = P.get('wood');
    W.box(-3, 1.0, 3.2, 2.2, 0.12, 0.12);
    for (const s of [-1, 1]) W.box(-3 + s, 0.5, 3.2, 0.12, 1.0, 0.4);
    for (let k = 0; k < 5; k++) P.get('iron').box(-3.8 + k * 0.4, 0.85, 3.3, 0.05, 1.3, 0.05);
    W.box(2.5, 0.9, 3.2, 0.14, 1.8, 0.14);
    P.get('straw').box(2.5, 1.4, 3.2, 0.5, 0.8, 0.35);
    W.box(2.5, 1.5, 3.2, 1.2, 0.1, 0.1);
    flagpole(P, 4.6, 0, -4.4, 6);
    return { parts: P.build(), height: 8.5 };
  },

  archery_range(seed) {
    const rnd = mulberry32(seed + 9);
    const P = new Parts();
    plinth(P, 7, 4.4, 0.4);
    timberWalls(P, 0, 0.4, -3, 6.6, 3.8, 2.5, { rnd });
    P.get('thatch').gable(0, 2.9, -3, 6.6, 3.8, 2.2, { overhang: 0.55, thickness: 0.25, endBuilder: P.get('plaster') });
    door(P, 0, -1.1, 'pz', 1.2, 2.0, 0.4);
    banner(P, -2, 2.2, -1.1, 'pz', 0.8, 1.4);
    fence(P, -5.2, 1, -5.2, 5.2); fence(P, 5.2, 1, 5.2, 5.2); fence(P, -5.2, 5.2, 5.2, 5.2);
    // targets
    for (const x of [-2.5, 0, 2.5]) {
      P.get('wood').box(x, 0.7, 4.3, 0.1, 1.4, 0.1);
      P.get('straw').cylinder([x, 1.3, 4.2], [x, 1.3, 4.0], 0.55, 0.55, 14);
      P.get('cloth').cylinder([x, 1.3, 3.99], [x, 1.3, 3.98], 0.2, 0.2, 12);
    }
    return { parts: P.build(), height: 5.6 };
  },

  stable() {
    const P = new Parts();
    plinth(P, 10, 6.4, 0.3);
    P.get('planks').box(0, 0.3 + 1.6, -1.2, 9.4, 3.2, 5.8, { faces: ['px', 'nx', 'nz'] });
    P.get('planks').box(-2.5, 0.3 + 1.6, 1.7, 4.4, 3.2, 0.12);
    const W = P.get('wood');
    for (const x of [-4.7, 0.2, 4.7]) W.box(x, 1.9, 1.75, 0.3, 3.2, 0.3);
    W.box(0, 3.45, 1.75, 9.6, 0.25, 0.25);
    P.get('shingles').gable(0, 3.5, -1.2, 9.4, 5.8, 2.6, { overhang: 0.6, thickness: 0.25, endBuilder: P.get('planks') });
    fence(P, -5, 5, 5, 5); fence(P, 5, 2.2, 5, 5);
    for (const [x, z] of [[2.4, 3.5], [3.4, 3.8]]) P.get('straw').box(x, 0.35, z, 1.1, 0.7, 0.8);
    P.get('planks').box(-3.2, 0.35, 3.4, 1.8, 0.5, 0.5);
    flagpole(P, -4.6, 0, 3.6, 5);
    return { parts: P.build(), height: 7 };
  },

  watch_tower() {
    const P = new Parts();
    plinth(P, 4.2, 4.2, 0.4);
    P.get('masonry').box(0, 0.4 + 3.8, 0, 3.4, 7.6, 3.4);
    P.get('wood').box(0, 8.2, 0, 4.4, 0.3, 4.4);
    for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) P.get('wood').box(x, 9.2, z, 0.2, 1.9, 0.2);
    P.get('planks').box(0, 8.8, 2.1, 4.2, 0.9, 0.08);
    P.get('planks').box(0, 8.8, -2.1, 4.2, 0.9, 0.08);
    P.get('planks').box(2.1, 8.8, 0, 0.08, 0.9, 4.2);
    P.get('planks').box(-2.1, 8.8, 0, 0.08, 0.9, 4.2);
    P.get('shingles').pyramid(0, 10.1, 0, 4.2, 4.2, 2.6, { overhang: 0.4 });
    door(P, 0, 1.72, 'pz', 1.0, 1.9, 0.4);
    flagpole(P, 0, 12.6, 0, 2.4);
    return { parts: P.build(), height: 13 };
  },
};

/** Wooden scaffolding shown around construction sites. */
export function buildScaffold(size, height) {
  const P = new Parts();
  const W = P.get('wood');
  const h = Math.min(height, 9);
  const half = size / 2 - 0.2;
  const n = Math.max(2, Math.round(size / 2.5));
  for (let k = 0; k <= n; k++) {
    const t = -half + (k / n) * 2 * half;
    for (const [x, z] of [[t, half], [t, -half], [half, t], [-half, t]]) W.box(x, h / 2, z, 0.1, h, 0.1);
  }
  for (let y = 1.8; y < h; y += 1.8) {
    W.box(0, y, half, size, 0.08, 0.3); W.box(0, y, -half, size, 0.08, 0.3);
    W.box(half, y, 0, 0.3, 0.08, size); W.box(-half, y, 0, 0.3, 0.08, size);
  }
  return P.build().wood;
}
