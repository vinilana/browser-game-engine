// Core simulation of "Reinos": players, entities, spatial queries, production,
// combat resolution, fog of war and victory conditions.
import { DataTexture, RedFormat, UnsignedByteType, LinearFilter } from 'three';
import { UNITS, BUILDINGS, AGES, START_RES, POP_CAP, MAP_SIZE, GRID, TEAMS, RESOURCES } from './config.js';
import { Unit, Building, ResourceNode, Projectile } from './entities.js';
import { LAYER } from './mapgen.js';

const HASH = 8;

export class Player {
  constructor(index, isAI) {
    this.index = index;
    this.isAI = isAI;
    this.res = { ...START_RES };
    this.gathered = { food: 0, wood: 0, gold: 0, stone: 0 };
    this.pop = 0;
    this.popCap = 0;
    this.age = 0;
    this.color = TEAMS[index].color;
    this.defeated = false;
    this.stats = { unitsKilled: 0, unitsLost: 0, buildingsBuilt: 0 };
  }
  canAfford(cost) { return Object.entries(cost || {}).every(([k, v]) => this.res[k] >= v); }
  pay(cost) { for (const [k, v] of Object.entries(cost || {})) this.res[k] -= v; }
  refund(cost, f = 1) { for (const [k, v] of Object.entries(cost || {})) this.res[k] += Math.floor(v * f); }
}

