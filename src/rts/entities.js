// Game entities for "Reinos": units (villagers, soldiers, animals), buildings,
// resource nodes and projectiles, with their behaviour state machines.
import { UNITS, BUILDINGS, RESOURCES, GATHER_RATE, CARRY, BUILD_RATE, damage, GRID } from './config.js';
import { ANIM, TOOL_BIT } from './models/units.js';

let NEXT_ID = 1;

export class Entity {
  constructor(game, kind, owner, x, z) {
    this.id = NEXT_ID++;
    this.game = game;
    this.kind = kind;
    this.owner = owner;
    this.x = x;
    this.z = z;
    this.y = game.world.heightAt(x, z);
    this.alive = true;
    this.selected = false;
  }
  dist(o) { return Math.hypot(o.x - this.x, o.z - this.z); }
}

// ---------------------------------------------------------------------------
export class ResourceNode extends Entity {
  constructor(game, type, x, z, amount) {
    super(game, type, -1, x, z);
    this.type = type;
    this.isResource = true;
    this.def = RESOURCES[type];
    this.res = this.def.res;
    this.amount = amount ?? this.def.amount;
    this.maxAmount = this.amount;
    this.radius = type === 'gold' || type === 'stone' ? 2.6 : type === 'berry' ? 0.9 : 0.8;
    this.workers = 0;
  }
  take(n) {
    const got = Math.min(n, this.amount);
    this.amount -= got;
    if (this.amount <= 0) this.game.removeResource(this);
    return got;
  }
  workPoint(unit, k = 0) {
    const a = (unit.id * 2.39996 + k * 1.9) % (Math.PI * 2);
    const r = this.radius + unit.def.radius + 0.35;
    return { x: this.x + Math.cos(a) * r, z: this.z + Math.sin(a) * r };
  }
}

// ---------------------------------------------------------------------------
export class Building extends Entity {
  constructor(game, kind, owner, x, z, { built = false } = {}) {
    super(game, kind, owner, x, z);
    this.isBuilding = true;
    this.def = BUILDINGS[kind];
    this.size = this.def.size;
    this.maxHp = this.def.hp;
    this.hp = built ? this.maxHp : 1;
    this.built = built;
    this.progress = built ? 1 : 0;
    this.queue = [];
    this.trainT = 0;
    this.rally = null;
    this.attackT = 0;
    this.research = null;
    this.rotation = 0;
    if (kind === 'farm') {
      this.food = BUILDINGS.farm.food;
      this.farmer = null;
    }
    this.builders = 0;
    this.radius = this.size * 0.5;
  }

  get isDropSite() { return this.built && !!this.def.drop; }
  accepts(res) { return this.built && this.def.drop && this.def.drop.includes(res); }

  /** Closest point outside the footprint (for dropping / building). */
  edgePoint(unit) {
    const half = this.size / 2 + unit.def.radius + 0.3;
    const dx = unit.x - this.x, dz = unit.z - this.z;
    const m = Math.max(Math.abs(dx), Math.abs(dz)) || 1;
    return { x: this.x + (dx / m) * half, z: this.z + (dz / m) * half };
  }

  contains(x, z, pad = 0) {
    const h = this.size / 2 + pad;
    return Math.abs(x - this.x) <= h && Math.abs(z - this.z) <= h;
  }

  addProgress(dt, builders) {
    if (this.built) return;
    // AoE-style: extra builders help with diminishing returns
    const speed = builders <= 1 ? 1 : 3 * builders / (builders + 2) / builders;
    const inc = (dt * BUILD_RATE * speed) / this.def.time;
    this.progress = Math.min(1, this.progress + inc);
    this.hp = Math.min(this.maxHp, this.hp + inc * this.maxHp);
    if (this.progress >= 1) {
      this.built = true;
      this.hp = Math.max(this.hp, this.maxHp * 0.999);
      this.game.onBuildingComplete(this);
    }
  }

