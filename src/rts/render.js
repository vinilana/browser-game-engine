// Visual representation of the simulation (units, buildings, resources, arrows).
import {
  Group, Mesh, InstancedMesh, Matrix4, Quaternion, Vector3, Euler, CylinderGeometry, MeshBasicMaterial,
  DynamicDrawUsage, Color, BufferGeometry,
} from 'three';
import { UnitBatch, ANIM } from './models/units.js';
import { BUILDING_MODELS, buildScaffold } from './models/buildings.js';
import { buildBush, buildTuft } from './models/trees.js';
import { MeshBuilder } from '../engine/geometry/MeshBuilder.js';
import { GBufferMaterial } from '../engine/render/materials/GBufferMaterial.js';
import { mulberry32 } from '../engine/math/rng.js';
import { TEAMS } from './config.js';

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(1, 1, 1), _e = new Euler(), _up = new Vector3(0, 1, 0);
const _fwd = new Vector3(0, 0, 1), _pos = new Vector3();
const GAIA_COLOR = [0.75, 0.72, 0.66];

function modelFor(u) {
  if (u.kind === 'villager') return u.id % 2 ? 'villager_f' : 'villager';
  return u.def.model;
}

export class GameRenderer {
  constructor(game) {
    this.game = game;
    this.pipeline = game.engine.pipeline;
    this.M = game.materials;
    this.batches = {};
    for (const m of ['villager', 'villager_f', 'swordsman', 'spearman', 'archer', 'scout', 'knight', 'sheep', 'deer']) {
      this.batches[m] = new UnitBatch(this.pipeline, m, m.startsWith('villager') ? 200 : 160);
    }
    this.geoCache = new Map();
    this.buildingViews = new Map();
    this.resourceViews = new Map();
    // arrows
    const ag = new CylinderGeometry(0.012, 0.012, 0.9, 4);
    ag.rotateX(Math.PI / 2);
    this.arrowMat = new GBufferMaterial({ color: new Color(0.35, 0.26, 0.16), roughness: 0.7 });
    this.arrows = new InstancedMesh(ag, this.arrowMat, 512);
    this.arrows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.arrows.frustumCulled = false;
    this.arrows.count = 0;
    this.pipeline.scene.add(this.arrows);
    this.stuck = [];
    this.stuckMesh = new InstancedMesh(ag, this.arrowMat, 256);
    this.stuckMesh.frustumCulled = false;
    this.stuckMesh.count = 0;
    this.pipeline.scene.add(this.stuckMesh);
    // hunting spears (in flight and stuck in the ground after a miss)
    const sb = new MeshBuilder();
    sb.set({ color: [0.46, 0.34, 0.2] }); sb.cylinder([0, 0, -0.9], [0, 0, 0.75], 0.02, 0.018, 5);
    sb.set({ color: [0.62, 0.63, 0.66] }); sb.cone([0, 0, 0.75], [0, 0, 0.98], 0.04, 5);
    const spearGeo = sb.build();
    this.spearMat = new GBufferMaterial({ vertexColors: true, roughness: 0.6 });
    this.spears = new InstancedMesh(spearGeo, this.spearMat, 64);
    this.spears.instanceMatrix.setUsage(DynamicDrawUsage);
    this.spears.frustumCulled = false;
    this.spears.count = 0;
    this.pipeline.scene.add(this.spears);
    this.stuckSpears = new InstancedMesh(spearGeo, this.spearMat, 64);
    this.stuckSpears.frustumCulled = false;
    this.stuckSpears.count = 0;
    this.pipeline.scene.add(this.stuckSpears);
    this.wheatGeo = buildTuft(0.9, 1.0);
  }

  _geo(kind, seed) {
    const key = `${kind}:${seed}`;
    if (!this.geoCache.has(key)) this.geoCache.set(key, BUILDING_MODELS[kind](seed));
    return this.geoCache.get(key);
  }

