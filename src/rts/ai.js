// Computer opponent for "Reinos": a rule-based economy + army manager.
import { BUILDINGS, UNITS, AGES, MAP_SIZE } from './config.js';

const DIFF = {
  easy: { think: 2.0, vills: 18, firstAttack: 900, wave: 6, bonus: 0 },
  normal: { think: 1.0, vills: 30, firstAttack: 600, wave: 9, bonus: 0.1 },
  hard: { think: 0.6, vills: 42, firstAttack: 420, wave: 12, bonus: 0.25 },
};

export class AIPlayer {
  constructor(game, index, difficulty = 'normal') {
    this.game = game;
    this.index = index;
    this.cfg = DIFF[difficulty] || DIFF.normal;
    this.t = 0;
    this.waves = 0;
    this.attacking = false;
    this.lastBonus = 0;
  }

  get sim() { return this.game.sim; }
  get p() { return this.sim.players[this.index]; }

  mine(kind) { return this.sim.buildings.filter((b) => b.alive && b.owner === this.index && (!kind || b.kind === kind)); }

  findSpot(kind, near, minDist = 6, maxDist = 40) {
    const size = BUILDINGS[kind].size;
    for (let r = minDist; r < maxDist; r += 2) {
      const tries = Math.max(8, Math.round(r * 1.2));
      const off = Math.random() * Math.PI * 2;
      for (let k = 0; k < tries; k++) {
        const a = off + (k / tries) * Math.PI * 2;
        const x = Math.round(near.x + Math.cos(a) * r), z = Math.round(near.z + Math.sin(a) * r);
        if (!this.sim.canPlace(kind, x, z, this.index)) continue;
        // leave room around the town center and between buildings
        const tooClose = this.sim.buildings.some((b) => {
          if (!b.alive) return false;
          const gap = kind === 'farm' && b.kind === 'farm' ? 0.2 : 1.5;
          return Math.abs(b.x - x) < (b.size + size) / 2 + gap && Math.abs(b.z - z) < (b.size + size) / 2 + gap;
        });
        if (tooClose) continue;
        return { x, z };
      }
    }
    return null;
  }

