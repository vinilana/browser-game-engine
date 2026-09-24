import { Vector3 } from 'three';
import { VoxelBody } from '../engine/voxel/VoxelPhysics.js';

const WALK = 4.317, SPRINT = 5.612, SNEAK = 1.31, FLY = 10.9, FLY_SPRINT = 21.6;
const GRAVITY = 28, JUMP = 8.6;

/** First-person controller (walk / sprint / sneak / swim / fly). */
export class Player {
  constructor(engine, world, blocks) {
    this.engine = engine;
    this.world = world;
    this.blocks = blocks;
    this.body = new VoxelBody(world, { width: 0.6, height: 1.8, stepHeight: 0.55 });
    this.yaw = 0;
    this.pitch = 0;
    this.flying = false;
    this.sprinting = false;
    this.sneaking = false;
    this.eye = 1.62;
    this.bob = 0;
    this.bobAmount = 0;
    this.stepDist = 0;
    this.fovOffset = 0;
    this.headInWater = false;
    this.wasInWater = false;
    this.frozen = true;
    this.onStep = null;      // (material) => void
    this.onSplash = null;
    this.onLand = null;
    this.eyePos = new Vector3();
    this._wish = new Vector3();
  }

  get position() { return this.body.position; }

  spawnAt(x, y, z) {
    this.body.position.set(x, y, z);
    this.body.velocity.set(0, 0, 0);
    this.body.onGround = false;
  }

  groundMaterial() {
    const p = this.body.position;
    const id = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
    return this.blocks.get(id)?.sound || 'stone';
  }

  update(dt) {
    const input = this.engine.input;
    const body = this.body;
    const v = body.velocity;
    const p = body.position;

    // --- look -------------------------------------------------------------
    if (input.locked) {
      this.yaw -= input.mouseDX * input.sensitivity;
      this.pitch -= input.mouseDY * input.sensitivity;
      this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));
    }

    // --- modes --------------------------------------------------------------
    if (input.wasDoubleTapped('Space') || input.wasPressed('KeyF')) {
      this.flying = !this.flying;
      if (this.flying) v.y = 0;
    }
    const fwd = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const str = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    if ((input.isDown('ControlLeft') || input.wasDoubleTapped('KeyW')) && fwd > 0) this.sprinting = true;
    if (fwd <= 0 || this.sneaking) this.sprinting = false;
    this.sneaking = !this.flying && input.isDown('ShiftLeft');

    // don't simulate until the terrain under the player exists
    const ready = this.world.isColumnReady(p.x, p.z);
    if (!ready) {
      this.frozen = true;
      this._updateCamera(dt);
      return;
    }
    this.frozen = false;

    const inLiquid = body.liquid > 0.1;
    let speed;
    if (this.flying) speed = this.sprinting ? FLY_SPRINT : FLY;
    else if (inLiquid) speed = this.sprinting ? 3.2 : 2.2;
    else speed = this.sneaking ? SNEAK : this.sprinting ? SPRINT : WALK;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const w = this._wish.set(-sy * fwd + cy * str, 0, -cy * fwd - sy * str);
    if (w.lengthSq() > 1) w.normalize();
    w.multiplyScalar(speed);

    const accel = this.flying ? 7 : body.onGround ? 14 : inLiquid ? 6 : 2.6;
    const k = 1 - Math.exp(-accel * dt);
    v.x += (w.x - v.x) * k;
    v.z += (w.z - v.z) * k;

    if (this.flying) {
      const up = (input.isDown('Space') ? 1 : 0) - (input.isDown('ShiftLeft') ? 1 : 0);
      v.y += (up * speed * 0.75 - v.y) * (1 - Math.exp(-8 * dt));
      if (body.onGround && up <= 0 && !input.isDown('Space')) {
        // landing ends flight
        this.flying = false;
      }
    } else if (inLiquid) {
      v.y -= GRAVITY * 0.18 * dt;
      v.y *= Math.exp(-2.5 * dt);
      if (input.isDown('Space')) v.y += (3.2 - v.y) * (1 - Math.exp(-6 * dt));
      if (input.isDown('ShiftLeft')) v.y -= 6 * dt;
      // jump out of water onto a ledge
      if (input.isDown('Space') && (body.collidedX || body.collidedZ) && body.liquid < 0.8) v.y = 6;
    } else {
      v.y -= GRAVITY * dt;
      v.y = Math.max(v.y, -60);
      if (input.isDown('Space') && body.onGround) {
        v.y = JUMP;
        if (this.sprinting) { v.x -= sy * 1.8; v.z -= cy * 1.8; }
      }
    }

    const wasGround = body.onGround;
    const fallSpeed = v.y;
    body.move(dt, { sneak: this.sneaking });
    if (!wasGround && body.onGround && fallSpeed < -9) this.onLand?.(-fallSpeed, this.groundMaterial());

    // splash when entering water
    const nowIn = body.liquid > 0.1;
    if (nowIn && !this.wasInWater && Math.abs(fallSpeed) > 3) this.onSplash?.(Math.min(1.5, Math.abs(fallSpeed) / 10));
    this.wasInWater = nowIn;

    // footsteps
    const hs = Math.hypot(v.x, v.z);
    if (body.onGround && !this.flying && hs > 0.5) {
      this.stepDist += hs * dt;
      const stride = this.sprinting ? 2.1 : this.sneaking ? 1.1 : 1.7;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.onStep?.(this.groundMaterial(), this.sneaking ? 0.4 : this.sprinting ? 1.1 : 0.8);
      }
    }
    this._updateCamera(dt);
  }

  _updateCamera(dt) {
    const cam = this.engine.camera;
    const body = this.body;
    const v = body.velocity;
    const hs = Math.hypot(v.x, v.z);
    const targetEye = this.sneaking ? 1.5 : 1.62;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12);
    const moving = body.onGround && !this.flying && hs > 0.8;
    this.bobAmount += ((moving ? Math.min(1, hs / SPRINT) : 0) - this.bobAmount) * Math.min(1, dt * 8);
    this.bob += dt * hs * 1.9;
    const bobY = Math.abs(Math.sin(this.bob)) * 0.055 * this.bobAmount;
    const bobX = Math.cos(this.bob) * 0.03 * this.bobAmount;
    const p = body.position;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.eyePos.set(p.x + cy * bobX, p.y + this.eye + bobY, p.z - sy * bobX);
    cam.position.copy(this.eyePos);
    cam.rotation.set(this.pitch, this.yaw, Math.cos(this.bob) * 0.004 * this.bobAmount, 'YXZ');
    const targetFov = (this.sprinting ? 9 : 0) + (this.flying && this.sprinting ? 6 : 0);
    this.fovOffset += (targetFov - this.fovOffset) * Math.min(1, dt * 6);
    const baseFov = this.engine.settings.get('fov');
    cam.fov = baseFov + this.fovOffset;
    this.headInWater = this.world.registry.liquid[this.world.getBlock(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z))] === 1;
  }
}
