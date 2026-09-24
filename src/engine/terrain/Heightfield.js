import { Vector3 } from 'three';

/**
 * Regular-grid height map with bilinear sampling, normals, ray casting and
 * editing helpers (flattening building sites).
 */
export class Heightfield {
  /**
   * @param {{size:number, cellSize?:number, originX?:number, originZ?:number, heights?:Float32Array}} o
   *   size = number of cells per side (vertices = size + 1)
   */
  constructor({ size, cellSize = 1, originX = 0, originZ = 0, heights = null }) {
    this.size = size;
    this.n = size + 1;
    this.cellSize = cellSize;
    this.originX = originX;
    this.originZ = originZ;
    this.heights = heights || new Float32Array(this.n * this.n);
  }

  get width() { return this.size * this.cellSize; }
  get minX() { return this.originX; }
  get minZ() { return this.originZ; }
  get maxX() { return this.originX + this.width; }
  get maxZ() { return this.originZ + this.width; }

  inside(x, z) { return x >= this.minX && z >= this.minZ && x <= this.maxX && z <= this.maxZ; }

  vertexHeight(i, j) {
    const n = this.n;
    i = i < 0 ? 0 : i >= n ? n - 1 : i;
    j = j < 0 ? 0 : j >= n ? n - 1 : j;
    return this.heights[j * n + i];
  }

  heightAt(x, z) {
    const fx = (x - this.originX) / this.cellSize, fz = (z - this.originZ) / this.cellSize;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h00 = this.vertexHeight(i, j), h10 = this.vertexHeight(i + 1, j);
    const h01 = this.vertexHeight(i, j + 1), h11 = this.vertexHeight(i + 1, j + 1);
    return (h00 + (h10 - h00) * tx) * (1 - tz) + (h01 + (h11 - h01) * tx) * tz;
  }

  normalAt(x, z, out = new Vector3()) {
    const e = this.cellSize;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** 0 = flat, 1 = vertical. */
  slopeAt(x, z) {
    const e = this.cellSize;
    const hx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const hz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(hx, hz);
  }

  /** Ray/terrain intersection (marching + bisection). Returns a Vector3 or null. */
  raycast(origin, dir, maxDist = 3000, out = new Vector3()) {
    let t = 0;
    // start at the entry into the bounding box
    const minY = -500, maxY = 2000;
    const inv = (d) => (Math.abs(d) < 1e-9 ? 1e9 : 1 / d);
    const tx1 = (this.minX - origin.x) * inv(dir.x), tx2 = (this.maxX - origin.x) * inv(dir.x);
    const tz1 = (this.minZ - origin.z) * inv(dir.z), tz2 = (this.maxZ - origin.z) * inv(dir.z);
    const ty1 = (minY - origin.y) * inv(dir.y), ty2 = (maxY - origin.y) * inv(dir.y);
    const tmin = Math.max(Math.min(tx1, tx2), Math.min(tz1, tz2), Math.min(ty1, ty2));
    const tmax = Math.min(Math.max(tx1, tx2), Math.max(tz1, tz2), Math.max(ty1, ty2));
    if (tmax < 0 || tmin > tmax) return null;
    t = Math.max(0, tmin);
    const end = Math.min(tmax, maxDist);
    const step = this.cellSize * 0.5;
    let prevT = t;
    let prevAbove = origin.y + dir.y * t - this.heightAt(origin.x + dir.x * t, origin.z + dir.z * t);
    if (prevAbove < 0) return out.set(origin.x + dir.x * t, this.heightAt(origin.x + dir.x * t, origin.z + dir.z * t), origin.z + dir.z * t);
    while (t < end) {
      t += step;
      const x = origin.x + dir.x * t, z = origin.z + dir.z * t;
      const above = origin.y + dir.y * t - this.heightAt(x, z);
      if (above <= 0) {
        let a = prevT, b = t;
        for (let k = 0; k < 12; k++) {
          const m = (a + b) * 0.5;
          const mx = origin.x + dir.x * m, mz = origin.z + dir.z * m;
          if (origin.y + dir.y * m - this.heightAt(mx, mz) > 0) a = m; else b = m;
        }
        const hx = origin.x + dir.x * b, hz = origin.z + dir.z * b;
        return out.set(hx, this.heightAt(hx, hz), hz);
      }
      prevT = t;
      prevAbove = above;
    }
    return null;
  }

  /**
   * Flattens a rectangular footprint (centered, axis aligned) to its mean
   * height with a smooth falloff border. Returns the modified world rect.
   */
  flatten(cx, cz, halfX, halfZ, border = 3, targetHeight = null) {
    const cs = this.cellSize;
    let sum = 0, cnt = 0;
    for (let z = cz - halfZ; z <= cz + halfZ; z += cs) {
      for (let x = cx - halfX; x <= cx + halfX; x += cs) { sum += this.heightAt(x, z); cnt++; }
    }
    const h = targetHeight ?? sum / Math.max(1, cnt);
    const i0 = Math.max(0, Math.floor((cx - halfX - border - this.originX) / cs));
    const i1 = Math.min(this.n - 1, Math.ceil((cx + halfX + border - this.originX) / cs));
    const j0 = Math.max(0, Math.floor((cz - halfZ - border - this.originZ) / cs));
    const j1 = Math.min(this.n - 1, Math.ceil((cz + halfZ + border - this.originZ) / cs));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = this.originX + i * cs, z = this.originZ + j * cs;
        const dx = Math.max(0, Math.abs(x - cx) - halfX), dz = Math.max(0, Math.abs(z - cz) - halfZ);
        const d = Math.hypot(dx, dz);
        const w = d <= 0 ? 1 : Math.max(0, 1 - d / border);
        const s = w * w * (3 - 2 * w);
        const k = j * this.n + i;
        this.heights[k] += (h - this.heights[k]) * s;
      }
    }
    return { minX: cx - halfX - border, minZ: cz - halfZ - border, maxX: cx + halfX + border, maxZ: cz + halfZ + border, height: h };
  }
}