  update(dt) {
    if (!this.built || !this.alive) return;
    const player = this.game.players[this.owner];
    // research (age up)
    if (this.research) {
      this.research.t += dt;
      if (this.research.t >= this.research.time) {
        const r = this.research;
        this.research = null;
        this.game.onResearchComplete(this, r);
      }
    } else if (this.queue.length) {
      const kind = this.queue[0];
      const def = UNITS[kind];
      if (player.pop + def.pop <= player.popCap) {
        this.trainT += dt;
        if (this.trainT >= def.time) {
          this.trainT = 0;
          this.queue.shift();
          this.game.spawnUnit(kind, this.owner, this);
        }
      } else {
        this.blockedByPop = true;
      }
    }
    // towers and town centers shoot arrows
    if (this.def.attack) {
      this.attackT -= dt;
      if (this.attackT <= 0) {
        const t = this.game.findEnemy(this, this.def.range + this.size / 2);
        if (t) {
          this.attackT = 1 / this.def.rate;
          this.game.fireProjectile(this, t, { x: this.x, y: this.y + (this.kind === 'town_center' ? 9 : 8), z: this.z });
        } else this.attackT = 0.5;
      }
    }
  }
}

// ---------------------------------------------------------------------------
export class Unit extends Entity {
  constructor(game, kind, owner, x, z) {
    super(game, kind, owner, x, z);
    this.isUnit = true;
    this.def = UNITS[kind];
    this.maxHp = this.def.hp;
    this.hp = this.maxHp;
    this.heading = Math.random() * Math.PI * 2;
    this.vx = 0; this.vz = 0;
    this.path = null;
    this.pathIdx = 0;
    this.goal = null;
    this.order = null;       // {type, target, x, z, ...}
    this.state = 'idle';
    this.carry = { res: null, amount: 0 };
    this.anim = ANIM.IDLE;
    this.phase = Math.random();
    this.cooldown = 0;
    this.thinkT = Math.random();
    this.repathT = 0;
    this.deadT = 0;
    this.tools = 0;
    this.stance = 'aggressive';
    this.isAnimal = !!(this.def.classes && this.def.classes.includes('animal'));
    this.isVillager = kind === 'villager';
    this.isMilitary = !this.isVillager && !this.isAnimal;
    this.lastHitBy = null;
    this.stuckT = 0;
  }

  // ---- orders ---------------------------------------------------------------
  command(order) {
    this.order = order;
    this.path = null;
    this.goal = null;
    this.state = order ? order.type : 'idle';
    if (order && order.type !== 'gather' && order.type !== 'build') this.tools &= ~(TOOL_BIT.axe | TOOL_BIT.pick | TOOL_BIT.hammer | TOOL_BIT.basket);
  }

  moveTo(x, z) {
    this.command({ type: 'move', x, z });
  }

  /** Requests a path; returns true when moving. */
  goTo(x, z, arriveDist = 0.6) {
    if (this.goal && Math.hypot(this.goal.x - x, this.goal.z - z) < 0.5 && this.path) return true;
    this.goal = { x, z, arrive: arriveDist };
    this.path = this.game.findPath(this.x, this.z, x, z);
    this.pathIdx = 0;
    return !!this.path;
  }

  arrived() {
    if (!this.goal) return true;
    return Math.hypot(this.goal.x - this.x, this.goal.z - this.z) <= this.goal.arrive;
  }

