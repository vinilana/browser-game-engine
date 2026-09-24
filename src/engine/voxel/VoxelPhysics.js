import { Vector3 } from 'three';

const EPS = 1e-4;

/**
 * Axis-aligned box body colliding with solid voxels.
 * `position` is the center of the bottom face (feet).
 */
export class VoxelBody {
  constructor(world, { width = 0.6, height = 1.8, stepHeight = 0.6 } = {}) {
    this.world = world;
    this.width = width;
    this.height = height;
    this.stepHeight = stepHeight;
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.onGround = false;
    this.collidedX = false;
    this.collidedZ = false;
    this.liquid = 0;          // fraction of the body in liquid (0..1)
    this.eyeInLiquid = false;
    this.lastFallSpeed = 0;
  }

  _solid(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    return this.world.registry.solid[id] === 1;
  }

  _overlaps(minX, minY, minZ, maxX, maxY, maxZ) {
    const x0 = Math.floor(minX), x1 = Math.floor(maxX - EPS);
    const y0 = Math.floor(minY), y1 = Math.floor(maxY - EPS);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (this._solid(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  collidesAt(px, py, pz) {
    const hw = this.width / 2;
    return this._overlaps(px - hw, py, pz - hw, px + hw, py + this.height, pz + hw);
  }

  _moveAxis(axis, delta) {
    if (delta === 0) return false;
    const p = this.position;
    const hw = this.width / 2;
    const steps = Math.ceil(Math.abs(delta) / 0.45);
    const d = delta / steps;
    for (let s = 0; s < steps; s++) {
      const nx = axis === 0 ? p.x + d : p.x;
      const ny = axis === 1 ? p.y + d : p.y;
      const nz = axis === 2 ? p.z + d : p.z;
      if (!this.collidesAt(nx, ny, nz)) {
        p.set(nx, ny, nz);
        continue;
      }
      // snap against the blocking face
      const ox = p.x, oy = p.y, oz = p.z;
      if (axis === 0) p.x = d > 0 ? Math.floor(p.x + hw + d) - hw - EPS : Math.floor(p.x - hw + d) + 1 + hw + EPS;
      else if (axis === 1) p.y = d > 0 ? Math.floor(p.y + this.height + d) - this.height - EPS : Math.floor(p.y + d) + 1 + EPS;
      else p.z = d > 0 ? Math.floor(p.z + hw + d) - hw - EPS : Math.floor(p.z - hw + d) + 1 + hw + EPS;
      // snapping must not move us backwards or into geometry
      const moved = axis === 0 ? (p.x - ox) * d : axis === 1 ? (p.y - oy) * d : (p.z - oz) * d;
      if (moved < 0 || this.collidesAt(p.x, p.y, p.z)) p.set(ox, oy, oz);
      return true;
    }
    return false;
  }

  /**
   * Integrates velocity with collisions.
   * @param {number} dt
   * @param {{sneak?: boolean}} opts sneaking prevents walking off edges
   */
  move(dt, opts = {}) {
    const v = this.velocity;
    const p = this.position;
    const wasOnGround = this.onGround;
    this.lastFallSpeed = v.y;

    // vertical
    const hitY = this._moveAxis(1, v.y * dt);
    if (hitY) {
      this.onGround = v.y < 0;
      v.y = 0;
    } else {
      this.onGround = false;
    }
    if (!this.onGround && v.y <= 0 && this.collidesAt(p.x, p.y - 0.02, p.z)) this.onGround = true;

    // horizontal with optional step-up and sneak edge guard
    const tryHorizontal = (axis, delta) => {
      if (delta === 0) return false;
      const before = axis === 0 ? p.x : p.z;
      const hit = this._moveAxis(axis, delta);
      if (opts.sneak && this.onGround) {
        // don't walk off ledges while sneaking
        if (!this.collidesAt(p.x, p.y - 0.6, p.z)) {
          if (axis === 0) p.x = before; else p.z = before;
          return true;
        }
      }
      if (hit && (this.onGround || wasOnGround) && this.stepHeight > 0) {
        const oy = p.y;
        const ox = p.x, oz = p.z;
        if (axis === 0) p.x = before; else p.z = before;
        if (!this.collidesAt(p.x, oy + this.stepHeight, p.z)) {
          p.y = oy + this.stepHeight;
          const hit2 = this._moveAxis(axis, delta);
          if (!hit2) {
            this._moveAxis(1, -this.stepHeight - 0.01);
            return false;
          }
        }
        p.set(ox, oy, oz);
      }
      return hit;
    };
    this.collidedX = tryHorizontal(0, v.x * dt);
    if (this.collidedX) v.x = 0;
    this.collidedZ = tryHorizontal(2, v.z * dt);
    if (this.collidedZ) v.z = 0;

    // liquid sampling
    const liq = this.world.registry.liquid;
    let inLiquid = 0;
    const samples = 4;
    for (let i = 0; i < samples; i++) {
      const y = p.y + (i + 0.5) * (this.height / samples);
      if (liq[this.world.getBlock(Math.floor(p.x), Math.floor(y), Math.floor(p.z))]) inLiquid++;
    }
    this.liquid = inLiquid / samples;
  }
}
