// Game entities for "Reinos": units (villagers, soldiers, animals), buildings,
// resource nodes and projectiles, with their behaviour state machines.
import { UNITS, BUILDINGS, RESOURCES, GATHER_RATE, CARRY, BUILD_RATE, HUNT, FELL_TIME, REPAIR, MAP_SIZE, damage, GRID } from './config.js';
import { ANIM, TOOL_BIT, IMPACT } from './models/units.js';

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
    return { x: this.x + Math.cos(a) * r, z: this.z + Math.sin(a) * r, fx: this.x, fz: this.z };
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
const WORK_TOOLS = TOOL_BIT.axe | TOOL_BIT.pick | TOOL_BIT.hammer | TOOL_BIT.basket | TOOL_BIT.spear;
// animation phases (0..1) where a work blow lands: axe/pick, hammer (two per cycle), hands
const CHOP_IMPACTS = [0.62];
const BUILD_IMPACTS = [0.125, 0.625];
const FORAGE_IMPACTS = [0.5];
const IDLE_RESULT = { moving: false, workAnim: null };

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
    this.queue = [];         // orders queued with Shift
    this.lastWork = null;    // where to resume after a manual drop-off
    this.state = 'idle';
    this.carry = { res: null, amount: 0, kind: null };
    this.anim = ANIM.IDLE;
    this.phase = Math.random();
    this.cooldown = 0;
    this.swing = null;       // attack in progress: the blow lands / missile leaves at `impact`
    this.thinkT = Math.random();
    this.herdT = Math.random() * 0.5;
    this.repathT = 0;
    this.deadT = 0;
    this.hitT = 0;
    this.tools = 0;
    this.stance = 'aggressive';   // aggressive | defensive | ground
    this.isAnimal = !!(this.def.classes && this.def.classes.includes('animal'));
    this.isVillager = kind === 'villager';
    this.isMilitary = !this.isVillager && !this.isAnimal;
    this.lastHitBy = null;
    this.stuckT = 0;
  }

  // ---- orders ---------------------------------------------------------------
  /** Order from a player or the AI: replaces current plans, or is appended when queued (Shift). */
  issue(order, queued = false) {
    if (queued && (this.order || this.queue.length)) { this.queue.push(order); return; }
    this.queue.length = 0;
    this.command(order);
  }

  /** Drops the current order and everything queued. */
  stop() { this.queue.length = 0; this.command(null); }

  /** Switches the active order; finishing one (null) starts the next queued order. */
  command(order) {
    if (!order && this.queue.length) order = this.queue.shift();
    this.order = order;
    this.path = null;
    this.goal = null;
    this.swing = null;
    this.spearGone = false;
    this.state = order ? order.type : 'idle';
    const keepsTools = order && (order.type === 'gather' || order.type === 'build' || order.type === 'repair' || (order.type === 'attack' && this.isVillager));
    if (!keepsTools) this.tools &= ~WORK_TOOLS;
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

  /** Closes in on a (possibly moving) point: straight at it when the way is clear, A* otherwise. */
  _chase(tx, tz, dt, arrive, direct) {
    const P = this.game.world.path;
    if (direct && Math.hypot(tx - this.x, tz - this.z) < 14 && P.lineFree(this.x, this.z, tx, tz)) {
      this.goal = { x: tx, z: tz, arrive };
      this.path = [[tx, tz]];
      this.pathIdx = 0;
    } else {
      this.repathT -= dt;
      const drift = this.goal ? Math.hypot(this.goal.x - tx, this.goal.z - tz) : Infinity;
      if (!this.path || this.repathT <= 0 || drift > 4) { this.repathT = 0.8; this.goal = null; this.goTo(tx, tz, arrive); }
    }
    const moving = this._steer(dt);
    if (!this.path && !moving) this.goal = null;
    return moving;
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
    this.hitT = 0.3;
    this.game.onDamaged?.(this, from);
    if (this.hp <= 0) { this.game.killUnit(this); return; }
    if (this.isAnimal) {
      // wild deer bolt away from whoever hurt them
      if (this.kind === 'deer' && from) { this.fleeFrom = from; this.fleeGoal = null; }
      return;
    }
    if (!from || !from.alive || from.owner === this.owner || this.order) return;
    // idle soldiers answer back, idle villagers get out of the way
    if (this.isMilitary && this.stance !== 'ground') this.command({ type: 'attack', target: from, auto: true, home: { x: this.x, z: this.z } });
    else if (this.isVillager && from.isUnit) {
      const a = Math.atan2(this.z - from.z, this.x - from.x);
      this.command({ type: 'move', x: this.x + Math.cos(a) * 8, z: this.z + Math.sin(a) * 8 });
    }
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
    if (this.hitT > 0) this.hitT -= dt;
    const o = this.order;
    let moving = false;
    let workAnim = null;

    if (this.isAnimal) {
      moving = this.owner >= 0 && o && o.type === 'move' ? this._move(dt, o) : this._animal(dt);
    } else if (!o) {
      // idle: soldiers look for enemies (per stance), villagers stay put
      if (this.isMilitary && this.thinkT <= 0) {
        this.thinkT = 0.5;
        const e = this._scan();
        if (e) this.command({ type: 'attack', target: e, auto: true, home: { x: this.x, z: this.z } });
      }
      moving = this._steer(dt);
    } else if (o.type === 'move') {
      moving = this._move(dt, o);
    } else if (o.type === 'attack') {
      ({ moving, workAnim } = this._attack(dt, o));
    } else if (o.type === 'gather') {
      ({ moving, workAnim } = this._gather(dt, o));
    } else if (o.type === 'build') {
      ({ moving, workAnim } = this._build(dt, o));
    } else if (o.type === 'repair') {
      ({ moving, workAnim } = this._repair(dt, o));
    } else if (o.type === 'dropoff') {
      ({ moving } = this._dropoff(dt, o));
    }

    // animation
    if (moving) {
      if (this.isAnimal) this.anim = this.state === 'flee' ? ANIM.RUN : ANIM.WALK;
      else this.anim = this.carry.amount > 0 && this.isVillager ? ANIM.CARRY : (this.def.speed > 2.7 && this.path ? ANIM.RUN : ANIM.WALK);
    } else if (workAnim !== null) {
      this.anim = workAnim;
    } else {
      this.anim = this.isAnimal ? ANIM.GRAZE : ANIM.IDLE;
      this.phase = (this.phase + dt * 0.25) % 1;
    }
    // what is visible in the hands / on the back
    let mask = this.tools;
    if (this.carry.amount > 0) {
      const c = this.carry;
      mask |= c.res === 'wood' ? TOOL_BIT.wood : c.res === 'food' ? (c.kind === 'carcass' ? TOOL_BIT.meat : TOOL_BIT.food) : TOOL_BIT.sack;
    }
    if (this.spearGone) mask &= ~TOOL_BIT.spear;
    this.mask = mask;
  }

  /** Advances a work animation and reports the blows (for sounds, chips, sparks...). */
  _workTick(dt, cycle, impacts = null, strike = null, target = null) {
    const p0 = this.phase;
    const p1 = (p0 + dt / cycle) % 1;
    this.phase = p1;
    if (!impacts) return;
    for (const i of impacts) {
      if (p0 <= p1 ? (p0 < i && p1 >= i) : (p0 < i || p1 >= i)) { this.game.onStrike?.(this, strike, target); break; }
    }
  }

  /** Enemy worth engaging, given the stance. */
  _scan() {
    const r = this.stance === 'ground' ? (this.def.range > 2 ? this.def.range : 1.6) + this.def.radius
      : this.stance === 'defensive' ? Math.min(this.def.los, 9) : this.def.los;
    return this.game.findEnemy(this, r);
  }

  _move(dt, o) {
    // attack-move: engage anything met on the way, then carry on
    if (o.attackMove && this.isMilitary && this.thinkT <= 0) {
      this.thinkT = 0.4;
      const e = this.game.findEnemy(this, this.def.los);
      if (e) {
        this.queue.unshift(o);
        this.command({ type: 'attack', target: e, auto: true });
        return false;
      }
    }
    if (!this.goal) this.goTo(o.x, o.z, o.arrive ?? 0.6);
    const moving = this._steer(dt);
    if (!this.path) {
      if (this.isAnimal) this.home = { x: this.x, z: this.z };
      this.command(null);
    }
    return moving;
  }

  /** Distance to a target (buildings: to the footprint) and the reach needed to hit it. */
  _reach(t, reachR) {
    if (t.isBuilding) {
      const h = t.size / 2;
      return [Math.hypot(Math.max(0, Math.abs(t.x - this.x) - h), Math.max(0, Math.abs(t.z - this.z) - h)), reachR + 0.3];
    }
    return [this.dist(t), reachR + (t.def?.radius || 0.4)];
  }

  _attack(dt, o) {
    const g = this.game;
    const t = o.target;
    const hunting = !!o.hunt;
    if (!(t && t.alive && (t.isUnit || t.isBuilding))) {
      // the quarry is down: butcher it
      if (hunting && this.isVillager && t && t.carcass && t.carcass.alive) {
        this.command({ type: 'gather', target: t.carcass, kind: 'carcass', species: t.kind });
        return IDLE_RESULT;
      }
      // soldiers pick the next enemy nearby, otherwise the order is done
      const e = this.isMilitary && !hunting && this.stance !== 'ground' ? this._scan() : null;
      if (e) { o.target = e; this.goal = null; this.swing = null; return IDLE_RESULT; }
      this.command(null);
      return IDLE_RESULT;
    }
    const throwing = this.isVillager && hunting && t.kind === 'deer';
    const ranged = this.def.range > 2 || throwing;
    if (this.isVillager) this.tools = TOOL_BIT.spear;
    const reachR = (throwing ? HUNT.throwRange : this.def.range > 2 ? this.def.range : 0.9 + (this.def.range || 0)) + this.def.radius;
    const [d, range] = this._reach(t, reachR);
    // stances / leash for targets picked up automatically
    if (o.auto) {
      if (this.stance === 'ground' && d > range && !this.swing) { this.command(null); return IDLE_RESULT; }
      if (o.home) {
        const leash = this.stance === 'defensive' ? 10 : this.def.los * 1.6;
        if (Math.hypot(this.x - o.home.x, this.z - o.home.z) > leash) { this.command({ type: 'move', x: o.home.x, z: o.home.z }); return IDLE_RESULT; }
      }
    }
    if (d > range && !this.swing) {
      this.spearGone = false;
      const p = t.isBuilding ? t.edgePoint(this) : t;
      return { moving: this._chase(p.x, p.z, dt, Math.max(0.5, range * 0.8), t.isUnit), workAnim: null };
    }
    this.goal = null; this.path = null; this.vx = this.vz = 0;
    this.face(t.x, t.z);
    const anim = throwing ? ANIM.THROW : ranged ? ANIM.SHOOT : (this.kind === 'spearman' || this.isVillager) ? ANIM.THRUST : ANIM.ATTACK;
    const period = 1 / (hunting && this.isVillager ? HUNT.rate : (this.def.rate || 0.5));
    if (!this.swing && this.cooldown <= 0) {
      this.swing = { t: 0, dur: period, impact: IMPACT[anim] ?? 0.5, hit: false };
      this.cooldown = period;
    }
    const sw = this.swing;
    if (sw) {
      sw.t += dt;
      const k = sw.t / sw.dur;
      if (!sw.hit && k >= sw.impact) { sw.hit = true; this._strike(t, ranged, throwing, reachR); }
      this.phase = Math.min(0.999, k);
      this.spearGone = throwing && sw.hit && k < 0.92;
      if (k >= 1) this.swing = null;
    } else {
      this.phase = 0;
      this.spearGone = false;
    }
    return { moving: false, workAnim: anim };
  }

  /** The moment a blow lands or a missile is released. */
  _strike(t, ranged, throwing, reachR) {
    const g = this.game;
    if (!t.alive) return;
    if (ranged) {
      const origin = { x: this.x + Math.sin(this.heading) * 0.3, y: this.y + (throwing ? 1.75 : 1.5), z: this.z + Math.cos(this.heading) * 0.3 };
      g.fireProjectile(this, t, origin, throwing ? { kind: 'spear', dmg: HUNT.throwDamage } : undefined);
      return;
    }
    // melee: lands only if the target is still within reach
    const [d, range] = this._reach(t, reachR);
    if (d > range + 0.7) { g.onWhiff?.(this, t); return; }
    const dmg = this.isVillager && t.isAnimal ? HUNT.stabDamage : damage(this, t);
    if (t.isUnit) t.takeDamage(dmg, this); else g.damageBuilding(t, dmg * (this.isVillager ? 1 : 0.8), this);
    g.onMeleeHit?.(this, t);
  }

  /** What to do after a resource runs out: the same kind nearby, the next animal of the herd... */
  _nextWork(o) {
    const g = this.game;
    const x = o.lastX ?? this.x, z = o.lastZ ?? this.z;
    const kind = o.kind;
    if (kind === 'carcass') {
      const c = g.findResource('carcass', x, z, 12, this);
      if (c) return { type: 'gather', target: c, kind: 'carcass', species: c.species };
      const a = g.findHuntable(this, x, z, 18, o.species);
      return a ? { type: 'attack', target: a, hunt: true } : null;
    }
    if (kind === 'farm') {
      const f = g.findResource('farm', x, z, 24, this);
      return f ? { type: 'gather', target: f, kind: 'farm' } : null;
    }
    if (!kind) return null;
    const n = g.findResource(kind, x, z, kind === 'tree' ? 16 : 20, this);
    return n ? { type: 'gather', target: n, kind } : null;
  }

  /** Farmers move around their field every few seconds. */
  _farmSpot(dt, o, f) {
    o.spotT = (o.spotT ?? 0) - dt;
    if (!o.farmSpot || (o.spotT <= 0 && o.working)) {
      const h = f.size / 2 - 1.2;
      o.farmSpot = { x: f.x + (Math.random() * 2 - 1) * h, z: f.z + (Math.random() * 2 - 1) * h };
      o.spotT = 4 + Math.random() * 4;
      o.working = false;
    }
    return { x: o.farmSpot.x, z: o.farmSpot.z, fx: o.farmSpot.x + Math.sin(this.heading), fz: o.farmSpot.z + Math.cos(this.heading) };
  }

  _gather(dt, o) {
    const g = this.game;
    const t = o.target;
    const isTree = t && t.type === 'tree';
    const alive = t && (isTree ? t.amount > 0 : t.isBuilding ? t.alive && t.food > 0 : t.alive !== false && t.amount > 0);
    if (!alive) {
      const next = this._nextWork(o);
      if (next) this.command(next);
      else if (this.carry.amount > 0) this.command({ type: 'dropoff', then: null });
      else this.command(null);
      return IDLE_RESULT;
    }
    const kind = isTree ? 'tree' : t.isBuilding ? 'farm' : t.type;
    o.kind = kind;
    o.lastX = t.x; o.lastZ = t.z;
    this.lastWork = { type: 'gather', target: t, kind, lastX: t.x, lastZ: t.z, species: o.species };
    const res = isTree ? 'wood' : t.isBuilding ? 'food' : t.res;
    if (this.carry.amount > 0 && this.carry.res !== res) this.carry = { res: null, amount: 0, kind: null };
    // tool for the job
    this.tools = kind === 'tree' ? TOOL_BIT.axe : (kind === 'gold' || kind === 'stone') ? TOOL_BIT.pick : (kind === 'berry' || kind === 'farm') ? TOOL_BIT.basket : 0;
    if (this.carry.amount >= CARRY) {
      this.command({ type: 'dropoff', then: { type: 'gather', target: t, kind, lastX: t.x, lastZ: t.z, species: o.species } });
      return IDLE_RESULT;
    }
    // a tree on its way down: keep clear and watch it fall
    if (isTree && t.state === 'falling') {
      this.goal = null; this.path = null; this.vx = this.vz = 0;
      this.face(t.x, t.z);
      this.phase = (this.phase + dt * 0.25) % 1;
      o.working = false;
      return IDLE_RESULT;
    }
    // where to stand and what to face
    let wp;
    if (isTree && t.state === 'fallen') {
      // nearest free slot along the log that nobody else is using (forests are crowded)
      const P = g.world.path;
      if (o.slot === undefined || o.slotTree !== t || (o.side || 0) !== (o.slotSide || 0)) {
        let bestK = 0, bd = Infinity;
        for (let k = 0; k < 6; k++) {
          const p = g.trees.logPoint(t, k);
          if (!P.isFreeAt(p.x, p.z)) continue;
          let d = Math.hypot(p.x - this.x, p.z - this.z);
          for (const u of g.unitsNear(p.x, p.z, 3)) if (u !== this && u.order?.target === t && u.order.slot === k) d += 6;
          if (k === o.slot && o.slotTree === t) d += 4 * (o.side || 0);   // blocked before: prefer another
          if (d < bd) { bd = d; bestK = k; }
        }
        o.slot = bestK; o.slotTree = t; o.slotSide = o.side || 0;
      }
      wp = g.trees.logPoint(t, o.slot);
    } else if (isTree) wp = g.trees.workPoint(t, this, o.side || 0);
    else if (t.isBuilding) wp = this._farmSpot(dt, o, t);
    else wp = t.workPoint(this, o.side || 0);
    const d = Math.hypot(wp.x - this.x, wp.z - this.z);
    const dFace = Math.hypot(wp.fx - this.x, wp.fz - this.z);
    const armReach = isTree ? (t.state === 'standing' ? 1.8 : 1.5) : t.radius + this.def.radius + 1.0;
    const working = o.working && (t.isBuilding ? d < 1.2 : dFace < armReach + 0.5);
    // good enough when the exact spot is crowded / blocked but the work is within reach
    const nearEnough = !t.isBuilding && o.blockedT > 0.5 && dFace < armReach + 0.6;
    if (!working && d > 0.7 && !nearEnough) {
      o.working = false;
      if (!this.goal || this.repathT <= 0) {
        const ok = this.goTo(wp.x, wp.z, 0.5);
        this.repathT = 2.5;
        if (!ok) o.side = (o.side || 0) + 1;
      }
      this.repathT -= dt;
      const moving = this._steer(dt);
      if (!this.path && !moving) {
        this.goal = null;
        o.blockedT = (o.blockedT || 0) + dt;
        if (o.blockedT > 2.5) { o.blockedT = 0; o.side = (o.side || 0) + 1; }
      } else o.blockedT = 0;
      if ((o.side || 0) > 5) {
        // unreachable from every side: give up on this node
        (this._skip ||= new Set()).add(t);
        const next = this._nextWork(o);
        this.command(next || (this.carry.amount > 0 ? { type: 'dropoff', then: null } : null));
        return IDLE_RESULT;
      }
      return { moving, workAnim: null };
    }
    o.working = true;
    o.blockedT = 0;
    this.goal = null; this.path = null;
    this.vx = this.vz = 0;
    this.face(wp.fx, wp.fz);
    // standing tree: a few blows bring it down (it shivers with each one)
    if (isTree && t.state === 'standing') {
      t.chopT = (t.chopT || 0) + dt;
      if (t.chopT >= FELL_TIME) g.trees.fell(t, this.x, this.z);
      this._workTick(dt, 1.1, CHOP_IMPACTS, 'chop', t);
      return { moving: false, workAnim: ANIM.CHOP };
    }
    if (kind === 'carcass') t.worked = g.time;
    const rate = GATHER_RATE[kind] || 0.3;
    o.acc = (o.acc || 0) + rate * dt;
    if (o.acc >= 1) {
      const n = Math.floor(o.acc);
      o.acc -= n;
      let got;
      if (isTree) got = g.trees.take(t, n);
      else if (t.isBuilding) { got = Math.min(n, t.food); t.food -= got; if (t.food <= 0) g.farmDepleted(t); }
      else got = t.take(n);
      this.carry.res = res;
      this.carry.kind = kind;
      this.carry.amount += got;
      g.onGatherTick?.(this, kind);
    }
    const anim = kind === 'tree' ? ANIM.CHOP : (kind === 'gold' || kind === 'stone') ? ANIM.MINE : ANIM.FORAGE;
    const strike = kind === 'tree' ? 'chop' : kind === 'gold' ? 'gold' : kind === 'stone' ? 'stone' : kind;
    if (anim === ANIM.FORAGE) this._workTick(dt, 1.6, FORAGE_IMPACTS, strike, t);
    else this._workTick(dt, 1.1, CHOP_IMPACTS, strike, t);
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
    const { res, amount } = this.carry;
    g.players[this.owner].res[res] += amount;
    g.players[this.owner].gathered[res] += amount;
    this.carry = { res: null, amount: 0, kind: null };
    g.onDeposit?.(this, b, res, amount);
    this.command(o.then || null);
    return { moving: false };
  }

  /** Walks to a spot on the building's perimeter; true once there. */
  _toSite(dt, b) {
    if (b.contains(this.x, this.z, this.def.radius + 1.3)) return true;
    if (!this.goal) {
      const a = (this.id * 2.4) % (Math.PI * 2);
      const half = b.size / 2 + 0.8;
      this.goTo(b.x + Math.cos(a) * half, b.z + Math.sin(a) * half, 1.2);
    }
    const moving = this._steer(dt);
    if (!this.path && !moving) this.goal = null;
    this._siteMoving = moving;
    return false;
  }

  _build(dt, o) {
    const g = this.game;
    const b = o.target;
    if (!b || !b.alive || b.built) {
      if (this.queue.length) { this.command(null); return IDLE_RESULT; }
      // continue with the work implied by the building
      if (b && b.alive && b.built) {
        if (b.kind === 'farm' && (!b.farmer || !b.farmer.alive || b.farmer === this)) { b.farmer = this; this.command({ type: 'gather', target: b, kind: 'farm' }); return IDLE_RESULT; }
        const auto = g.autoGatherFor(this, b);
        if (auto) { this.command(auto); return IDLE_RESULT; }
        const other = g.findFoundation(this.owner, this.x, this.z, 20);
        if (other) { this.command({ type: 'build', target: other }); return IDLE_RESULT; }
      }
      this.command(null);
      return IDLE_RESULT;
    }
    this.tools = TOOL_BIT.hammer;
    if (!this._toSite(dt, b)) return { moving: this._siteMoving, workAnim: null };
    this.goal = null; this.path = null; this.vx = this.vz = 0;
    this.face(b.x, b.z);
    b.addProgress(dt, Math.max(1, b.builders));
    b._buildersNext = (b._buildersNext || 0) + 1;
    this._workTick(dt, 0.9, BUILD_IMPACTS, 'hammer', b);
    g.onBuildTick?.(this, b);
    return { moving: false, workAnim: ANIM.BUILD };
  }

  /** Repairs cost a share of the building's price, paid as the hit points come back. */
  _repair(dt, o) {
    const g = this.game;
    const b = o.target;
    if (!b || !b.alive || !b.built || b.hp >= b.maxHp) {
      if (b && b.alive && b.hp >= b.maxHp) g.onRepaired?.(b, this);
      this.command(null);
      return IDLE_RESULT;
    }
    this.tools = TOOL_BIT.hammer;
    if (!this._toSite(dt, b)) return { moving: this._siteMoving, workAnim: null };
    this.goal = null; this.path = null; this.vx = this.vz = 0;
    this.face(b.x, b.z);
    b._buildersNext = (b._buildersNext || 0) + 1;
    const n = Math.max(1, b.builders);
    const share = n <= 1 ? 1 : 3 / (n + 2);
    const hp = Math.min(b.maxHp - b.hp, (dt * REPAIR.speed * share * b.maxHp) / b.def.time);
    const p = g.players[this.owner];
    const debt = (o.debt ||= {});
    for (const [k, v] of Object.entries(b.def.cost || {})) {
      debt[k] = (debt[k] || 0) + (v * REPAIR.cost * hp) / b.maxHp;
      const whole = Math.floor(debt[k]);
      if (whole <= 0) continue;
      if (p.res[k] < whole) { g.onRepairStalled?.(this, b, k); this.command(null); return IDLE_RESULT; }
      p.res[k] -= whole;
      debt[k] -= whole;
    }
    b.hp += hp;
    this._workTick(dt, 0.9, BUILD_IMPACTS, 'hammer', b);
    return { moving: false, workAnim: ANIM.BUILD };
  }

  _animal(dt) {
    const g = this.game;
    if (this.def.herdable) {
      this.herdT -= dt;
      if (this.herdT <= 0) { this.herdT = 0.5; g.herdCheck(this); }
    }
    // a hit deer bolts a good distance away, then calms down and grazes again
    if (this.fleeFrom) {
      this.state = 'flee';
      if (!this.fleeGoal) {
        const a = Math.atan2(this.z - this.fleeFrom.z, this.x - this.fleeFrom.x) + (Math.random() - 0.5) * 0.9;
        const r = 10 + Math.random() * 5;
        this.fleeGoal = {
          x: Math.max(4, Math.min(MAP_SIZE - 4, this.x + Math.cos(a) * r)),
          z: Math.max(4, Math.min(MAP_SIZE - 4, this.z + Math.sin(a) * r)),
        };
        this.goal = null;
        this.goTo(this.fleeGoal.x, this.fleeGoal.z, 1.2);
      }
      const moving = this._steer(dt);
      if (!this.path) {
        this.fleeFrom = null; this.fleeGoal = null;
        this.home = { x: this.x, z: this.z };
        this.thinkT = 3 + Math.random() * 3;
      }
      return moving;
    }
    this.state = 'wander';
    if (this.thinkT <= 0) {
      this.thinkT = 4 + Math.random() * 8;
      if (Math.random() < 0.4) {
        // owned sheep stay where they were left
        const roam = this.owner >= 0 ? 1.2 : 5;
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * roam;
        const home = this.home || (this.home = { x: this.x, z: this.z });
        this.goTo(home.x + Math.cos(a) * r, home.z + Math.sin(a) * r, 0.6);
      }
    }
    return this.path ? this._steer(dt * 0.6) : false;
  }
}

