// Passive animals (pig, cow, sheep, chicken) with simple wandering AI,
// voxel physics, shadows and deferred lighting from the voxel light field.
import { Group, Mesh, BoxGeometry, CanvasTexture, SRGBColorSpace, NearestFilter, LinearFilter, Color } from 'three';
import { GBufferMaterial } from '../engine/render/materials/GBufferMaterial.js';
import { VoxelBody } from '../engine/voxel/VoxelPhysics.js';
import { B } from './blocks.js';

function hideTexture(base, spots, spotColor, noise = 0.12, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const sp = [];
  for (let i = 0; i < spots; i++) sp.push([Math.random() * size, Math.random() * size, 6 + Math.random() * 12]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let col = base;
      for (const [sx, sy, r] of sp) {
        const d = Math.hypot(x - sx, y - sy) + Math.sin(x * 0.7 + y * 0.3) * 2;
        if (d < r) { col = spotColor; break; }
      }
      const n = 1 + (Math.random() - 0.5) * noise + Math.sin(y * 0.9) * 0.02;
      const o = (y * size + x) * 4;
      img.data[o] = Math.min(255, col[0] * n);
      img.data[o + 1] = Math.min(255, col[1] * n);
      img.data[o + 2] = Math.min(255, col[2] * n);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.magFilter = NearestFilter;
  return t;
}

function faceTexture(base, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${base.join(',')})`;
  ctx.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * 32, Math.random() * 32, 1, 1);
  }
  draw(ctx);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = NearestFilter;
  return t;
}

const SPECIES = {
  pig: {
    size: [0.9, 0.9], speed: 1.1,
    make() {
      const skin = [236, 164, 160];
      const hide = hideTexture(skin, 3, [220, 140, 138], 0.1);
      const face = faceTexture(skin, (c) => {
        c.fillStyle = '#1b1b1b'; c.fillRect(6, 10, 4, 4); c.fillRect(22, 10, 4, 4);
        c.fillStyle = '#f7c9c4'; c.fillRect(10, 18, 12, 8);
        c.fillStyle = '#8a4a48'; c.fillRect(12, 20, 3, 3); c.fillRect(17, 20, 3, 3);
      });
      return { body: [0.62, 0.55, 1.0], bodyY: 0.62, head: [0.5, 0.5, 0.5], headPos: [0, 0.8, 0.7], legs: 4, leg: [0.2, 0.36, 0.2], legSpread: [0.2, 0.34], hide, face, rough: 0.6 };
    },
  },
  cow: {
    size: [0.9, 1.4], speed: 1.0,
    make() {
      const hide = hideTexture([70, 50, 36], 8, [235, 232, 225], 0.12);
      const face = faceTexture([70, 50, 36], (c) => {
        c.fillStyle = '#eee'; c.fillRect(8, 4, 16, 10);
        c.fillStyle = '#111'; c.fillRect(5, 11, 4, 4); c.fillRect(23, 11, 4, 4);
        c.fillStyle = '#c9a28c'; c.fillRect(8, 20, 16, 10);
        c.fillStyle = '#3a2a22'; c.fillRect(11, 24, 3, 3); c.fillRect(18, 24, 3, 3);
      });
      return { body: [0.75, 0.75, 1.3], bodyY: 1.05, head: [0.55, 0.55, 0.45], headPos: [0, 1.25, 0.82], legs: 4, leg: [0.24, 0.68, 0.24], legSpread: [0.24, 0.45], hide, face, rough: 0.8, horns: true };
    },
  },
  sheep: {
    size: [0.9, 1.3], speed: 1.0,
    make() {
      const hide = hideTexture([232, 229, 220], 20, [215, 211, 200], 0.25);
      const face = faceTexture([190, 170, 150], (c) => {
        c.fillStyle = '#111'; c.fillRect(6, 11, 4, 3); c.fillRect(22, 11, 4, 3);
        c.fillStyle = '#e8b8b0'; c.fillRect(12, 20, 8, 5);
      });
      return { body: [0.85, 0.8, 1.2], bodyY: 0.95, head: [0.42, 0.45, 0.5], headPos: [0, 1.15, 0.75], legs: 4, leg: [0.2, 0.6, 0.2], legSpread: [0.22, 0.4], hide, face, rough: 1.0 };
    },
  },
  chicken: {
    size: [0.4, 0.7], speed: 1.3,
    make() {
      const hide = hideTexture([240, 238, 232], 0, [0, 0, 0], 0.08);
      const face = faceTexture([240, 238, 232], (c) => {
        c.fillStyle = '#111'; c.fillRect(4, 8, 4, 4); c.fillRect(24, 8, 4, 4);
        c.fillStyle = '#f2a33a'; c.fillRect(10, 14, 12, 6);
        c.fillStyle = '#d0342c'; c.fillRect(12, 20, 8, 6);
      });
      return { body: [0.36, 0.36, 0.5], bodyY: 0.45, head: [0.25, 0.4, 0.2], headPos: [0, 0.8, 0.28], legs: 2, leg: [0.06, 0.3, 0.06], legSpread: [0.1, 0.0], hide, face, rough: 0.9, legColor: new Color(0.9, 0.55, 0.15) };
    },
  },
};

class Mob {
  constructor(game, kind, x, y, z) {
    this.game = game;
    this.kind = kind;
    const sp = SPECIES[kind];
    const d = sp.make();
    this.speed = sp.speed;
    this.body = new VoxelBody(game.world, { width: sp.size[0], height: sp.size[1], stepHeight: 0.55 });
    this.body.position.set(x, y, z);
    this.group = new Group();
    this.materials = [];
    const mat = (opts) => { const m = new GBufferMaterial(opts); this.materials.push(m); return m; };
    const hideMat = mat({ map: d.hide, roughness: d.rough });
    const faceMat = mat({ map: d.face, roughness: d.rough });
    const legMat = d.legColor ? mat({ color: d.legColor, roughness: 0.7 }) : hideMat;

    const bodyMesh = new Mesh(new BoxGeometry(...d.body), hideMat);
    bodyMesh.position.y = d.bodyY;
    this.group.add(bodyMesh);
    this.head = new Group();
    this.head.position.set(...d.headPos);
    const headMesh = new Mesh(new BoxGeometry(...d.head), [hideMat, hideMat, hideMat, hideMat, faceMat, hideMat]);
    headMesh.position.z = d.head[2] * 0.3;
    this.head.add(headMesh);
    if (d.horns) {
      const hornMat = mat({ color: new Color(0.85, 0.82, 0.72), roughness: 0.5 });
      for (const sx of [-1, 1]) {
        const h = new Mesh(new BoxGeometry(0.08, 0.14, 0.08), hornMat);
        h.position.set(sx * d.head[0] * 0.45, d.head[1] * 0.55, d.head[2] * 0.1);
        this.head.add(h);
      }
    }
    this.group.add(this.head);
    this.legs = [];
    const [lw, lh, ld] = d.leg;
    const [sx, sz] = d.legSpread;
    const legPos = d.legs === 4 ? [[-sx, sz], [sx, sz], [-sx, -sz], [sx, -sz]] : [[-sx, 0], [sx, 0]];
    for (const [lx, lz] of legPos) {
      const pivot = new Group();
      pivot.position.set(lx, lh, lz);
      const leg = new Mesh(new BoxGeometry(lw, lh, ld), legMat);
      leg.position.y = -lh / 2;
      pivot.add(leg);
      this.group.add(pivot);
      this.legs.push(pivot);
    }
    this.group.traverse((o) => { if (o.isMesh) game.engine.pipeline.addShadowCaster(o); });
    game.engine.scene.add(this.group);
    this.yaw = Math.random() * Math.PI * 2;
    this.targetYaw = this.yaw;
    this.state = 'idle';
    this.timer = Math.random() * 3;
    this.walkPhase = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.headTarget = 0;
  }

  update(dt) {
    const b = this.body;
    const w = this.game.world;
    if (!w.isColumnReady(b.position.x, b.position.z)) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.state === 'idle') {
        this.state = 'walk';
        this.timer = 2 + Math.random() * 5;
        this.targetYaw = this.yaw + (Math.random() - 0.5) * 3;
      } else {
        this.state = 'idle';
        this.timer = 2 + Math.random() * 6;
        this.headTarget = (Math.random() - 0.5) * 1.2;
      }
    }
    let dy = this.targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 3);
    const moving = this.state === 'walk';
    const sp = moving ? this.speed : 0;
    const tx = Math.sin(this.yaw) * sp, tz = Math.cos(this.yaw) * sp;
    const k = 1 - Math.exp(-8 * dt);
    b.velocity.x += (tx - b.velocity.x) * k;
    b.velocity.z += (tz - b.velocity.z) * k;
    if (b.liquid > 0.3) { b.velocity.y += (2 - b.velocity.y) * dt * 3; }
    else b.velocity.y -= 28 * dt;
    // avoid walking off cliffs / into deep water
    if (moving && b.onGround) {
      const ax = b.position.x + Math.sin(this.yaw) * 0.9, az = b.position.z + Math.cos(this.yaw) * 0.9;
      const reg = w.registry;
      let drop = 0;
      for (let d = 0; d < 4; d++) { if (reg.solid[w.getBlock(Math.floor(ax), Math.floor(b.position.y - 0.5 - d), Math.floor(az))]) break; drop++; }
      const water = reg.liquid[w.getBlock(Math.floor(ax), Math.floor(b.position.y - 0.5), Math.floor(az))];
      if (drop >= 3 || water) { this.targetYaw = this.yaw + Math.PI * (0.6 + Math.random() * 0.8); }
    }
    b.move(dt);
    if (moving && (b.collidedX || b.collidedZ) && b.onGround) b.velocity.y = 7.6;
    // animation
    const hs = Math.hypot(b.velocity.x, b.velocity.z);
    this.walkPhase += hs * dt * 5;
    const swing = Math.sin(this.walkPhase) * Math.min(1, hs) * 0.7;
    this.legs.forEach((l, i) => { l.rotation.x = (i % 2 === 0 ? swing : -swing) * (i < 2 ? 1 : -1); });
    this.headYaw += (this.headTarget * (moving ? 0 : 1) - this.headYaw) * Math.min(1, dt * 2);
    this.head.rotation.set(this.state === 'idle' && this.headTarget > 0.4 ? 0.5 : 0, this.headYaw, 0);
    this.group.position.copy(b.position);
    this.group.rotation.y = this.yaw;
    // lighting from the voxel light field
    const l = w.getLight(Math.floor(b.position.x), Math.floor(b.position.y + 0.5), Math.floor(b.position.z));
    const sky = (l >> 4) / 15, blk = (l & 15) / 15;
    for (const m of this.materials) m.setLight(sky, blk);
  }

  dispose() {
    const p = this.game.engine.pipeline;
    this.group.traverse((o) => { if (o.isMesh) { p.removeShadowCaster(o); o.geometry.dispose(); } });
    this.game.engine.scene.remove(this.group);
    for (const m of this.materials) { m.uniforms.tMap.value?.dispose?.(); m.dispose(); }
  }
}

export class Mobs {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.max = 18;
    this._spawnTimer = 2;
  }

  update(dt) {
    const g = this.game;
    const p = g.player.position;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      const d = Math.hypot(m.body.position.x - p.x, m.body.position.z - p.z);
      if (d > 110 || m.body.position.y < -10) { m.dispose(); this.list.splice(i, 1); continue; }
      m.update(dt);
    }
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0 && this.list.length < this.max && g.started) {
      this._spawnTimer = 1.5;
      const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 50;
      const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
      if (!g.world.isColumnReady(x, z)) return;
      const y = g.world.getSurfaceY(x, z);
      if (y < 0 || g.world.getBlock(x, y, z) !== B.grass_block) return;
      if (g.world.getBlock(x, y + 1, z) !== 0 && g.world.registry.solid[g.world.getBlock(x, y + 1, z)]) return;
      const kinds = ['pig', 'cow', 'sheep', 'chicken'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const herd = kind === 'chicken' ? 3 : 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < herd && this.list.length < this.max; i++) {
        const hx = x + 0.5 + (Math.random() - 0.5) * 3, hz = z + 0.5 + (Math.random() - 0.5) * 3;
        const hy = g.world.getSurfaceY(Math.floor(hx), Math.floor(hz));
        if (hy < 0) continue;
        this.list.push(new Mob(g, kind, hx, hy + 1.05, hz));
      }
    }
  }
}