  _steer(dt) {
    const speed = this.def.speed * (this.carry.amount > 0 ? 0.92 : 1);
    let tx = 0, tz = 0, moving = false;
    if (this.path && this.pathIdx < this.path.length) {
      const [wx, wz] = this.path[this.pathIdx];
      const dx = wx - this.x, dz = wz - this.z;
      const d = Math.hypot(dx, dz);
      const last = this.pathIdx === this.path.length - 1;
      if (d < (last ? Math.max(0.25, this.goal?.arrive * 0.5 || 0.3) : 0.8)) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) { this.path = null; }
      } else {
        tx = dx / d; tz = dz / d; moving = true;
      }
    }
    // separation from neighbours
    let sx = 0, sz = 0;
    const near = this.game.unitsNear(this.x, this.z, 2.5);
    for (const o of near) {
      if (o === this || !o.alive) continue;
      const dx = this.x - o.x, dz = this.z - o.z;
      const d = Math.hypot(dx, dz) || 0.01;
      const min = this.def.radius + o.def.radius + 0.1;
      if (d < min) { sx += (dx / d) * (min - d) * 3; sz += (dz / d) * (min - d) * 3; }
    }
    const k = 1 - Math.exp(-dt * 8);
    this.vx += (tx * speed - this.vx) * k;
    this.vz += (tz * speed - this.vz) * k;
    let nx = this.x + (this.vx + sx) * dt, nz = this.z + (this.vz + sz) * dt;
    const P = this.game.world.path;
    if (!P.isFreeAt(nx, nz)) {
      // slide along axes, else stay
      if (P.isFreeAt(nx, this.z)) nz = this.z;
      else if (P.isFreeAt(this.x, nz)) nx = this.x;
      else if (P.isFreeAt(this.x, this.z)) { nx = this.x; nz = this.z; }
    }
    const moved = Math.hypot(nx - this.x, nz - this.z);
    this.x = nx; this.z = nz;
    this.y = this.game.world.heightAt(this.x, this.z);
    if (moving) {
      const want = Math.atan2(this.vx, this.vz);
      let dh = want - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * Math.min(1, dt * 10);
      this.phase = (this.phase + moved / (this.def.classes?.includes('cavalry') ? 2.6 : 1.3)) % 1;
      this.stuckT = moved < speed * dt * 0.15 ? this.stuckT + dt : 0;
      if (this.stuckT > 1.2 && this.goal) { this.stuckT = 0; const g = this.goal; this.goal = null; this.goTo(g.x, g.z, g.arrive + 0.5); }
    }
    return moving || moved > 0.002;
  }

  face(x, z) {
    const want = Math.atan2(x - this.x, z - this.z);
    let dh = want - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += dh * 0.25;
  }

  takeDamage(n, from) {
    if (!this.alive) return;
    this.hp -= n;
    this.lastHitBy = from;
    this.game.onDamaged?.(this, from);
    if (this.hp <= 0) this.game.killUnit(this);
  }

  // ---- behaviour --------------------------------------------------------------
  update(dt) {
    if (!this.alive) {
      this.deadT += dt;
      this.anim = ANIM.DEAD;
      return;
    }
    this.cooldown -= dt;
    this.thinkT -= dt;
    const o = this.order;
    let moving = false;
    let workAnim = null;

    if (this.isAnimal) {
      moving = this._animal(dt);
    } else if (!o) {
      // idle: soldiers look for enemies, villagers stay put
      if (this.isMilitary && this.thinkT <= 0) {
        this.thinkT = 0.5;
        const e = this.game.findEnemy(this, this.def.los);
        if (e) this.command({ type: 'attack', target: e, auto: true, home: { x: this.x, z: this.z } });
      }
      moving = this._steer(dt);
    } else if (o.type === 'move') {
      if (!this.goal) this.goTo(o.x, o.z, o.arrive ?? 0.6);
      moving = this._steer(dt);
      if (!this.path && this.arrived()) this.command(null);
      else if (!this.path) this.command(null);
    } else if (o.type === 'attack') {
      ({ moving, workAnim } = this._attack(dt, o));
    } else if (o.type === 'gather') {
      ({ moving, workAnim } = this._gather(dt, o));
    } else if (o.type === 'build') {
      ({ moving, workAnim } = this._build(dt, o));
    } else if (o.type === 'dropoff') {
      ({ moving } = this._dropoff(dt, o));
    }

    // animation
    if (moving) {
      this.anim = this.carry.amount > 0 && this.isVillager ? ANIM.CARRY : (this.def.speed > 2.7 && this.path ? ANIM.RUN : ANIM.WALK);
      if (this.isAnimal) this.anim = this.state === 'flee' ? ANIM.RUN : ANIM.WALK;
    } else if (workAnim !== null) {
      this.anim = workAnim;
    } else {
      this.anim = this.isAnimal ? ANIM.GRAZE : ANIM.IDLE;
      this.phase = (this.phase + dt * 0.25) % 1;
    }
    // what is visible in the hands
    let mask = this.tools;
    if (this.carry.amount > 0) mask |= this.carry.res === 'wood' ? TOOL_BIT.wood : this.carry.res === 'food' ? TOOL_BIT.food : TOOL_BIT.sack;
    this.mask = mask;
  }

  _workTick(dt, cycle) {
    this.phase = (this.phase + dt / cycle) % 1;
  }

  _gather(dt, o) {
    const g = this.game;
    let t = o.target;
    const isTree = t && t.type === 'tree';
    const alive = t && (isTree ? t.amount > 0 : t.alive !== false && (t.amount > 0 || (t.isBuilding && t.food > 0)));
    if (!alive) {
      // find another resource of the same kind nearby
      const kind = o.kind;
      const next = kind ? g.findResource(kind, o.lastX ?? this.x, o.lastZ ?? this.z, 18, this) : null;
      if (next) { o.target = next; t = next; this.goal = null; this.path = null; }
      else if (this.carry.amount > 0) { this.command({ type: 'dropoff', then: null }); return { moving: false, workAnim: null }; }
      else { this.command(null); return { moving: false, workAnim: null }; }
    }
    o.kind = isTree ? 'tree' : t.isBuilding ? 'farm' : t.type;
    o.lastX = t.x; o.lastZ = t.z;
    const res = isTree ? 'wood' : t.isBuilding ? 'food' : t.res;
    if (this.carry.res && this.carry.res !== res && this.carry.amount > 0) this.carry = { res: null, amount: 0 };
    // tool for the job
    this.tools = o.kind === 'tree' ? TOOL_BIT.axe : (o.kind === 'gold' || o.kind === 'stone') ? TOOL_BIT.pick : (o.kind === 'berry' || o.kind === 'farm') ? TOOL_BIT.basket : 0;
    if (this.carry.amount >= CARRY) {
      this.command({ type: 'dropoff', then: { type: 'gather', target: t, kind: o.kind } });
      return { moving: false, workAnim: null };
    }
    // walk to the work spot
    let wp;
    if (isTree) wp = g.trees.workPoint(t);
    else if (t.isBuilding) wp = o.farmSpot || (o.farmSpot = { x: t.x + (Math.random() - 0.5) * 6, z: t.z + (Math.random() - 0.5) * 6 });
    else wp = t.workPoint(this, o.side || 0);
    const reach = isTree ? (t.state === 'standing' ? 1.5 : 1.8) : t.isBuilding ? 1.0 : t.radius + this.def.radius + 0.9;
    const d = Math.hypot(wp.x - this.x, wp.z - this.z);
    const dCenter = Math.hypot(t.x - this.x, t.z - this.z);
    // close enough when the exact work spot can't be reached (crowded bushes, buildings in the way)
    const nearEnough = !isTree && !t.isBuilding && o.blockedT > 0.6 && dCenter < t.radius + this.def.radius + 2.6;
    if (d > reach && !nearEnough && !(isTree && t.state === 'standing' && dCenter < 1.8)) {
      if (!this.goal || this.repathT <= 0) {
        const ok = this.goTo(wp.x, wp.z, reach * 0.6);
        this.repathT = 3;
        if (!ok) {
          // unreachable side: try another one, then give up on this node
          o.side = (o.side || 0) + 1;
          if (o.side > 5) {
            const skip = (this._skip ||= new Set());
            skip.add(t);
            const next = g.findResource(o.kind, t.x, t.z, 24, this);
            this.command(next ? { type: 'gather', target: next, kind: o.kind } : (this.carry.amount > 0 ? { type: 'dropoff', then: null } : null));
            return { moving: false, workAnim: null };
          }
        }
      }
      this.repathT -= dt;
      const moving = this._steer(dt);
      if (!this.path && !moving) { this.goal = null; o.blockedT = (o.blockedT || 0) + dt; } else o.blockedT = 0;
      return { moving, workAnim: null };
    }
    this.goal = null; this.path = null;
    this.vx = this.vz = 0;
    this.face(isTree && t.state !== 'standing' ? wp.x + Math.cos(t.fallDir) * 3 : t.x, isTree && t.state !== 'standing' ? wp.z + Math.sin(t.fallDir) * 3 : t.z);
    // AoE: the first chop fells the tree
    if (isTree && t.state === 'standing') g.trees.fell(t, this.x, this.z);
    const rate = GATHER_RATE[o.kind] || 0.3;
    o.acc = (o.acc || 0) + rate * dt;
    if (o.acc >= 1) {
      const n = Math.floor(o.acc);
      o.acc -= n;
      let got;
      if (isTree) got = g.trees.take(t, n);
      else if (t.isBuilding) { got = Math.min(n, t.food); t.food -= got; if (t.food <= 0) g.farmDepleted(t); }
      else got = t.take(n);
      this.carry.res = res;
      this.carry.amount += got;
      g.onGatherTick?.(this, o.kind);
    }
    const anim = o.kind === 'tree' ? ANIM.CHOP : (o.kind === 'gold' || o.kind === 'stone') ? ANIM.MINE : ANIM.FORAGE;
    this._workTick(dt, anim === ANIM.FORAGE ? 1.6 : 1.1);
    return { moving: false, workAnim: anim };
  }

  _dropoff(dt, o) {
    const g = this.game;
    if (!this.carry.amount) { this.command(o.then || null); return { moving: false }; }
    let b = o.target;
    if (!b || !b.alive || !b.accepts(this.carry.res)) {
      b = g.findDropSite(this.owner, this.carry.res, this.x, this.z);
      o.target = b;
      this.goal = null;
      if (!b) { this.command(null); return { moving: false }; }
    }
    const ep = b.edgePoint(this);
    if (!b.contains(this.x, this.z, this.def.radius + 1.2)) {
      if (!this.goal) this.goTo(ep.x, ep.z, 0.9);
      const moving = this._steer(dt);
      if (!this.path && !moving) { this.goal = null; if (!b.contains(this.x, this.z, this.def.radius + 2.5)) this.goTo(ep.x, ep.z, 1.5); }
      return { moving };
    }
    g.players[this.owner].res[this.carry.res] += this.carry.amount;
    g.players[this.owner].gathered[this.carry.res] += this.carry.amount;
    g.onDeposit?.(this, b);
    this.carry = { res: null, amount: 0 };
    this.command(o.then || null);
    return { moving: false };
  }

  _build(dt, o) {
    const g = this.game;
    const b = o.target;
    if (!b || !b.alive || b.built) {
      // continue with work implied by the building
      if (b && b.alive && b.built) {
        if (b.kind === 'farm' && !b.farmer) { b.farmer = this; this.command({ type: 'gather', target: b, kind: 'farm' }); return { moving: false, workAnim: null }; }
        const auto = g.autoGatherFor(this, b);
        if (auto) { this.command(auto); return { moving: false, workAnim: null }; }
        const other = g.findFoundation(this.owner, this.x, this.z, 20);
        if (other) { this.command({ type: 'build', target: other }); return { moving: false, workAnim: null }; }
      }
      this.command(null);
      return { moving: false, workAnim: null };
    }
    this.tools = TOOL_BIT.hammer;
    if (!b.contains(this.x, this.z, this.def.radius + 1.3)) {
      if (!this.goal) {
        const a = (this.id * 2.4) % (Math.PI * 2);
        const half = b.size / 2 + 0.8;
        this.goTo(b.x + Math.cos(a) * half, b.z + Math.sin(a) * half, 1.2);
      }
      const moving = this._steer(dt);
      if (!this.path && !moving) this.goal = null;
      return { moving, workAnim: null };
    }
    this.goal = null; this.path = null; this.vx = this.vz = 0;
    this.face(b.x, b.z);
    b.addProgress(dt, Math.max(1, b.builders));
    b._buildersNext = (b._buildersNext || 0) + 1;
    this._workTick(dt, 0.9);
    g.onBuildTick?.(this, b);
    return { moving: false, workAnim: ANIM.BUILD };
  }

  _attack(dt, o) {
    const g = this.game;
    const t = o.target;
    const tAlive = t && t.alive && (t.isUnit || t.isBuilding);
    if (!tAlive) {
      // look for another target nearby, otherwise go idle
      const e = this.isMilitary || o.hunt ? g.findEnemy(this, this.def.los, o.hunt) : null;
      if (e && !o.hunt) { o.target = e; this.goal = null; return { moving: false, workAnim: null }; }
      if (o.hunt && t && !t.alive && t.carcass) {
        this.command({ type: 'gather', target: t.carcass, kind: 'carcass' });
        return { moving: false, workAnim: null };
      }
      this.command(null);
      return { moving: false, workAnim: null };
    }
    // buildings: distance to the footprint box, units: centre distance minus radii
    const reachR = (this.def.range > 2 ? this.def.range : 0.9 + (this.def.range || 0)) + this.def.radius;
    let range, d;
    if (t.isBuilding) {
      const h = t.size / 2;
      d = Math.hypot(Math.max(0, Math.abs(t.x - this.x) - h), Math.max(0, Math.abs(t.z - this.z) - h));
      range = reachR + 0.3;
    } else {
      d = this.dist(t);
      range = reachR + t.def.radius;
    }
    // leash auto-acquired chases
    if (o.auto && o.home && Math.hypot(this.x - o.home.x, this.z - o.home.z) > this.def.los * 1.6) { this.command({ type: 'move', x: o.home.x, z: o.home.z }); return { moving: false, workAnim: null }; }
    if (d > range) {
      this.repathT -= dt;
      if (!this.goal || this.repathT <= 0) {
        this.repathT = 0.8;
        const p = t.isBuilding ? t.edgePoint(this) : t;
        this.goTo(p.x, p.z, Math.max(0.5, range * 0.8));
      }
      const moving = this._steer(dt);
      if (!this.path && !moving) this.goal = null;
      return { moving, workAnim: null };
    }
    this.goal = null; this.path = null; this.vx = this.vz = 0;
    this.face(t.x, t.z);
    const ranged = this.def.range > 2;
    if (this.cooldown <= 0) {
      this.cooldown = 1 / (this.def.rate || 0.5);
      this.attackStart = g.time;
      if (ranged) g.fireProjectile(this, t, { x: this.x, y: this.y + 1.5, z: this.z });
      else {
        const dmg = this.isVillager && t.isAnimal ? 3 : damage(this, t);
        if (t.isUnit) t.takeDamage(dmg, this); else g.damageBuilding(t, dmg * (this.isVillager ? 1 : 0.8), this);
        g.onMeleeHit?.(this, t);
      }
    }
    const k = Math.min(1, (g.time - (this.attackStart || 0)) * (this.def.rate || 0.5));
    this.phase = k;
    return { moving: false, workAnim: ranged ? ANIM.SHOOT : (this.kind === 'spearman' ? ANIM.THRUST : ANIM.ATTACK) };
  }

  _animal(dt) {
    const g = this.game;
    // flee when hit (deer) or wander slowly
    if (this.lastHitBy && this.kind === 'deer' && this.lastHitBy.alive) {
      this.state = 'flee';
      if (!this.goal || this.arrived()) {
        const a = Math.atan2(this.z - this.lastHitBy.z, this.x - this.lastHitBy.x) + (Math.random() - 0.5);
        this.goTo(this.x + Math.cos(a) * 12, this.z + Math.sin(a) * 12, 1);
      }
      const moving = this._steer(dt);
      if (Math.random() < dt * 0.3) this.lastHitBy = null;
      return moving;
    }
    this.state = 'wander';
    if (this.thinkT <= 0) {
      this.thinkT = 4 + Math.random() * 8;
      if (Math.random() < 0.4) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 5;
        const home = this.home || (this.home = { x: this.x, z: this.z });
        this.goTo(home.x + Math.cos(a) * r, home.z + Math.sin(a) * r, 0.6);
      }
    }
    const moving = this.path ? this._steer(dt * 0.6) : false;
    return moving;
  }
}