  build(kind, near, builders, minDist, maxDist) {
    if (!this.p.canAfford(BUILDINGS[kind].cost)) return null;
    const spot = this.findSpot(kind, near, minDist, maxDist);
    if (!spot) return null;
    const b = this.sim.placeBuilding(kind, this.index, spot.x, spot.z);
    if (b) for (const u of builders) u.command({ type: 'build', target: b });
    return b;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = this.cfg.think;
    const sim = this.sim, p = this.p;
    if (p.defeated) return;
    // economic bonus (difficulty)
    if (this.cfg.bonus && sim.time - this.lastBonus > 10) {
      this.lastBonus = sim.time;
      for (const k of ['food', 'wood', 'gold']) p.res[k] += Math.round(p.gathered[k] * 0.0) + Math.round(8 * this.cfg.bonus * 10);
    }
    const units = sim.units.filter((u) => u.alive && u.owner === this.index);
    const vills = units.filter((u) => u.isVillager);
    const army = units.filter((u) => u.isMilitary);
    const tc = this.mine('town_center')[0];
    const home = tc || this.mine()[0] || vills[0];
    if (!home) return;

    // --- production ---------------------------------------------------------------
    // save up for the next age once the economy is big enough
    const nextAge = AGES[p.age + 1];
    const ageNeed = p.age === 0 ? 16 : 24;
    const saving = !!(nextAge && tc && tc.built && !tc.research && vills.length >= ageNeed);
    if (tc && tc.built && !tc.research && tc.queue.length < (saving ? 1 : 2) && vills.length < this.cfg.vills) {
      if (!saving) sim.train(tc, 'villager');
    }
    const houseInProgress = this.mine('house').some((b) => !b.built);
    if (p.popCap - p.pop <= 4 && p.popCap < 200 && !houseInProgress && vills.length) {
      this.build('house', home, [this._freeBuilder(vills)], 10, 34);
    }
    // drop sites
    const woodCutters = vills.filter((u) => u.order?.kind === 'tree').length;
    if (!this.mine('lumber_camp').length && vills.length >= 5 && p.res.wood >= 100) {
      const tree = sim.findResource('tree', home.x, home.z, 60, vills[0]);
      if (tree) this.build('lumber_camp', tree, [this._freeBuilder(vills)], 4, 16);
    } else if (woodCutters >= 6 && this.mine('lumber_camp').length < 2 && p.res.wood >= 150) {
      const tree = sim.findResource('tree', home.x + 20, home.z - 20, 70, vills[0]);
      if (tree) this.build('lumber_camp', tree, [this._freeBuilder(vills)], 4, 16);
    }
    const berries = sim.findResource('berry', home.x, home.z, 40, vills[0]);
    if (!this.mine('mill').length && berries && vills.length >= 7 && p.res.wood >= 100) this.build('mill', berries, [this._freeBuilder(vills)], 4, 12);
    if (!this.mine('mining_camp').length && vills.length >= 12 && p.res.wood >= 100) {
      const gold = sim.findResource('gold', home.x, home.z, 70, vills[0]);
      if (gold) this.build('mining_camp', gold, [this._freeBuilder(vills)], 5, 14);
    }
    // farms once natural food runs low
    const foodSources = sim.resources.filter((r) => r.alive && (r.type === 'berry' || r.type === 'carcass') && Math.hypot(r.x - home.x, r.z - home.z) < 50).length;
    const farms = this.mine('farm');
    const farmTarget = foodSources < 3 ? Math.min(16, Math.floor(vills.length * 0.45)) : p.res.wood > 260 ? Math.min(10, Math.floor(vills.length * 0.3)) : 0;
    if (farms.length < farmTarget && p.res.wood >= 60 && this.mine('mill').some((m) => m.built)) {
      const b0 = this._freeBuilder(vills);
      const f = this.build('farm', this.mine('mill').find((m) => m.built), [b0], 8, 24) || (tc && this.build('farm', tc, [b0], 12, 34));
      if (f) f.farmer = null;
    }
    // military infrastructure
    if (vills.length >= 10 && !this.mine('barracks').length) this.build('barracks', home, [this._freeBuilder(vills)], 16, 36);
    if (p.age >= 1 && !this.mine('archery_range').length && this.mine('barracks').some((b) => b.built)) this.build('archery_range', home, [this._freeBuilder(vills)], 16, 38);
    if (p.age >= 1 && vills.length >= 20 && !this.mine('stable').length && this.mine('barracks').some((b) => b.built)) this.build('stable', home, [this._freeBuilder(vills)], 16, 40);
    // age up
    if (saving && !tc.queue.length && p.canAfford(nextAge.cost)) sim.ageUp(tc);
    // spare wood: a watch tower near home, second barracks
    if (p.res.wood > 500 && p.res.stone >= 125 && this.mine('watch_tower').length < 2 && p.age >= 1) this.build('watch_tower', home, [this._freeBuilder(vills)], 12, 26);
    // train soldiers
    const military = this.mine().filter((b) => b.built && b.def.train && b.kind !== 'town_center');
    for (const b of military) {
      if (b.queue.length >= 2) continue;
      const opts = b.def.train.filter((k) => (UNITS[k].age || 0) <= p.age);
      const choice = opts[Math.floor(Math.random() * opts.length)];
      const c = UNITS[choice]?.cost;
      const reserve = saving ? nextAge.cost : {};
      const ok = c && Object.keys(c).every((k) => p.res[k] - c[k] >= (reserve[k] || 0));
      if (choice && vills.length >= 12 && ok) sim.train(b, choice);
    }
    for (const b of military) if (!b.rally && tc) b.rally = { x: tc.x + (b.x - tc.x) * 0.5, z: tc.z + (b.z - tc.z) * 0.5 };

    // --- villagers ---------------------------------------------------------------
    this._assign(vills, home);

    // --- army ------------------------------------------------------------------------
    // defend: enemies near our buildings
    let threat = null;
    for (const b of this.mine()) {
      const e = sim.findEnemy(b, 28);
      if (e && e.isUnit) { threat = e; break; }
    }
    if (threat) {
      for (const u of army) if (!u.order || u.order.auto || u.order.type === 'move') u.command({ type: 'attack', target: threat });
      return;
    }
    const waveSize = this.cfg.wave + this.waves * 3;
    if (!this.attacking && army.length >= waveSize && sim.time > this.cfg.firstAttack * 0.5) {
      this.attacking = true;
      this.waves++;
    }
    if (this.attacking) {
      if (army.length < 3) { this.attacking = false; return; }
      const enemyB = sim.buildings.filter((b) => b.alive && b.owner !== this.index);
      if (!enemyB.length) return;
      let target = null, bd = 1e9;
      const cx = army.reduce((a, u) => a + u.x, 0) / army.length, cz = army.reduce((a, u) => a + u.z, 0) / army.length;
      for (const b of enemyB) { const d = Math.hypot(b.x - cx, b.z - cz); if (d < bd) { bd = d; target = b; } }
      for (const u of army) if (!u.order || u.order.type === 'move' || (u.order.type === 'attack' && !u.order.target?.alive)) u.command({ type: 'attack', target });
    } else {
      // gather idle army near the town center
      for (const u of army) if (!u.order && tc && Math.hypot(u.x - tc.x, u.z - tc.z) > 30) u.moveTo(tc.x + (Math.random() - 0.5) * 14, tc.z + (Math.random() - 0.5) * 14);
    }
  }

