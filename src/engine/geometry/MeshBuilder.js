import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector3, Matrix3, Quaternion, Euler } from 'three';

const _v = new Vector3(), _n = new Vector3(), _a = new Vector3(), _b = new Vector3(), _c = new Vector3();

/**
 * Procedural geometry builder. Accumulates primitives into one indexed
 * BufferGeometry with position / normal / uv / color and any number of custom
 * float attributes (set the "current" values with `set`). UVs of box / prism
 * faces are in meters times `uvScale`, so tiling textures keep a constant
 * texel density across differently sized parts.
 */
export class MeshBuilder {
  constructor({ attributes = {} } = {}) {
    this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = [];
    this.custom = {};
    this.customSize = attributes;
    this.cur = { color: [1, 1, 1] };
    for (const [k, n] of Object.entries(attributes)) { this.custom[k] = []; this.cur[k] = new Array(n).fill(0); }
    this.matrix = new Matrix4();
    this.normalMatrix = new Matrix3();
    this.stack = [];
    this.uvScale = 1;
  }

  /** Sets current vertex attribute values: { color:[r,g,b], aPart:[3], ... } */
  set(values) {
    for (const [k, v] of Object.entries(values)) this.cur[k] = Array.isArray(v) ? v : [v];
    return this;
  }

  push() { this.stack.push(this.matrix.clone()); return this; }
  pop() { this.matrix.copy(this.stack.pop()); this.normalMatrix.getNormalMatrix(this.matrix); return this; }
  translate(x, y, z) { this.matrix.multiply(new Matrix4().makeTranslation(x, y, z)); this.normalMatrix.getNormalMatrix(this.matrix); return this; }
  rotate(x, y, z) { this.matrix.multiply(new Matrix4().makeRotationFromEuler(new Euler(x, y, z))); this.normalMatrix.getNormalMatrix(this.matrix); return this; }
  scale(x, y, z) { this.matrix.multiply(new Matrix4().makeScale(x, y ?? x, z ?? x)); this.normalMatrix.getNormalMatrix(this.matrix); return this; }

  vertex(p, n, u, v) {
    _v.set(p[0], p[1], p[2]).applyMatrix4(this.matrix);
    _n.set(n[0], n[1], n[2]).applyMatrix3(this.normalMatrix).normalize();
    this.pos.push(_v.x, _v.y, _v.z);
    this.nrm.push(_n.x, _n.y, _n.z);
    this.uv.push(u, v);
    const c = this.cur.color;
    this.col.push(c[0], c[1], c[2]);
    for (const k of Object.keys(this.custom)) this.custom[k].push(...this.cur[k]);
    return this.pos.length / 3 - 1;
  }