// ---------------------------------------------------------------------------
export class Projectile {
  constructor(game, from, target, origin) {
    this.game = game;
    this.from = from;
    this.target = target;
    this.x = origin.x; this.y = origin.y; this.z = origin.z;
    const tx = target.x, tz = target.z;
    const ty = (target.y ?? game.world.heightAt(tx, tz)) + (target.isBuilding ? 2.5 : 1.1);
    const d = Math.hypot(tx - this.x, tz - this.z);
    this.flight = Math.max(0.35, d / 32);
    this.t = 0;
    this.sx = this.x; this.sy = this.y; this.sz = this.z;
    // lead moving targets a little
    this.ex = tx + (target.vx || 0) * this.flight * 0.8;
    this.ez = tz + (target.vz || 0) * this.flight * 0.8;
    this.ey = ty;
    this.arc = d * 0.18;
    this.alive = true;
    this.owner = from.owner;
    this.dmg = from.isUnit ? damage(from, target) : Math.max(1, from.def.attack - (target.def?.pierceArmor || 0));
  }
  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / this.flight);
    const px = this.x, py = this.y, pz = this.z;
    this.x = this.sx + (this.ex - this.sx) * k;
    this.z = this.sz + (this.ez - this.sz) * k;
    this.y = this.sy + (this.ey - this.sy) * k + Math.sin(k * Math.PI) * this.arc;
    this.dx = this.x - px; this.dy = this.y - py; this.dz = this.z - pz;
    if (k >= 1) {
      this.alive = false;
      const t = this.target;
      if (t && t.alive && Math.hypot(t.x - this.x, t.z - this.z) < (t.isBuilding ? t.size / 2 + 0.5 : 1.3)) {
        if (t.isUnit) t.takeDamage(this.dmg, this.from); else this.game.damageBuilding(t, this.dmg * 0.5, this.from);
      } else {
        this.game.stuckArrow?.(this.x, this.game.world.heightAt(this.x, this.z), this.z, this.dx, this.dz);
      }
    }
  }
}

export { GRID };