  _freeBuilder(vills) {
    return vills.find((u) => !u.order) || vills.find((u) => u.order?.kind === 'tree') || vills[0];
  }

  _assign(vills, home) {
    const sim = this.sim;
    const count = { food: 0, wood: 0, gold: 0, stone: 0 };
    for (const u of vills) {
      const k = u.order?.kind;
      if (k === 'tree') count.wood++;
      else if (k === 'gold') count.gold++;
      else if (k === 'stone') count.stone++;
      else if (k === 'berry' || k === 'farm' || k === 'carcass' || u.order?.hunt) count.food++;
    }
    const n = vills.length;
    const want = this.p.age === 0
      ? { food: Math.ceil(n * 0.5), wood: Math.ceil(n * 0.4), gold: Math.floor(n * 0.1), stone: 0 }
      : { food: Math.ceil(n * 0.42), wood: Math.ceil(n * 0.3), gold: Math.ceil(n * 0.2), stone: Math.floor(n * 0.08) };
    for (const u of vills) {
      if (u.order) continue;
      let best = null, gap = -1e9;
      for (const k of ['food', 'wood', 'gold', 'stone']) { const g = want[k] - count[k]; if (g > gap) { gap = g; best = k; } }
      let order = null;
      if (best === 'food') {
        const farm = sim.buildings.find((b) => b.alive && b.owner === this.index && b.kind === 'farm' && b.built && (!b.farmer || !b.farmer.alive));
        const berry = sim.findResource('berry', home.x, home.z, 50, u);
        const carcass = sim.findResource('carcass', home.x, home.z, 50, u);
        const animal = sim.units.find((a) => a.alive && a.isAnimal && Math.hypot(a.x - home.x, a.z - home.z) < 45);
        if (carcass) order = { type: 'gather', target: carcass, kind: 'carcass' };
        else if (animal && (animal.kind === 'sheep' || !berry)) order = { type: 'attack', target: animal, hunt: true };
        else if (berry) order = { type: 'gather', target: berry, kind: 'berry' };
        else if (farm) { farm.farmer = u; order = { type: 'gather', target: farm, kind: 'farm' }; }
        else best = 'wood';
      }
      if (!order && best === 'wood') {
        const camp = this.mine('lumber_camp').find((b) => b.built) || home;
        const t = sim.findResource('tree', camp.x, camp.z, 80, u);
        if (t) order = { type: 'gather', target: t, kind: 'tree' };
      }
      if (!order && (best === 'gold' || best === 'stone')) {
        const camp = this.mine('mining_camp').find((b) => b.built) || home;
        const r = sim.findResource(best, camp.x, camp.z, 90, u) || sim.findResource(best === 'gold' ? 'stone' : 'gold', camp.x, camp.z, 90, u);
        if (r) order = { type: 'gather', target: r, kind: r.type };
      }
      if (!order) {
        const t = sim.findResource('tree', home.x, home.z, 90, u);
        if (t) order = { type: 'gather', target: t, kind: 'tree' };
      }
      if (order) {
        u.command(order);
        const res = order.kind === 'tree' ? 'wood' : order.kind === 'gold' ? 'gold' : order.kind === 'stone' ? 'stone' : 'food';
        count[res]++;
      }
    }
  }
}

export { MAP_SIZE };