  // Buildings ---------------------------------------------------------------------
  addBuilding(b) {
    const variant = b.kind === 'house' ? b.id % 3 : 0;
    const model = this._geo(b.kind, variant);
    const group = new Group();
    group.position.set(b.x, b.y, b.z);
    group.rotation.y = b.rotation || 0;
    const meshes = [];
    for (const [key, geo] of Object.entries(model.parts)) {
      const shared = key === 'cloth' ? this.M.cloth[b.owner] : this.M[key];
      if (!shared) { console.warn('missing material', key); continue; }
      const mat = b.built ? shared : shared.clone();
      const mesh = new Mesh(geo, mat);
      mesh.userData.sharedMaterial = shared;
      group.add(mesh);
      meshes.push(mesh);
    }
    let sails = null;
    if (model.sails) {
      sails = new Mesh(model.sails, b.built ? this.M.wood : this.M.wood.clone());
      sails.userData.sharedMaterial = this.M.wood;
      sails.position.set(...model.sailsPos);
      group.add(sails);
      meshes.push(sails);
      if (model.sailsCloth) {
        const cloth = new Mesh(model.sailsCloth, b.built ? this.M.plaster : this.M.plaster.clone());
        cloth.userData.sharedMaterial = this.M.plaster;
        sails.add(cloth);
        meshes.push(cloth);
      }
    }
    let scaffold = null;
    if (!b.built && b.kind !== 'farm') {
      scaffold = new Mesh(this._scaffoldGeo(b.size, model.height), this.M.wood);
      group.add(scaffold);
    }
    let crops = null;
    if (b.kind === 'farm') {
      const n = 12;
      crops = new InstancedMesh(this.wheatGeo, this.M.wheat, n * n);
      const rnd = mulberry32(b.id);
      let k = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        _q.setFromEuler(_e.set(0, rnd() * Math.PI, 0));
        _m.compose(_p.set(-4.2 + (i + 0.5) * 8.4 / n, 0, -4.2 + (j + 0.5) * 8.4 / n), _q, _s.set(1, 0.2, 1));
        crops.setMatrixAt(k++, _m);
      }
      crops.computeBoundingSphere();
      group.add(crops);
    }
    this.pipeline.scene.add(group);
    group.updateMatrixWorld(true);
    for (const m of meshes) this.pipeline.addShadowCaster(m);
    if (scaffold) this.pipeline.addShadowCaster(scaffold);
    const view = { group, meshes, sails, scaffold, crops, height: model.height, cropScale: -1 };
    this.buildingViews.set(b, view);
    this._updateClip(b, view);
  }

  _scaffoldGeo(size, height) {
    const key = `scaffold:${size}:${height}`;
    if (!this.geoCache.has(key)) this.geoCache.set(key, buildScaffold(size, height));
    return this.geoCache.get(key);
  }

  _updateClip(b, view) {
    if (b.built) return;
    const y = b.y + 0.05 + view.height * Math.max(0.02, b.progress);
    for (const m of view.meshes) m.material.uniforms.uClipY.value = y;
  }

  buildingCompleted(b) {
    const view = this.buildingViews.get(b);
    if (!view) return;
    for (const m of view.meshes) {
      if (m.material !== m.userData.sharedMaterial) {
        this.pipeline.removeShadowCaster(m);
        m.material.dispose();
        m.material = m.userData.sharedMaterial;
        this.pipeline.addShadowCaster(m);
      }
    }
    if (view.scaffold) {
      this.pipeline.removeShadowCaster(view.scaffold);
      view.group.remove(view.scaffold);
      view.scaffold = null;
    }
  }

  removeBuilding(b) {
    const view = this.buildingViews.get(b);
    if (!view) return;
    this.pipeline.scene.remove(view.group);
    view.group.traverse((o) => { if (o.isMesh) this.pipeline.removeShadowCaster(o); });
    this.buildingViews.delete(b);
    this.game.particles?.dust(b.x, b.y, b.z, 40, b.size * 0.5);
  }

  // Resources ------------------------------------------------------------------------
  addResource(n) {
    if (n.type === 'carcass') return;
    const group = new Group();
    group.position.set(n.x, n.y, n.z);
    const rnd = mulberry32(n.id * 13 + 5);
    if (n.type === 'gold' || n.type === 'stone') {
      const b = new MeshBuilder({ attributes: { aWind: 1 } });
      const rocks = 6 + Math.floor(rnd() * 4);
      for (let k = 0; k < rocks; k++) {
        const a = rnd() * Math.PI * 2, d = k === 0 ? 0 : 0.6 + rnd() * 1.6;
        const r = k === 0 ? 1.4 : 0.5 + rnd() * 0.7;
        const f1 = rnd() * 10, f2 = rnd() * 10;
        b.sphere([Math.cos(a) * d, r * 0.45, Math.sin(a) * d], [r, r * (0.7 + rnd() * 0.4), r * (0.8 + rnd() * 0.4)], 9, 6, {
          noise: (x, y, z) => (Math.sin(x * 5 + f1) * Math.sin(z * 4 + f2) * Math.sin(y * 6 + f1)) * 0.18 + (Math.abs(Math.sin(x * 11 + z * 7 + f2)) - 0.5) * 0.08,
        });
      }
      const mesh = new Mesh(b.build(), n.type === 'gold' ? this.M.goldOre : this.M.stoneOre);
      group.add(mesh);
      this.pipeline.addShadowCaster(mesh);
    } else if (n.type === 'berry') {
      const bush = buildBush(n.id, { radius: 0.95, cards: 20, berries: 26 });
      const leaves = new Mesh(bush.leaves, this.M.leavesBush);
      group.add(leaves);
      this.pipeline.addShadowCaster(leaves);
      const bb = new MeshBuilder();
      for (const p of bush.berries) bb.sphere(p, 0.06, 5, 4);
      const berries = new Mesh(bb.build(), this.M.berry);
      group.add(berries);
      group.userData.berries = berries;
      group.userData.berryIndex = berries.geometry.index.count;
      group.userData.berryCount = Math.max(1, bush.berries.length);
    }
    group.rotation.y = rnd() * Math.PI * 2;
    this.pipeline.scene.add(group);
    group.updateMatrixWorld(true);
    this.resourceViews.set(n, group);
  }

  removeResource(n) {
    const g = this.resourceViews.get(n);
    if (!g) return;
    this.pipeline.scene.remove(g);
    g.traverse((o) => { if (o.isMesh) this.pipeline.removeShadowCaster(o); });
    this.resourceViews.delete(n);
  }

  stuckArrow(x, y, z, dx, dz, kind = 'arrow') {
    this.stuck.push({ x, y, z, a: Math.atan2(dx, dz), t: 0, kind });
    if (this.stuck.length > 250) this.stuck.shift();
  }

  // Per frame ------------------------------------------------------------------------------
  update(dt) {
    const sim = this.game.sim;
    for (const b of Object.values(this.batches)) b.begin();
    const push = (u) => {
      if (u.owner === 1 && !sim.isVisibleTo(0, u.x, u.z) && u.alive) return;
      if (u.owner < 0 && !sim.isExploredBy(0, u.x, u.z)) return;
      const batch = this.batches[modelFor(u)];
      if (!batch) return;
      let y = u.y;
      let extra = 0;
      if (!u.alive) {
        extra = Math.min(1, u.deadT / 0.7);
        if (!u.isAnimal && u.deadT > 8) y -= (u.deadT - 8) * 0.12;
        if (u.isAnimal && u.carcass) {
          const f = Math.max(0.2, u.carcass.amount / u.def.food);
          _s.set(1, f, 1);
        } else _s.set(1, 1, 1);
      } else _s.set(1, 1, 1);
      _q.setFromAxisAngle(_up, u.heading);
      _m.compose(_p.set(u.x, y, u.z), _q, _s);
      const color = u.owner >= 0 ? TEAMS[u.owner].color : GAIA_COLOR;
      batch.push(_m, u.alive ? u.anim : ANIM.DEAD, u.phase, u.mask || 0, extra, color);
    };
    for (const u of sim.units) push(u);
    for (const u of sim.corpses) push(u);
    for (const b of Object.values(this.batches)) b.end();

    // buildings: construction progress, mill sails, farms, fog of war
    for (const [b, view] of this.buildingViews) {
      if (!b.built) this._updateClip(b, view);
      if (view.sails && b.built) view.sails.rotation.z += dt * 0.5;
      if (view.crops) {
        const f = b.built ? 0.25 + 0.75 * (b.food / 175) : 0.08;
        if (Math.abs(f - view.cropScale) > 0.02) {
          view.cropScale = f;
          view.crops.scale.set(1, f, 1);
        }
      }
      view.group.visible = b.owner === 0 || sim.isExploredBy(0, b.x, b.z);
    }
    for (const [n, g] of this.resourceViews) {
      const f = n.amount / n.maxAmount;
      if (n.type === 'gold' || n.type === 'stone') { const s = 0.45 + 0.55 * Math.sqrt(f); g.scale.set(s, s, s); }
      if (n.type === 'berry' && g.userData.berries) {
        // berries disappear a few at a time as the bush is picked
        const b = g.userData.berries;
        const n = g.userData.berryCount, per = g.userData.berryIndex / n;
        b.geometry.setDrawRange(0, Math.ceil(n * f) * per);
        b.visible = f > 0.01;
      }
    }
    // arrows and spears in flight
    let k = 0, ks = 0;
    for (const p of sim.projectiles) {
      if (p.owner === 1 && !sim.isVisibleTo(0, p.x, p.z)) continue;
      const dir = _p.set(p.dx || 0, p.dy || 0, p.dz || 1).normalize();
      _q.setFromUnitVectors(_fwd, dir);
      _m.compose(_pos.set(p.x, p.y, p.z), _q, _s.set(1, 1, 1));
      if (p.kind === 'spear') { if (ks < 64) this.spears.setMatrixAt(ks++, _m); } else if (k < 512) this.arrows.setMatrixAt(k++, _m);
    }
    this.arrows.count = k;
    this.arrows.instanceMatrix.needsUpdate = true;
    this.spears.count = ks;
    this.spears.instanceMatrix.needsUpdate = true;
    k = 0; ks = 0;
    for (const a of this.stuck) {
      a.t += dt;
      const spear = a.kind === 'spear';
      _q.setFromEuler(_e.set(spear ? 0.45 : 0.7, a.a, 0, 'YXZ'));
      _m.compose(_p.set(a.x, a.y + (spear ? 0.55 : 0.25), a.z), _q, _s.set(1, 1, 1));
      if (spear) { if (ks < 64) this.stuckSpears.setMatrixAt(ks++, _m); } else if (k < 256) this.stuckMesh.setMatrixAt(k++, _m);
    }
    this.stuck = this.stuck.filter((a) => a.t < (a.kind === 'spear' ? 6 : 15));
    this.stuckMesh.count = k;
    this.stuckMesh.instanceMatrix.needsUpdate = true;
    this.stuckSpears.count = ks;
    this.stuckSpears.instanceMatrix.needsUpdate = true;
  }

  /** Semi-transparent building preview for placement. */
  makeGhost(kind) {
    const model = this._geo(kind, 0);
    const g = new Group();
    const mat = new MeshBasicMaterial({ color: 0x55ff77, transparent: true, opacity: 0.35, depthWrite: false });
    for (const geo of Object.values(model.parts)) g.add(new Mesh(geo, mat));
    if (model.sails) {
      const s = new Mesh(model.sails, mat);
      s.position.set(...model.sailsPos);
      if (model.sailsCloth) s.add(new Mesh(model.sailsCloth, mat));
      g.add(s);
    }
    g.userData.mat = mat;
    return g;
  }
}

export { BufferGeometry };