  /** Quad with explicit corners (counter-clockwise when seen from the front). */
  quad(p0, p1, p2, p3, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]], normal = null) {
    let n = normal;
    if (!n) {
      _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      _b.set(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
      _c.crossVectors(_a, _b).normalize();
      n = [_c.x, _c.y, _c.z];
    }
    const a = this.vertex(p0, n, uvs[0][0], uvs[0][1]);
    const b = this.vertex(p1, n, uvs[1][0], uvs[1][1]);
    const c = this.vertex(p2, n, uvs[2][0], uvs[2][1]);
    const d = this.vertex(p3, n, uvs[3][0], uvs[3][1]);
    this.idx.push(a, b, c, a, c, d);
    return this;
  }

  tri(p0, p1, p2, uvs = [[0, 0], [1, 0], [0.5, 1]]) {
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    _b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    _c.crossVectors(_a, _b).normalize();
    const n = [_c.x, _c.y, _c.z];
    const a = this.vertex(p0, n, uvs[0][0], uvs[0][1]);
    const b = this.vertex(p1, n, uvs[1][0], uvs[1][1]);
    const c = this.vertex(p2, n, uvs[2][0], uvs[2][1]);
    this.idx.push(a, b, c);
    return this;
  }

  /** Axis-aligned box (in the current transform), center + full size. */
  box(cx, cy, cz, sx, sy, sz, { uvScale = this.uvScale, faces = 'all' } = {}) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const k = uvScale;
    const f = (name) => faces === 'all' || faces.includes(name);
    if (f('px')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [[0, 0], [sz * k, 0], [sz * k, sy * k], [0, sy * k]], [1, 0, 0]);
    if (f('nx')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [[0, 0], [sz * k, 0], [sz * k, sy * k], [0, sy * k]], [-1, 0, 0]);
    if (f('pz')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [[0, 0], [sx * k, 0], [sx * k, sy * k], [0, sy * k]], [0, 0, 1]);
    if (f('nz')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [[0, 0], [sx * k, 0], [sx * k, sy * k], [0, sy * k]], [0, 0, -1]);
    if (f('py')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [[0, 0], [sx * k, 0], [sx * k, sz * k], [0, sz * k]], [0, 1, 0]);
    if (f('ny')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [[0, 0], [sx * k, 0], [sx * k, sz * k], [0, sz * k]], [0, -1, 0]);
    return this;
  }

  /**
   * Tapered cylinder between two points. `smooth` normals; uv wraps around
   * (u = circumference meters * uvScale, v = length).
   */
  cylinder(p0, p1, r0, r1, segs = 8, { caps = true, uvScale = this.uvScale, wrapU = null } = {}) {
    const A = new Vector3(...p0), B = new Vector3(...p1);
    const axis = new Vector3().subVectors(B, A);
    const len = axis.length();
    axis.normalize();
    const tmp = Math.abs(axis.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const u = new Vector3().crossVectors(axis, tmp).normalize();
    const w = new Vector3().crossVectors(axis, u).normalize();
    const circ = Math.PI * (r0 + r1);
    const base = this.pos.length / 3;
    const slope = (r0 - r1) / Math.max(len, 1e-6);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const dir = new Vector3().addScaledVector(u, Math.cos(a)).addScaledVector(w, Math.sin(a));
      const n = dir.clone().addScaledVector(axis, slope).normalize();
      const uu = wrapU ? (i / segs) * wrapU : (i / segs) * circ * uvScale;
      const q0 = A.clone().addScaledVector(dir, r0), q1 = B.clone().addScaledVector(dir, r1);
      this.vertex([q0.x, q0.y, q0.z], [n.x, n.y, n.z], uu, 0);
      this.vertex([q1.x, q1.y, q1.z], [n.x, n.y, n.z], uu, len * uvScale);
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      this.idx.push(a, c, d, a, d, b);
    }
    if (caps) {
      for (const [P, r, s] of [[A, r0, -1], [B, r1, 1]]) {
        if (r <= 0.001) continue;
        const center = this.vertex([P.x, P.y, P.z], [axis.x * s, axis.y * s, axis.z * s], 0.5, 0.5);
        const ring = [];
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          const q = P.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(w, Math.sin(a) * r);
          ring.push(this.vertex([q.x, q.y, q.z], [axis.x * s, axis.y * s, axis.z * s], 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5));
        }
        for (let i = 0; i < segs; i++) {
          if (s > 0) this.idx.push(center, ring[i], ring[i + 1]);
          else this.idx.push(center, ring[i + 1], ring[i]);
        }
      }
    }
    return this;
  }

  cone(p0, p1, r, segs = 8, opts = {}) { return this.cylinder(p0, p1, r, 0.0001, segs, { ...opts, caps: true }); }

  /** UV sphere / ellipsoid. radius may be a number or [rx, ry, rz]. */
  sphere(c, radius, segs = 10, rings = 7, { noise = null } = {}) {
    const [rx, ry, rz] = Array.isArray(radius) ? radius : [radius, radius, radius];
    const base = this.pos.length / 3;
    for (let r = 0; r <= rings; r++) {
      const th = (r / rings) * Math.PI;
      for (let s = 0; s <= segs; s++) {
        const ph = (s / segs) * Math.PI * 2;
        const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
        let k = 1;
        if (noise) k = 1 + noise(nx, ny, nz);
        const nn = _n.set(nx / rx, ny / ry, nz / rz).normalize();
        this.vertex([c[0] + nx * rx * k, c[1] + ny * ry * k, c[2] + nz * rz * k], [nn.x, nn.y, nn.z], s / segs, r / rings);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = base + r * (segs + 1) + s, b = a + segs + 1;
        this.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    return this;
  }

  /**
   * Gabled roof over a rectangle (ridge along x). Returns the builder.
   * y0 = eave height, h = ridge rise, overhang extends in all directions.
   */
  gable(cx, y0, cz, sx, sz, h, { overhang = 0.4, thickness = 0.15, uvScale = this.uvScale, gableEnds = true, endBuilder = null } = {}) {
    const x0 = cx - sx / 2 - overhang, x1 = cx + sx / 2 + overhang;
    const zf = cz + sz / 2 + overhang, zb = cz - sz / 2 - overhang;
    const yr = y0 + h;
    const drop = overhang * (h / (sz / 2));
    const ye = y0 - drop;
    const slopeLen = Math.hypot(sz / 2 + overhang, h + drop);
    const k = uvScale;
    const L = (x1 - x0) * k, S = slopeLen * k;
    // front slope (+z)
    this.quad([x0, ye, zf], [x1, ye, zf], [x1, yr, cz], [x0, yr, cz], [[0, S], [L, S], [L, 0], [0, 0]]);
    // back slope (-z)
    this.quad([x1, ye, zb], [x0, ye, zb], [x0, yr, cz], [x1, yr, cz], [[0, S], [L, S], [L, 0], [0, 0]]);
    // underside / thickness
    if (thickness > 0) {
      this.quad([x0, ye - thickness, zf], [x0, ye, zf], [x1, ye, zf], [x1, ye - thickness, zf], [[0, 0], [0, thickness * k], [L, thickness * k], [L, 0]]);
      this.quad([x1, ye - thickness, zb], [x1, ye, zb], [x0, ye, zb], [x0, ye - thickness, zb], [[0, 0], [0, thickness * k], [L, thickness * k], [L, 0]]);
      this.quad([x1, ye - thickness, zf], [x1, yr - thickness, cz], [x0, yr - thickness, cz], [x0, ye - thickness, zf], [[0, 0], [0, S], [L, S], [L, 0]]);
      this.quad([x0, ye - thickness, zb], [x0, yr - thickness, cz], [x1, yr - thickness, cz], [x1, ye - thickness, zb], [[0, 0], [0, S], [L, S], [L, 0]]);
    }
    if (gableEnds) {
      const eb = endBuilder || this;
      const gx0 = cx - sx / 2, gx1 = cx + sx / 2;
      const gz0 = cz - sz / 2, gz1 = cz + sz / 2;
      eb.tri([gx1, y0, gz1], [gx1, y0, gz0], [gx1, yr, cz], [[0, 0], [sz * k, 0], [sz * k / 2, h * k]]);
      eb.tri([gx0, y0, gz0], [gx0, y0, gz1], [gx0, yr, cz], [[0, 0], [sz * k, 0], [sz * k / 2, h * k]]);
    }
    return this;
  }

  /** Pyramid / hip roof over a rectangle. */
  pyramid(cx, y0, cz, sx, sz, h, { overhang = 0.3, uvScale = this.uvScale } = {}) {
    const x0 = cx - sx / 2 - overhang, x1 = cx + sx / 2 + overhang, z0 = cz - sz / 2 - overhang, z1 = cz + sz / 2 + overhang;
    const top = [cx, y0 + h, cz];
    const k = uvScale;
    const sl = Math.hypot(sx / 2 + overhang, h) * k;
    this.tri([x0, y0, z1], [x1, y0, z1], top, [[0, 0], [(x1 - x0) * k, 0], [(x1 - x0) * k / 2, sl]]);
    this.tri([x1, y0, z1], [x1, y0, z0], top, [[0, 0], [(z1 - z0) * k, 0], [(z1 - z0) * k / 2, sl]]);
    this.tri([x1, y0, z0], [x0, y0, z0], top, [[0, 0], [(x1 - x0) * k, 0], [(x1 - x0) * k / 2, sl]]);
    this.tri([x0, y0, z0], [x0, y0, z1], top, [[0, 0], [(z1 - z0) * k, 0], [(z1 - z0) * k / 2, sl]]);
    return this;
  }

  get vertexCount() { return this.pos.length / 3; }

  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    for (const [k, arr] of Object.entries(this.custom)) g.setAttribute(k, new Float32BufferAttribute(arr, this.customSize[k]));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export { Quaternion };