// ---------------------------------------------------------------------------
export class Projectile {
  constructor(game, from, target, origin, opts = {}) {
    this.kind = opts.kind || 'arrow';
    this.game = game;
    this.from = from;
    this.target = target;
    this.x = origin.x; this.y = origin.y; this.z = origin.z;
    const tx = target.x, tz = target.z;
    const ty = (target.y ?? game.world.heightAt(tx, tz)) + (target.isBuilding ? 2.5 : 1.1);
    const d = Math.hypot(tx - this.x, tz - this.z);
    const spear = this.kind === 'spear';
    this.flight = Math.max(spear ? 0.22 : 0.35, d / (spear ? 15 : 32));
    this.t = 0;
    this.sx = this.x; this.sy = this.y; this.sz = this.z;
    // lead moving targets a little
    this.ex = tx + (target.vx || 0) * this.flight * 0.8;
    this.ez = tz + (target.vz || 0) * this.flight * 0.8;
    this.ey = ty;
    this.arc = d * (spear ? 0.1 : 0.18);
    this.alive = true;
    this.owner = from.owner;
    this.dmg = opts.dmg ?? (from.isUnit ? damage(from, target) : Math.max(1, from.def.attack - (target.def?.pierceArmor || 0)));
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
        this.game.onProjectileHit?.(this, t);
      } else {
        this.game.stuckArrow?.(this.x, this.game.world.heightAt(this.x, this.z), this.z, this.dx, this.dz, this.kind);
      }
    }
  }
}

export { GRID };
