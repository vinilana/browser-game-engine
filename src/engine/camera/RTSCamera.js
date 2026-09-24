import { Vector3 } from 'three';

/**
 * Strategy-game camera: orbits a ground target with smooth pan / zoom /
 * rotation, edge scrolling and terrain following.
 */
export class RTSCamera {
  /**
   * @param {import('three').PerspectiveCamera} camera
   * @param {{heightAt:(x:number,z:number)=>number, bounds?:{minX,minZ,maxX,maxZ}}} o
   */
  constructor(camera, { heightAt, bounds = null, wasd = true, viewBias = 0 } = {}) {
    this.wasd = wasd;   // strategy games often reserve letters for hotkeys
    this.viewBias = viewBias; // lookAt() shifts the target toward the camera (fraction of distance), e.g. to clear a bottom HUD
    this.camera = camera;
    this.heightAt = heightAt || (() => 0);
    this.bounds = bounds;
    this.target = new Vector3();
    this.goal = new Vector3();
    this.distance = 70;
    this.goalDistance = 70;
    this.minDistance = 16;
    this.maxDistance = 190;
    this.yaw = 0;
    this.goalYaw = 0;
    this.panSpeed = 1.1;
    this.edgeScroll = true;
    this.edgeSize = 14;
    this._tmp = new Vector3();
  }

  /** Pitch grows as the camera zooms out (low, cinematic angle up close). */
  pitchFor(d) {
    const t = (d - this.minDistance) / (this.maxDistance - this.minDistance);
    return 0.62 + Math.min(1, Math.max(0, t)) * 0.42;
  }

  jumpTo(x, z) {
    this.goal.set(x, 0, z);
    this.target.set(x, this.heightAt(x, z), z);
  }

  lookAt(x, z) {
    const k = this.goalDistance * this.viewBias;
    this.goal.set(x + Math.sin(this.goalYaw) * k, 0, z + Math.cos(this.goalYaw) * k);
  }

  /**
   * @param {number} dt
   * @param {import('../core/Input.js').Input} input
   * @param {{x:number,y:number,w:number,h:number}} viewport screen rect for edge scrolling
   */
  update(dt, input, viewport) {
    const speed = this.distance * this.panSpeed;
    let fx = 0, fz = 0;
    const W = this.wasd;
    if ((W && input.isDown('KeyW')) || input.isDown('ArrowUp')) fz += 1;
    if ((W && input.isDown('KeyS')) || input.isDown('ArrowDown')) fz -= 1;
    if ((W && input.isDown('KeyD')) || input.isDown('ArrowRight')) fx += 1;
    if ((W && input.isDown('KeyA')) || input.isDown('ArrowLeft')) fx -= 1;
    if (this.edgeScroll && viewport && input.mouseInside) {
      const m = this.edgeSize;
      if (input.mouseX <= viewport.x + m) fx -= 1;
      if (input.mouseX >= viewport.x + viewport.w - m) fx += 1;
      if (input.mouseY <= viewport.y + m) fz += 1;
      if (input.mouseY >= viewport.y + viewport.h - m) fz -= 1;
    }
    if (fx || fz) {
      const l = Math.hypot(fx, fz);
      fx /= l; fz /= l;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      // forward = direction the camera looks at (projected), right = perpendicular
      this.goal.x += (-sy * fz + cy * fx) * speed * dt;
      this.goal.z += (-cy * fz - sy * fx) * speed * dt;
    }
    if (input.wheel) {
      this.goalDistance *= Math.pow(1.14, input.wheel);
      this.goalDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.goalDistance));
    }
    if ((W && input.isDown('KeyQ')) || input.isDown('PageUp')) this.goalYaw += dt * 1.4;
    if ((W && input.isDown('KeyE')) || input.isDown('PageDown')) this.goalYaw -= dt * 1.4;
    if (input.isButtonDown(1)) this.goalYaw -= input.mouseMoveX * 0.006;
    if (this.bounds) {
      const b = this.bounds;
      this.goal.x = Math.max(b.minX, Math.min(b.maxX, this.goal.x));
      this.goal.z = Math.max(b.minZ, Math.min(b.maxZ, this.goal.z));
    }
    const k = 1 - Math.exp(-dt * 10);
    this.target.x += (this.goal.x - this.target.x) * k;
    this.target.z += (this.goal.z - this.target.z) * k;
    const gy = this.heightAt(this.target.x, this.target.z);
    this.target.y += (gy - this.target.y) * (1 - Math.exp(-dt * 4));
    this.distance += (this.goalDistance - this.distance) * (1 - Math.exp(-dt * 8));
    this.yaw += (this.goalYaw - this.yaw) * (1 - Math.exp(-dt * 8));
    this._apply();
  }

  _apply() {
    const pitch = this.pitchFor(this.distance);
    const cam = this.camera;
    const h = Math.sin(pitch) * this.distance, r = Math.cos(pitch) * this.distance;
    cam.position.set(this.target.x + Math.sin(this.yaw) * r, this.target.y + h, this.target.z + Math.cos(this.yaw) * r);
    // never clip into hills between the camera and the target
    const ground = this.heightAt(cam.position.x, cam.position.z);
    if (cam.position.y < ground + 6) cam.position.y = ground + 6;
    cam.rotation.set(-pitch, this.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
  }
}
