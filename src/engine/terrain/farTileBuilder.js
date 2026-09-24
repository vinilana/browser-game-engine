// Worker-side mesh builder for FarTerrain tiles (no three.js dependency).

/**
 * Worker-side tile builder: samples `farSample(x, z, out)` on a (res+1)^2 grid
 * and returns an indexed mesh with skirts.
 * out = { h, r, g, b, water }
 */
export function buildFarTile(farSample, { x0, z0, size, res }) {
  const n = res + 1;
  const step = size / res;
  // sample with a 1-cell margin for normals
  const m = n + 2;
  const H = new Float32Array(m * m);
  const C = new Uint8Array(n * n * 4);
  const out = { h: 0, r: 0, g: 0, b: 0, water: 0, forest: 0 };
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
      farSample(x, z, out);
      H[j * m + i] = out.h;
      if (i >= 1 && j >= 1 && i <= n && j <= n) {
        const o = ((j - 1) * n + (i - 1)) * 4;
        C[o] = out.r; C[o + 1] = out.g; C[o + 2] = out.b; C[o + 3] = out.water ? 255 : Math.round(Math.min(1, out.forest || 0) * 200);
      }
    }
  }
  const vcount = n * n + 4 * n;
  const pos = new Float32Array(vcount * 3);
  const nrm = new Int8Array(vcount * 3);
  const col = new Uint8Array(vcount * 4);
  let minY = 1e9, maxY = -1e9;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const h = H[(j + 1) * m + (i + 1)];
      pos[v * 3] = i * step; pos[v * 3 + 1] = h; pos[v * 3 + 2] = j * step;
      const dx = H[(j + 1) * m + (i + 2)] - H[(j + 1) * m + i];
      const dz = H[(j + 2) * m + (i + 1)] - H[j * m + (i + 1)];
      let nx = -dx, ny = 2 * step, nz = -dz;
      const l = Math.hypot(nx, ny, nz);
      nrm[v * 3] = (nx / l) * 127; nrm[v * 3 + 1] = (ny / l) * 127; nrm[v * 3 + 2] = (nz / l) * 127;
      for (let k = 0; k < 4; k++) col[v * 4 + k] = C[v * 4 + k];
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  }
  // skirts
  const edges = [];
  for (let i = 0; i < n; i++) edges.push(i);                 // z = 0
  for (let i = 0; i < n; i++) edges.push((n - 1) * n + i);   // z = max
  for (let j = 0; j < n; j++) edges.push(j * n);             // x = 0
  for (let j = 0; j < n; j++) edges.push(j * n + n - 1);     // x = max
  let sv = n * n;
  const skirtOf = new Int32Array(edges.length);
  edges.forEach((v, k) => {
    pos[sv * 3] = pos[v * 3]; pos[sv * 3 + 1] = pos[v * 3 + 1] - 18; pos[sv * 3 + 2] = pos[v * 3 + 2];
    for (let q = 0; q < 3; q++) nrm[sv * 3 + q] = nrm[v * 3 + q];
    for (let q = 0; q < 4; q++) col[sv * 4 + q] = col[v * 4 + q];
    skirtOf[k] = sv++;
  });
  const quads = res * res + 4 * res;
  const idx = new Uint32Array(quads * 6);
  let o = 0;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b;
      idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
  }
  const skirt = (list, base, flip) => {
    for (let k = 0; k < res; k++) {
      const a = list[k], b = list[k + 1], sa = skirtOf[base + k], sb = skirtOf[base + k + 1];
      if (flip) { idx[o++] = a; idx[o++] = b; idx[o++] = sa; idx[o++] = b; idx[o++] = sb; idx[o++] = sa; }
      else { idx[o++] = a; idx[o++] = sa; idx[o++] = b; idx[o++] = b; idx[o++] = sa; idx[o++] = sb; }
    }
  };
  skirt(edges.slice(0, n), 0, false);
  skirt(edges.slice(n, 2 * n), n, true);
  skirt(edges.slice(2 * n, 3 * n), 2 * n, true);
  skirt(edges.slice(3 * n, 4 * n), 3 * n, false);
  return { pos, nrm, col, idx: idx.subarray(0, o).slice(), minY, maxY };
}
