// Instanced forests (with felling) and ground cover for "Reinos".
import { InstancedMesh, Matrix4, Quaternion, Vector3, Euler, Color, DynamicDrawUsage } from 'three';
import { buildOak, buildPine, buildStump, buildTuft } from './models/trees.js';
import { MAP_SIZE, RESOURCES } from './config.js';
import { mulberry32 } from '../engine/math/rng.js';
import { smoothstep } from '../engine/math/noise.js';

const REGION = 48;
const _m = new Matrix4(), _q = new Quaternion(), _s = new Vector3(), _p = new Vector3(), _e = new Euler();

export class TreeSystem {
  constructor(game, list) {
    this.game = game;
    const { pipeline } = game.engine;
    const M = game.materials;
    this.variants = {
      oak: [0, 1, 2].map((i) => buildOak(i + 11)),
      pine: [0, 1, 2].map((i) => buildPine(i + 5)),
    };
    this.stumpGeo = buildStump();
    this.trees = [];
    this.falling = [];
    this.shaking = [];
    // bucket trees per (region, species, variant)
    const buckets = new Map();
    list.forEach((t) => {
      const key = `${Math.floor(t.x / REGION)},${Math.floor(t.z / REGION)},${t.species},${t.variant}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    });
    this.meshes = [];
    const tint = new Color();
    const rnd = mulberry32(99);
    for (const [key, arr] of buckets) {
      const [, , species, variant] = key.split(',');
      const v = this.variants[species][+variant];
      const barkMesh = new InstancedMesh(v.bark, species === 'pine' ? M.barkPine : M.bark, arr.length);
      const leafMesh = new InstancedMesh(v.leaves, species === 'pine' ? M.leavesPine : M.leavesOak, arr.length);
      const stumpMesh = new InstancedMesh(this.stumpGeo, species === 'pine' ? M.barkPine : M.bark, arr.length);
      barkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
      leafMesh.instanceMatrix.setUsage(DynamicDrawUsage);
      stumpMesh.count = 0;
      arr.forEach((t, i) => {
        t.y = game.world.heightAt(t.x, t.z);
        t.amount = RESOURCES.tree.amount;
        t.state = 'standing';
        t.bark = barkMesh; t.leaves = leafMesh; t.index = i; t.stumps = stumpMesh;
        t.type = 'tree';
        t.radius = 0.6;
        t.height = v.height * t.scale;
        this._setMatrix(t, 0, 0);
        const hueShift = species === 'pine' ? 0.06 : 0.14;
        tint.setRGB(1 + (rnd() - 0.5) * hueShift * 2, 1 + (rnd() - 0.5) * hueShift, 1 - rnd() * hueShift);
        leafMesh.setColorAt(i, tint);
        this.trees.push(t);
      });
      for (const m of [barkMesh, leafMesh]) {
        m.computeBoundingSphere();
        pipeline.scene.add(m);
        pipeline.addShadowCaster(m);
        this.meshes.push(m);
      }
      stumpMesh.frustumCulled = false;
      pipeline.scene.add(stumpMesh);
      pipeline.addShadowCaster(stumpMesh);
    }
  }

  _setMatrix(t, fallAngle, fallDir) {
    _p.set(t.x, t.y, t.z);
    if (fallAngle !== 0) {
      // rotate around the base toward fallDir
      const axis = new Vector3(Math.cos(fallDir + Math.PI / 2), 0, Math.sin(fallDir + Math.PI / 2));
      _q.setFromAxisAngle(axis, fallAngle).multiply(new Quaternion().setFromEuler(_e.set(0, t.rot, 0)));
    } else {
      _q.setFromEuler(_e.set(0, t.rot, 0));
    }
    const s = t.state === 'gone' ? 0 : t.scale;
    _s.set(s, s, s);
    _m.compose(_p, _q, _s);
    t.bark.setMatrixAt(t.index, _m);
    t.leaves.setMatrixAt(t.index, _m);
    t.bark.instanceMatrix.needsUpdate = true;
    t.leaves.instanceMatrix.needsUpdate = true;
  }

  /** An axe blow on a standing tree: the whole tree shivers away from the woodcutter. */
  shake(t, fromX, fromZ) {
    if (t.state !== 'standing') return;
    t.shakeDir = Math.atan2(t.z - fromZ, t.x - fromX);
    if (!(t.shakeT > 0)) this.shaking.push(t);
    t.shakeT = 0.6;
  }

  /** After enough chopping the tree falls away from the woodcutter; wood is then taken from the log. */
  fell(t, fromX, fromZ) {
    if (t.state !== 'standing') return;
    t.state = 'falling';
    t.shakeT = 0;
    t.fallDir = Math.atan2(t.z - fromZ, t.x - fromX) + (Math.random() - 0.5) * 0.5;
    t.fallT = 0;
    this.falling.push(t);
    this.game.audio?.treeFall(t.x, t.z);
    this.game.world.path.markCircle(t.x, t.z, t.radius, -1);
    this.game.onTreeFelled?.(t);
  }

  take(t, amount) {
    const got = Math.min(amount, t.amount);
    t.amount -= got;
    if (t.amount <= 0 && t.state !== 'gone') {
      t.state = 'gone';
      this._setMatrix(t, 0, 0);
      // leave a stump
      const sm = t.stumps;
      _q.setFromEuler(_e.set(0, t.rot, 0));
      _m.compose(_p.set(t.x, t.y, t.z), _q, _s.setScalar(t.scale));
      sm.setMatrixAt(sm.count++, _m);
      sm.instanceMatrix.needsUpdate = true;
      this.game.onResourceDepleted?.(t);
    }
    return got;
  }

  update(dt) {
    for (let i = this.shaking.length - 1; i >= 0; i--) {
      const t = this.shaking[i];
      t.shakeT -= dt;
      if (t.shakeT <= 0 || t.state !== 'standing') {
        this.shaking.splice(i, 1);
        if (t.state === 'standing') this._setMatrix(t, 0, 0);
        continue;
      }
      // damped sway around the base, strongest right after the blow
      const k = t.shakeT / 0.6;
      this._setMatrix(t, Math.sin((0.6 - t.shakeT) * 26) * 0.045 * k * k, t.shakeDir);
    }
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const t = this.falling[i];
      t.fallT += dt;
      const k = Math.min(1, t.fallT / 1.8);
      const ang = (Math.PI / 2 - 0.08) * k * k * k;
      if (t.state !== 'gone') this._setMatrix(t, ang, t.fallDir);
      if (k >= 1) {
        if (t.state === 'falling') t.state = 'fallen';
        this.falling.splice(i, 1);
        this.game.particles?.dust(t.x + Math.cos(t.fallDir) * 5, t.y, t.z + Math.sin(t.fallDir) * 5, 7, 3, 0.18);
      }
    }
  }

  /**
   * Where a villager stands to work and the point it faces: beside the trunk on its own side while the
   * tree stands, then one of several slots along both sides of the fallen log (k picks another slot).
   */
  workPoint(t, unit = null, k = 0) {
    if (t.state === 'standing') {
      const a = unit ? Math.atan2(unit.z - t.z, unit.x - t.x) + k * 1.3 : k * 1.3;
      return { x: t.x + Math.cos(a) * 1.0, z: t.z + Math.sin(a) * 1.0, fx: t.x, fz: t.z };
    }
    return this.logPoint(t, ((unit ? unit.id : 0) + k) % 6);
  }

  /** Work slot `slot` (0..5) along the fallen log: three positions on each side. */
  logPoint(t, slot) {
    const along = (1.3 + Math.floor(slot / 2) * 1.5) * Math.max(0.8, t.scale);
    const side = slot % 2 ? 1 : -1;
    const ax = Math.cos(t.fallDir), az = Math.sin(t.fallDir);
    const cx = t.x + ax * along, cz = t.z + az * along;
    return { x: cx - az * side * 0.85, z: cz + ax * side * 0.85, fx: cx, fz: cz };
  }

  /** Point on the fallen log (for picking / highlighting). */
  logSegment(t) {
    const len = (t.height || 8) * 0.8;
    return [t.x, t.z, t.x + Math.cos(t.fallDir) * len, t.z + Math.sin(t.fallDir) * len];
  }
}

/** Instanced grass tufts and small plants scattered over grassy terrain. */
export class GroundCover {
  constructor(game, splat, n) {
    const { pipeline } = game.engine;
    const geo = buildTuft(0.8, 0.55);
    const rnd = mulberry32(1234);
    const REG = 32;
    const regions = new Map();
    const hf = game.world.hf;
    const count = Math.round(MAP_SIZE * MAP_SIZE * 0.55);
    for (let k = 0; k < count; k++) {
      const x = rnd() * MAP_SIZE, z = rnd() * MAP_SIZE;
      const i = Math.round(x), j = Math.round(z);
      const w = splat[(j * n + i) * 8] / 255 + splat[(j * n + i) * 8 + 1] / 255 * 0.7;
      if (rnd() > smoothstep(0.35, 0.8, w)) continue;
      if (hf.heightAt(x, z) < 0.6) continue;
      if (hf.slopeAt(x, z) > 0.6) continue;
      const key = `${Math.floor(x / REG)},${Math.floor(z / REG)}`;
      if (!regions.has(key)) regions.set(key, []);
      regions.get(key).push([x, z, 0.6 + rnd() * 0.8, rnd() * Math.PI, rnd()]);
    }
    this.meshes = [];
    this.items = [];
    const col = new Color();
    for (const arr of regions.values()) {
      const mesh = new InstancedMesh(geo, game.materials.tuft, arr.length);
      arr.forEach((it, idx) => {
        const [x, z, s, r, c] = it;
        _q.setFromEuler(_e.set(0, r, 0));
        _m.compose(_p.set(x, hf.heightAt(x, z) - 0.02, z), _q, _s.set(s, s * (0.8 + c * 0.5), s));
        mesh.setMatrixAt(idx, _m);
        col.setRGB(0.85 + c * 0.3, 0.9 + c * 0.15, 0.8 + c * 0.1);
        mesh.setColorAt(idx, col);
        this.items.push({ mesh, idx, x, z });
      });
      mesh.computeBoundingSphere();
      pipeline.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /** Removes tufts inside a rectangle (building sites, farms). */
  clearRect(cx, cz, half) {
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (const it of this.items) {
      if (Math.abs(it.x - cx) < half && Math.abs(it.z - cz) < half) {
        it.mesh.setMatrixAt(it.idx, zero);
        it.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