export class Simulation {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.units = [];
    this.buildings = [];
    this.resources = [];
    this.projectiles = [];
    this.corpses = [];
    this.players = [new Player(0, false), new Player(1, true)];
    this.hash = new Map();
    this.events = [];
    // fog of war (player 0 renders it; the AI gets the same data for fairness checks)
    this.fowN = MAP_SIZE / GRID;
    this.explored = [new Uint8Array(this.fowN * this.fowN), new Uint8Array(this.fowN * this.fowN)];
    this.visible = [new Uint8Array(this.fowN * this.fowN), new Uint8Array(this.fowN * this.fowN)];
    this.fowTexData = new Uint8Array(this.fowN * this.fowN);
    this.fowTex = new DataTexture(this.fowTexData, this.fowN, this.fowN, RedFormat, UnsignedByteType);
    this.fowTex.minFilter = this.fowTex.magFilter = LinearFilter;
    this.fowTex.needsUpdate = true;
    this.fowT = 0;
    this.revealAll = false;
    this.winner = -1;
  }

  // Delegates used by entities -------------------------------------------------
  get world() { return this.game.world; }
  get trees() { return this.game.trees; }

  findPath(sx, sz, gx, gz) { return this.world.path.findPath(sx, sz, gx, gz); }

  _rehash() {
    this.hash.clear();
    for (const u of this.units) {
      if (!u.alive) continue;
      const k = (Math.floor(u.x / HASH) << 16) | Math.floor(u.z / HASH);
      let a = this.hash.get(k);
      if (!a) this.hash.set(k, (a = []));
      a.push(u);
    }
  }

  unitsNear(x, z, r) {
    const out = this._near || (this._near = []);
    out.length = 0;
    const i0 = Math.floor((x - r) / HASH), i1 = Math.floor((x + r) / HASH);
    const j0 = Math.floor((z - r) / HASH), j1 = Math.floor((z + r) / HASH);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const a = this.hash.get((i << 16) | j);
        if (!a) continue;
        for (const u of a) if (Math.abs(u.x - x) <= r && Math.abs(u.z - z) <= r) out.push(u);
      }
    }
    return out;
  }

  isEnemy(a, b) {
    if (b.owner < 0 || a.owner < 0) return false;
    return a.owner !== b.owner;
  }

  /** Nearest enemy (units first, then buildings) within r. hunt = animals. */
  findEnemy(self, r, hunt = false) {
    let best = null, bd = r * r;
    for (const u of this.unitsNear(self.x, self.z, r)) {
      if (!u.alive || u === self) continue;
      if (hunt ? !u.isAnimal : (!this.isEnemy(self, u) || u.isAnimal)) continue;
      const d = (u.x - self.x) ** 2 + (u.z - self.z) ** 2;
      if (d < bd) { bd = d; best = u; }
    }
    if (best || hunt) return best;
    if (self.isBuilding) return null;
    for (const b of this.buildings) {
      if (!b.alive || !this.isEnemy(self, b)) continue;
      const d = Math.max(0, Math.hypot(b.x - self.x, b.z - self.z) - b.size / 2);
      if (d * d < bd) { bd = d * d; best = b; }
    }
    return best;
  }

  findResource(kind, x, z, r, unit) {
    let best = null, bd = r;
    if (kind === 'tree') {
      for (const t of this.game.trees.trees) {
        if (t.amount <= 0 || unit?._skip?.has(t)) continue;
        const d = Math.hypot(t.x - x, t.z - z);
        if (d < bd) { bd = d; best = t; }
      }
      return best;
    }
    if (kind === 'farm') {
      for (const b of this.buildings) {
        if (b.kind !== 'farm' || !b.built || b.owner !== unit.owner || (b.farmer && b.farmer !== unit && b.farmer.alive)) continue;
        const d = Math.hypot(b.x - x, b.z - z);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) best.farmer = unit;
      return best;
    }
    for (const n of this.resources) {
      if (!n.alive || n.type !== kind || n.amount <= 0 || unit?._skip?.has(n)) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  findDropSite(owner, res, x, z) {
    let best = null, bd = 1e9;
    for (const b of this.buildings) {
      if (!b.alive || b.owner !== owner || !b.accepts(res)) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  findFoundation(owner, x, z, r) {
    let best = null, bd = r;
    for (const b of this.buildings) {
      if (!b.alive || b.owner !== owner || b.built) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  autoGatherFor(unit, b) {
    const map = { lumber_camp: 'tree', mill: 'berry', mining_camp: 'gold' };
    const kind = map[b.kind];
    if (!kind) return null;
    let t = this.findResource(kind, b.x, b.z, 22, unit);
    if (!t && b.kind === 'mining_camp') t = this.findResource('stone', b.x, b.z, 22, unit);
    return t ? { type: 'gather', target: t, kind: t.type || kind } : null;
  }

  // Creation / destruction ------------------------------------------------------
  addResource(type, x, z, amount) {
    const n = new ResourceNode(this, type, x, z, amount);
    this.resources.push(n);
    if (type !== 'carcass') this.world.path.markCircle(x, z, n.radius, 1);
    this.game.renderer?.addResource(n);
    return n;
  }

  removeResource(n) {
    if (!n.alive) return;
    n.alive = false;
    if (n.type !== 'carcass') this.world.path.markCircle(n.x, n.z, n.radius, -1);
    this.game.renderer?.removeResource(n);
    if (n.corpse) n.corpse.removeAt = this.time + 0.5;
  }

  addUnit(kind, owner, x, z) {
    const u = new Unit(this, kind, owner, x, z);
    this.units.push(u);
    if (owner >= 0) this.players[owner].pop += UNITS[kind].pop || 0;
    return u;
  }

  spawnUnit(kind, owner, building) {
    // find a free spot around the building, preferably toward the rally point
    const P = this.world.path;
    const target = building.rally || { x: building.x, z: building.z + building.size };
    const ang = Math.atan2(target.z - building.z, target.x - building.x);
    let sx = building.x, sz = building.z;
    for (let k = 0; k < 24; k++) {
      const a = ang + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.35;
      const r = building.size / 2 + 1.2;
      sx = building.x + Math.cos(a) * r; sz = building.z + Math.sin(a) * r;
      if (P.isFreeAt(sx, sz)) break;
    }
    const u = this.addUnit(kind, owner, sx, sz);
    u.heading = ang + Math.PI / 2;
    if (building.rally) {
      if (building.rally.target && kind === 'villager') {
        const t = building.rally.target;
        if (t.isResource || t.type === 'tree') u.command({ type: 'gather', target: t, kind: t.type });
        else u.moveTo(building.rally.x, building.rally.z);
      } else u.moveTo(building.rally.x, building.rally.z);
    }
    this.game.onUnitTrained?.(u, building);
    return u;
  }

  killUnit(u) {
    if (!u.alive) return;
    u.alive = false;
    u.hp = 0;
    u.deadT = 0;
    u.order = null;
    if (u.owner >= 0) {
      this.players[u.owner].pop -= u.def.pop || 0;
      this.players[u.owner].stats.unitsLost++;
    }
    if (u.lastHitBy && u.lastHitBy.owner >= 0) this.players[u.lastHitBy.owner].stats.unitsKilled++;
    if (u.isAnimal) {
      const c = this.addResource('carcass', u.x, u.z, u.def.food);
      c.corpse = u;
      u.carcass = c;
      u.removeAt = Infinity;
    } else {
      u.removeAt = this.time + 12;
    }
    this.corpses.push(u);
    this.game.onUnitDied?.(u);
  }

  canPlace(kind, x, z, owner) {
    const def = BUILDINGS[kind];
    if (!this.world.canBuild(x, z, def.size)) return false;
    // don't allow building in unexplored fog
    const i = Math.floor(x / GRID), j = Math.floor(z / GRID);
    if (!this.explored[owner][j * this.fowN + i]) return false;
    // keep a small gap from units standing on the spot
    for (const u of this.unitsNear(x, z, def.size / 2 + 0.3)) if (u.alive && u.isAnimal) return false;
    return true;
  }

  placeBuilding(kind, owner, x, z, { built = false, free = false } = {}) {
    const def = BUILDINGS[kind];
    const player = this.players[owner];
    if (!free) {
      if (!player.canAfford(def.cost)) return null;
      player.pay(def.cost);
    }
    const b = new Building(this, kind, owner, x, z, { built });
    b.y = this.world.prepareSite(x, z, def.size, kind === 'farm' ? LAYER.DIRT : LAYER.PATH);
    this.game.cover?.clearRect(x, z, def.size / 2 + 1);
    if (!def.passable) this.world.path.markRect(x - def.size / 2, z - def.size / 2, x + def.size / 2, z + def.size / 2, 1);
    this.buildings.push(b);
    // push units out of the footprint
    for (const u of this.unitsNear(x, z, def.size / 2 + 1)) {
      if (!def.passable && b.contains(u.x, u.z, u.def.radius)) {
        const f = this.world.path.nearestFree(u.x, u.z, 10);
        if (f) { const [cx, cz] = this.world.path.centerOf(f[0], f[1]); u.x = cx; u.z = cz; }
      }
    }
    this.game.renderer?.addBuilding(b);
    if (built) this.onBuildingComplete(b, true);
    return b;
  }

  onBuildingComplete(b, initial = false) {
    const p = this.players[b.owner];
    if (b.def.pop) p.popCap = Math.min(POP_CAP, p.popCap + b.def.pop);
    if (!initial) p.stats.buildingsBuilt++;
    this.game.renderer?.buildingCompleted(b);
    if (!initial) this.game.onBuildingComplete?.(b);
  }

  damageBuilding(b, n, from) {
    if (!b.alive) return;
    b.hp -= n;
    b.lastHitBy = from;
    this.game.onDamaged?.(b, from);
    if (b.hp <= 0) this.destroyBuilding(b);
  }

  destroyBuilding(b) {
    if (!b.alive) return;
    b.alive = false;
    const p = this.players[b.owner];
    if (b.built && b.def.pop) p.popCap = Math.max(0, p.popCap - b.def.pop);
    // refund queued units
    for (const k of b.queue) p.refund(UNITS[k].cost);
    b.queue.length = 0;
    if (!b.def.passable) this.world.path.markRect(b.x - b.size / 2, b.z - b.size / 2, b.x + b.size / 2, b.z + b.size / 2, -1);
    this.game.renderer?.removeBuilding(b);
    this.game.onBuildingDestroyed?.(b);
  }

  farmDepleted(b) {
    b.food = 0;
    this.destroyBuilding(b);
  }

  fireProjectile(from, target, origin) {
    this.projectiles.push(new Projectile(this, from, target, origin));
    this.game.onFire?.(from);
  }

  stuckArrow(x, y, z, dx, dz) { this.game.renderer?.stuckArrow(x, y, z, dx, dz); }
  onDamaged(t, from) { this.game.onDamaged?.(t, from); }
  onGatherTick(u, kind) { this.game.onGatherTick?.(u, kind); }
  onDeposit(u, b) { this.game.onDeposit?.(u, b); }
  onBuildTick(u, b) { this.game.onBuildTick?.(u, b); }
  onMeleeHit(u, t) { this.game.onMeleeHit?.(u, t); }

  // Commands (validated) -----------------------------------------------------------
  train(b, kind) {
    const p = this.players[b.owner];
    const def = UNITS[kind];
    if (!b.built || !b.def.train?.includes(kind)) return 'invalid';
    if ((def.age || 0) > p.age) return 'age';
    if (b.queue.length >= 10) return 'queue';
    if (!p.canAfford(def.cost)) return 'cost';
    p.pay(def.cost);
    b.queue.push(kind);
    return 'ok';
  }

  cancelTrain(b, idx = b.queue.length - 1) {
    if (idx < 0 || idx >= b.queue.length) return;
    const k = b.queue.splice(idx, 1)[0];
    this.players[b.owner].refund(UNITS[k].cost);
    if (idx === 0) b.trainT = 0;
  }

  ageUp(b) {
    const p = this.players[b.owner];
    const next = AGES[p.age + 1];
    if (!next || b.kind !== 'town_center' || b.research || b.queue.length) return 'invalid';
    if (!p.canAfford(next.cost)) return 'cost';
    p.pay(next.cost);
    b.research = { type: 'age', age: p.age + 1, t: 0, time: next.time };
    return 'ok';
  }

  onResearchComplete(b, r) {
    if (r.type === 'age') {
      this.players[b.owner].age = r.age;
      this.game.onAgeUp?.(b.owner, r.age);
    }
  }

  // Fog of war ---------------------------------------------------------------------------
  _updateFow() {
    const N = this.fowN;
    for (let p = 0; p < 2; p++) {
      const vis = this.visible[p], exp = this.explored[p];
      vis.fill(0);
      const reveal = (x, z, r) => {
        const cr = Math.ceil(r / GRID);
        const ci = Math.floor(x / GRID), cj = Math.floor(z / GRID);
        const r2 = (r / GRID) ** 2;
        for (let dj = -cr; dj <= cr; dj++) {
          const j = cj + dj;
          if (j < 0 || j >= N) continue;
          for (let di = -cr; di <= cr; di++) {
            const i = ci + di;
            if (i < 0 || i >= N || di * di + dj * dj > r2) continue;
            vis[j * N + i] = 1; exp[j * N + i] = 1;
          }
        }
      };
      for (const u of this.units) if (u.alive && u.owner === p) reveal(u.x, u.z, u.def.los);
      for (const b of this.buildings) if (b.alive && b.owner === p) reveal(b.x, b.z, (b.def.los || 8) + b.size / 2);
    }
    const vis = this.visible[0], exp = this.explored[0];
    for (let k = 0; k < N * N; k++) this.fowTexData[k] = this.revealAll ? 255 : vis[k] ? 255 : exp[k] ? 120 : 0;
    this.fowTex.needsUpdate = true;
  }

  isVisibleTo(p, x, z) {
    if (this.revealAll && p === 0) return true;
    const i = Math.floor(x / GRID), j = Math.floor(z / GRID);
    if (i < 0 || j < 0 || i >= this.fowN || j >= this.fowN) return false;
    return this.visible[p][j * this.fowN + i] === 1;
  }

  isExploredBy(p, x, z) {
    if (this.revealAll && p === 0) return true;
    const i = Math.floor(x / GRID), j = Math.floor(z / GRID);
    if (i < 0 || j < 0 || i >= this.fowN || j >= this.fowN) return false;
    return this.explored[p][j * this.fowN + i] === 1;
  }

  // Main loop -------------------------------------------------------------------------------
  update(dt) {
    if (this.winner >= 0) return;
    this.time += dt;
    this._rehash();
    for (const b of this.buildings) {
      b.builders = b._buildersNext || 0;
      b._buildersNext = 0;
    }
    for (const u of this.units) u.update(dt);
    for (const b of this.buildings) b.update(dt);
    for (const p of this.projectiles) p.update(dt);
    if (this.projectiles.some((p) => !p.alive)) this.projectiles = this.projectiles.filter((p) => p.alive);
    // cleanup
    if (this.units.some((u) => !u.alive)) this.units = this.units.filter((u) => u.alive);
    for (const c of this.corpses) c.update(dt);
    this.corpses = this.corpses.filter((c) => this.time < c.removeAt);
    if (this.buildings.some((b) => !b.alive)) this.buildings = this.buildings.filter((b) => b.alive);
    if (this.resources.some((r) => !r.alive)) this.resources = this.resources.filter((r) => r.alive);
    // carcasses rot slowly
    for (const r of this.resources) if (r.type === 'carcass' && r.alive) { r.rot = (r.rot || 0) + dt * RESOURCES.carcass.decay; if (r.rot >= 1) { r.rot -= 1; r.take(1); } }
    this.fowT -= dt;
    if (this.fowT <= 0) { this.fowT = 0.2; this._updateFow(); }
    this._checkVictory();
  }

  _checkVictory() {
    this._vt = (this._vt || 0) + 1;
    if (this._vt % 30) return;
    for (let p = 0; p < 2; p++) {
      const hasBuilding = this.buildings.some((b) => b.alive && b.owner === p && b.kind !== 'farm');
      const hasUnit = this.units.some((u) => u.alive && u.owner === p && !u.isAnimal);
      if (!hasBuilding && !hasUnit && !this.players[p].defeated) {
        this.players[p].defeated = true;
        this.winner = 1 - p;
        this.game.onGameOver?.(this.winner);
      }
    }
  }
}
