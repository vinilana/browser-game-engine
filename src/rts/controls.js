// Mouse / keyboard interaction for "Reinos": picking, context actions (cursor + hint show what a
// right-click will do), selection, orders with Shift queues, attack-move and building placement.
import { Raycaster, Vector2, Vector3, Box3 } from 'three';
import { BUILDINGS, RESOURCES } from './config.js';
import { CURSOR, INTENT_COLOR } from './cursors.js';

const _v = new Vector3();
const _w = new Vector3();
const _hit = new Vector3();
const _box = new Box3();
const _ndc = new Vector2();

/** Visual height of a unit (feet to head) for screen-space picking. */
function unitHeight(u) {
  if (u.def.classes?.includes('cavalry')) return 2.7;
  if (u.kind === 'sheep') return 0.95;
  if (u.kind === 'deer') return 1.7;
  return 1.8;
}

function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
}

/** Convex hull (monotone chain) of 2D points. */
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function inConvex(poly, x, y) {
  if (poly.length < 3) return false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}

const GATHER_INTENT = {
  gold: ['mine', 'Minerar ouro'],
  stone: ['mine', 'Extrair pedra'],
  berry: ['forage', 'Colher frutas'],
  carcass: ['butcher', 'Esquartejar a caça'],
};

export class Controls {
  constructor(game) {
    this.game = game;
    this.selection = [];
    this.groups = {};
    this.drag = null;
    this.placing = null;
    this.targeting = null;      // pending command that needs a click on the map (attack-move)
    this.hover = null;
    this.intent = null;
    this.overWorld = false;
    this.mx = 0; this.my = 0;
    this.lastClick = { t: 0, id: -1 };
    this.ray = new Raycaster();
    const el = game.engine.canvas;
    this.el = el;
    this._cursor = '';
    el.addEventListener('mousedown', (e) => this._down(e));
    window.addEventListener('mousemove', (e) => this._move(e));
    window.addEventListener('mouseup', (e) => this._up(e));
    window.addEventListener('keydown', (e) => this._key(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mouseleave', () => { this.overWorld = false; });
    this._setCursor(CURSOR.default);
  }

  get sim() { return this.game.sim; }

  // ------------------------------------------------------------------ picking
  groundAtNDC(nx, ny) {
    this.ray.setFromCamera(new Vector2(nx, ny), this.game.engine.camera);
    const r = this.ray.ray;
    return this.game.world.hf.raycast(r.origin, r.direction, 4000);
  }

  groundAt(clientX, clientY) {
    return this.groundAtNDC((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  }

  screenOf(x, y, z) {
    _v.set(x, y, z).project(this.game.engine.camera);
    if (_v.z > 1) return null;
    return [(_v.x * 0.5 + 0.5) * innerWidth, (-_v.y * 0.5 + 0.5) * innerHeight];
  }

  /**
   * Entity under the cursor. Every candidate is tested against its projected shape (capsules for
   * units and trees, the box hull for buildings, spheres for piles, the log for felled trees) and the
   * best normalised hit wins, with units favoured over what stands behind them.
   */
  pick(cx, cy) {
    const sim = this.sim, g = this.game;
    const cam = g.engine.camera;
    const pxPerM = innerHeight / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const camPos = cam.position;
    const cands = [];   // [entity, score (lower = better), depth from the camera]
    const radiusPx = (x, y, z, r) => Math.max(6, (r * pxPerM) / Math.max(1, camPos.distanceTo(_w.set(x, y, z))));
    const depth = (x, y, z) => camPos.distanceTo(_w.set(x, y, z));

    for (const u of sim.units) {
      if (!u.alive) continue;
      if (u.owner !== 0 && !sim.isVisibleTo(0, u.x, u.z)) continue;
      const h = unitHeight(u);
      const a = this.screenOf(u.x, u.y + 0.15, u.z);
      const b = a && this.screenOf(u.x, u.y + h, u.z);
      if (!b) continue;
      const rpx = radiusPx(u.x, u.y + h / 2, u.z, u.def.radius + 0.22);
      const d = segDist(cx, cy, a, b);
      if (d < rpx * 1.25) cands.push([u, d / rpx - 0.4, depth(u.x, u.y + h / 2, u.z)]);
    }
    for (const c of sim.corpses) {
      if (!c.carcass || !c.carcass.alive || !sim.isExploredBy(0, c.x, c.z)) continue;
      const s = this.screenOf(c.x, c.y + 0.3, c.z);
      if (!s) continue;
      const rpx = radiusPx(c.x, c.y, c.z, 1.0);
      const d = Math.hypot(s[0] - cx, s[1] - cy);
      if (d < rpx) cands.push([c.carcass, d / rpx - 0.1, depth(c.x, c.y + 0.3, c.z)]);
    }
    // buildings: exact ray / box test, so a close camera behind a roof still picks the roof
    _ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    this.ray.setFromCamera(_ndc, cam);
    const ray = this.ray.ray;
    let wall = Infinity;
    for (const b of sim.buildings) {
      if (b.owner !== 0 && !sim.isExploredBy(0, b.x, b.z)) continue;
      const view = g.renderer.buildingViews.get(b);
      const full = view?.height || 5;
      const h = b.def.passable ? 0.5 : (b.built ? full : Math.max(1.2, full * b.progress));
      const hs = b.size / 2 + 0.3;
      _box.min.set(b.x - hs, b.y - 0.2, b.z - hs);
      _box.max.set(b.x + hs, b.y + h, b.z + hs);
      if (!ray.intersectBox(_box, _hit)) continue;
      const boxD = _hit.distanceTo(ray.origin);
      // the actual walls / roof decide what is hidden; the box alone is a looser, weaker hit
      const hit = b.built && view && !b.def.passable ? this.ray.intersectObjects(view.meshes, false)[0] : null;
      if (hit) {
        cands.push([b, 0.3 + hit.distance * 0.0004, hit.distance]);
        wall = Math.min(wall, hit.distance);
      } else cands.push([b, b.def.passable || !b.built ? 0.35 + boxD * 0.0004 : 0.75, boxD]);
    }
    for (const r of sim.resources) {
      if (!r.alive || r.type === 'carcass' || !sim.isExploredBy(0, r.x, r.z)) continue;
      const scale = g.renderer.resourceViews.get(r)?.scale.x || 1;
      const hc = r.type === 'berry' ? 0.6 : 0.9 * scale;
      const rad = r.type === 'berry' ? 1.15 : (r.radius + 0.3) * scale;
      const s = this.screenOf(r.x, r.y + hc, r.z);
      if (!s) continue;
      const rpx = radiusPx(r.x, r.y + hc, r.z, rad);
      const d = Math.hypot(s[0] - cx, s[1] - cy);
      if (d < rpx) cands.push([r, d / rpx, depth(r.x, r.y + hc, r.z) - rad]);
    }
    // trees near the ground point under the cursor (canopies reach a few metres out)
    const gp = this.groundAt(cx, cy);
    if (gp) {
      for (const t of g.trees.trees) {
        if (t.amount <= 0 || Math.abs(t.x - gp.x) > 40 || Math.abs(t.z - gp.z) > 40) continue;
        if (!sim.isExploredBy(0, t.x, t.z)) continue;
        if (t.state === 'standing') {
          const h = t.height || 8;
          const a = this.screenOf(t.x, t.y + 0.4, t.z);
          const b = a && this.screenOf(t.x, t.y + h * 0.8, t.z);
          if (!b) continue;
          const rpx = radiusPx(t.x, t.y + h * 0.5, t.z, 1.35 * t.scale);
          const d = segDist(cx, cy, a, b);
          if (d < rpx) cands.push([t, d / rpx + 0.12, depth(t.x, t.y + h * 0.5, t.z) - 1.5 * t.scale]);
        } else if (t.fallDir !== undefined) {
          const [x0, z0, x1, z1] = g.trees.logSegment(t);
          const a = this.screenOf(x0, t.y + 0.4, z0);
          const b = a && this.screenOf(x1, g.world.heightAt(x1, z1) + 0.4, z1);
          if (!b) continue;
          const rpx = radiusPx((x0 + x1) / 2, t.y, (z0 + z1) / 2, 0.8);
          const d = segDist(cx, cy, a, b);
          if (d < rpx) cands.push([t, d / rpx + 0.05, depth((x0 + x1) / 2, t.y, (z0 + z1) / 2)]);
        }
      }
    }
    // anything standing well behind a wall under the cursor is hidden by it
    let best = null, bs = Infinity;
    for (const [e, score, dd] of cands) {
      if (!e.isBuilding && dd > wall + 1.2) continue;
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  }

  // ------------------------------------------------------------------ what a right-click means
  _selParts() {
    const mine = this.selection.filter((e) => e.owner === 0 && e.alive !== false);
    const units = mine.filter((e) => e.isUnit);
    return {
      units,
      vills: units.filter((u) => u.isVillager),
      soldiers: units.filter((u) => u.isMilitary),
      herd: units.filter((u) => u.isAnimal),
      trainers: mine.filter((e) => e.isBuilding && e.built && e.def.train),
    };
  }

  /** The action a right-click on `t` (or the ground) performs with the current selection. */
  intentFor(t) {
    const { units, vills, soldiers, trainers } = this._selParts();
    if (!units.length) {
      if (!trainers.length) return null;
      if (t && (t.type === 'tree' || (t.isResource && t.alive))) return { kind: 'rally', target: t, text: 'Ponto de encontro: coletar aqui' };
      return { kind: 'rally', target: null, text: 'Definir ponto de encontro' };
    }
    if (t) {
      const hostile = t.owner >= 0 && t.owner !== 0 && !t.isAnimal && t.alive !== false;
      if (hostile && (vills.length || soldiers.length)) return { kind: 'attack', target: t, text: t.isBuilding ? 'Atacar construção' : 'Atacar' };
      if (t.isUnit && t.isAnimal && t.alive) {
        if (vills.length) return { kind: 'hunt', target: t, text: t.kind === 'deer' ? 'Caçar (arremessar lança)' : 'Abater para comida' };
        if (soldiers.length && t.kind === 'deer') return { kind: 'attack', target: t, text: 'Abater' };
        return { kind: 'move', target: null, text: t.owner === 0 ? 'Mover' : 'Mover (reunir o rebanho)' };
      }
      if (vills.length) {
        if (t.type === 'tree' && t.amount > 0) return { kind: 'chop', target: t, text: t.state === 'standing' ? 'Derrubar e cortar' : 'Cortar madeira' };
        if (t.isResource && t.alive && GATHER_INTENT[t.type]) {
          const [kind, text] = GATHER_INTENT[t.type];
          return { kind, target: t, text };
        }
        if (t.isBuilding && t.owner === 0 && t.alive) {
          if (!t.built) return { kind: 'build', target: t, text: t.progress > 0.01 ? 'Continuar a construção' : 'Construir' };
          if (t.kind === 'farm') {
            const f = t.farmer;
            const busy = f && f.alive && f.order?.target === t && !vills.includes(f);
            return busy ? { kind: 'blocked', target: t, text: 'Fazenda ocupada' } : { kind: 'farm', target: t, text: 'Cultivar' };
          }
          if (vills.some((u) => u.carry.amount > 0 && t.accepts(u.carry.res))) return { kind: 'dropoff', target: t, text: 'Depositar recursos' };
          if (t.hp < t.maxHp) return { kind: 'repair', target: t, text: 'Reparar' };
        }
      }
    }
    return { kind: 'move', target: null, text: 'Mover' };
  }

  // ------------------------------------------------------------------ selection
  setSelection(list) {
    for (const e of this.selection) e.selected = false;
    this.selection = list.filter(Boolean);
    for (const e of this.selection) e.selected = true;
    this.targeting = null;
    if (this.selection.length) this.game.audio?.select(this.selection[0]);
  }

  selectIdleVillager() {
    const idle = this.sim.units.filter((u) => u.alive && u.owner === 0 && u.isVillager && !u.order);
    if (!idle.length) return;
    this._idleIdx = ((this._idleIdx || 0) + 1) % idle.length;
    const u = idle[this._idleIdx];
    this.setSelection([u]);
    this.game.cam.lookAt(u.x, u.z);
  }

  // ------------------------------------------------------------------ placement
  startPlacement(kind) {
    const p = this.sim.players[0];
    if (!p.canAfford(BUILDINGS[kind].cost)) { this.game.hud.notice('Recursos insuficientes'); this.game.audio?.error(); return; }
    this.cancelPlacement();
    this.targeting = null;
    const ghost = this.game.renderer.makeGhost(kind);
    this.game.engine.pipeline.forwardScene.add(ghost);
    this.placing = { kind, ghost, ok: false, x: 0, z: 0, chain: 0 };
  }

  cancelPlacement() {
    if (!this.placing) return;
    this.game.engine.pipeline.forwardScene.remove(this.placing.ghost);
    this.placing = null;
  }

  _updatePlacement() {
    const pl = this.placing;
    if (!pl) return;
    const gp = this.groundAt(this.mx, this.my);
    if (!gp) return;
    const size = BUILDINGS[pl.kind].size;
    const snap = (v) => (size % 4 === 0 || size % 2 === 1 ? Math.round(v) : Math.round(v / 2) * 2);
    pl.x = snap(gp.x); pl.z = snap(gp.z);
    pl.ok = this.sim.canPlace(pl.kind, pl.x, pl.z, 0);
    pl.ghost.position.set(pl.x, this.game.world.heightAt(pl.x, pl.z) + 0.05, pl.z);
    pl.ghost.userData.mat.color.set(pl.ok ? 0x55ff77 : 0xff5040);
  }

  _place(shift) {
    const pl = this.placing;
    if (!pl.ok) { this.game.hud.notice('Não é possível construir aqui'); this.game.audio?.error(); return; }
    const b = this.sim.placeBuilding(pl.kind, 0, pl.x, pl.z);
    if (!b) { this.game.hud.notice('Recursos insuficientes'); this.game.audio?.error(); this.cancelPlacement(); return; }
    this.game.audio?.place();
    const builders = this.selection.filter((u) => u.isUnit && u.isVillager && u.alive && u.owner === 0);
    // Shift keeps placing: the builders put up the foundations one after another
    for (const u of builders) u.issue({ type: 'build', target: b }, pl.chain > 0);
    pl.chain++;
    if (builders.length) this.game.hud.flash(b, INTENT_COLOR.build);
    if (!shift || !this.sim.players[0].canAfford(BUILDINGS[pl.kind].cost)) this.cancelPlacement();
  }

  // ------------------------------------------------------------------ commands
  /** Right-click order at a world point / on a target entity (Shift queues it). */
  commandAt(x, z, target, queued = false) {
    const g = this.game, hud = g.hud;
    const intent = this.intentFor(target);
    if (!intent) return;
    const { units, vills, soldiers, herd, trainers } = this._selParts();
    const t = intent.target;
    const color = INTENT_COLOR[intent.kind] || INTENT_COLOR.move;
    const give = (list, order) => { for (const u of list) u.issue(typeof order === 'function' ? order(u) : order, queued); };
    const rest = (list) => units.filter((u) => !list.includes(u));
    switch (intent.kind) {
      case 'rally': {
        for (const b of trainers) b.rally = { x: t ? t.x : x, z: t ? t.z : z, target: t };
        hud.marker(t ? t.x : x, t ? t.z : z, color, 'rally');
        if (t) hud.flash(t, color);
        g.audio?.ack(null, 'rally');
        return;
      }
      case 'attack': {
        const fighters = [...vills, ...soldiers];
        give(fighters, { type: 'attack', target: t });
        this._formationMove(rest(fighters), t.x, t.z, queued);
        hud.flash(t, color);
        break;
      }
      case 'hunt': {
        give(vills, { type: 'attack', target: t, hunt: true });
        this._formationMove(rest(vills), t.x, t.z, queued);
        hud.flash(t, color);
        break;
      }
      case 'chop': case 'mine': case 'forage': case 'butcher': {
        give(vills, { type: 'gather', target: t, kind: t.type, species: t.species });
        this._formationMove(rest(vills), x, z, queued);
        hud.flash(t, color);
        break;
      }
      case 'build': {
        give(vills, { type: 'build', target: t });
        this._formationMove(rest(vills), x, z, queued);
        hud.flash(t, color);
        break;
      }
      case 'repair': {
        give(vills, { type: 'repair', target: t });
        this._formationMove(rest(vills), x, z, queued);
        hud.flash(t, color);
        break;
      }
      case 'farm': case 'blocked': {
        // one farmer per field: the others look for free fields nearby
        let first = true;
        let placed = 0;
        for (const u of vills) {
          let f = null;
          if (first && intent.kind === 'farm') { f = t; first = false; } else f = this.sim.findResource('farm', t.x, t.z, 26, u);
          if (f) { f.farmer = u; u.issue({ type: 'gather', target: f, kind: 'farm' }, queued); placed++; hud.flash(f, INTENT_COLOR.farm); }
          else u.issue({ type: 'move', x: t.x, z: t.z + t.size * 0.5 + 1 }, queued);
        }
        this._formationMove(rest(vills), x, z, queued);
        if (!placed) { hud.notice('Não há fazendas livres por perto'); g.audio?.error(); return; }
        break;
      }
      case 'dropoff': {
        for (const u of vills) {
          if (u.carry.amount > 0 && t.accepts(u.carry.res)) u.issue({ type: 'dropoff', target: t, then: u.lastWork }, queued);
          else u.issue({ type: 'move', x: t.x, z: t.z + t.size * 0.5 + 1.5 }, queued);
        }
        this._formationMove(rest(vills), x, z, queued);
        hud.flash(t, color);
        break;
      }
      default:
        this._formationMove([...units, ...herd.filter((h) => !units.includes(h))], x, z, queued);
        hud.marker(x, z, color, 'move');
    }
    g.audio?.ack(units[0], intent.kind);
  }

  /** Attack-move: soldiers walk to the point and fight whatever they meet. */
  attackMoveAt(x, z, queued = false) {
    const { units } = this._selParts();
    const soldiers = units.filter((u) => u.isMilitary);
    if (!soldiers.length) return;
    this._formationMove(soldiers, x, z, queued, { attackMove: true });
    this.game.hud.marker(x, z, INTENT_COLOR.attackMove, 'attackMove');
    this.game.audio?.ack(soldiers[0], 'attack');
  }

  _formationMove(units, x, z, queued = false, extra = null) {
    if (!units.length) return;
    const cx = units.reduce((a, u) => a + u.x, 0) / units.length;
    const cz = units.reduce((a, u) => a + u.z, 0) / units.length;
    const ang = Math.atan2(x - cx, z - cz);
    const cols = Math.ceil(Math.sqrt(units.length * 1.6));
    const spacing = Math.max(...units.map((u) => u.def.radius)) * 2 + 0.6;
    const fx = Math.cos(ang), fz = -Math.sin(ang);   // right vector
    const bx = -Math.sin(ang), bz = -Math.cos(ang);  // backward
    // sort by distance so units don't cross
    const sorted = [...units].sort((a, b) => ((a.x - x) ** 2 + (a.z - z) ** 2) - ((b.x - x) ** 2 + (b.z - z) ** 2));
    sorted.forEach((u, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const off = (c - (cols - 1) / 2) * spacing;
      const tx = x + fx * off + bx * r * spacing, tz = z + fz * off + bz * r * spacing;
      u.issue({ type: 'move', x: tx, z: tz, arrive: 0.6, ...extra }, queued);
    });
  }

  startTargeting(kind) {
    this.cancelPlacement();
    this.targeting = { kind };
  }

  // ------------------------------------------------------------------ events
  _down(e) {
    if (this.game.paused) return;
    if (e.button === 0) {
      if (this.placing) { this._place(e.shiftKey); return; }
      if (this.targeting) {
        const gp = this.groundAt(e.clientX, e.clientY);
        if (gp && this.targeting.kind === 'attackMove') this.attackMoveAt(gp.x, gp.z, e.shiftKey);
        if (!e.shiftKey) this.targeting = null;
        return;
      }
      this.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, active: false, shift: e.shiftKey, ctrl: e.ctrlKey };
    } else if (e.button === 2) {
      if (this.placing) { this.cancelPlacement(); return; }
      if (this.targeting) { this.targeting = null; return; }
      const target = this.pick(e.clientX, e.clientY);
      const gp = this.groundAt(e.clientX, e.clientY);
      if (!gp && !target) return;
      this.commandAt(gp ? gp.x : target.x, gp ? gp.z : target.z, target, e.shiftKey);
    }
  }

  _move(e) {
    this.mx = e.clientX; this.my = e.clientY;
    this.overWorld = e.target === this.el;
    if (this.drag) {
      this.drag.x1 = e.clientX; this.drag.y1 = e.clientY;
      if (Math.hypot(this.drag.x1 - this.drag.x0, this.drag.y1 - this.drag.y0) > 6) this.drag.active = true;
    }
  }

  _onScreen(u) {
    const s = this.screenOf(u.x, u.y + 1, u.z);
    return s && s[0] > 0 && s[1] > 40 && s[0] < innerWidth && s[1] < innerHeight - 196;
  }

  _up(e) {
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (this.game.paused) return;
    if (d.active) {
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      let inside = this.sim.units.filter((u) => {
        if (!u.alive || u.owner !== 0) return false;
        const s = this.screenOf(u.x, u.y + 1, u.z);
        return s && s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1;
      });
      // sheep only when nothing else is in the box; soldiers win over villagers in big mixed boxes
      const people = inside.filter((u) => !u.isAnimal);
      if (people.length) inside = people;
      const mil = inside.filter((u) => u.isMilitary);
      const pickList = mil.length && mil.length < inside.length && inside.length > 6 ? mil : inside;
      this.setSelection(d.shift ? [...new Set([...this.selection, ...pickList])] : pickList);
      return;
    }
    const e0 = this.pick(e.clientX, e.clientY);
    const now = performance.now();
    const own = e0 && e0.isUnit && e0.owner === 0;
    if (own && (d.ctrl || (this.lastClick.id === e0.id && now - this.lastClick.t < 350))) {
      // double click / ctrl+click: every unit of that type on screen
      this.setSelection(this.sim.units.filter((u) => u.alive && u.owner === 0 && u.kind === e0.kind && this._onScreen(u)));
    } else if (e0) {
      if (d.shift && own) {
        const s = new Set(this.selection.filter((x) => x.owner === 0));
        if (s.has(e0)) s.delete(e0); else s.add(e0);
        this.setSelection([...s]);
      } else this.setSelection([e0]);
    } else if (!d.shift) this.setSelection([]);
    this.lastClick = { t: now, id: e0 ? e0.id : -1 };
  }

  _key(e) {
    const g = this.game;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.code === 'Escape' || e.code === 'F10') {
      if (this.placing) { this.cancelPlacement(); return; }
      if (this.targeting) { this.targeting = null; return; }
      if (e.code === 'F10' || !this.selection.length) { g.pause(!g.paused); return; }
      this.setSelection([]);
      return;
    }
    if (g.paused) return;
    const digit = e.code.startsWith('Digit') ? +e.code.slice(5) : -1;
    if (digit >= 0) {
      if (e.ctrlKey) { this.groups[digit] = [...this.selection]; e.preventDefault(); g.hud.notice(`Grupo ${digit} definido`); return; }
      const grp = (this.groups[digit] || []).filter((u) => u.alive && u.owner === 0);
      if (grp.length) {
        const now = performance.now();
        if (this._lastGroup === digit && now - this._lastGroupT < 400) g.cam.lookAt(grp[0].x, grp[0].z);
        this._lastGroup = digit; this._lastGroupT = now;
        this.setSelection(grp);
      }
      return;
    }
    if (e.code === 'Period') { this.selectIdleVillager(); return; }
    if (e.code === 'KeyH') {
      const tc = this.sim.buildings.find((b) => b.owner === 0 && b.kind === 'town_center');
      if (tc) { this.setSelection([tc]); g.cam.lookAt(tc.x, tc.z); }
      return;
    }
    if (e.code === 'Delete') { g.deleteSelection(); return; }
    if (e.code === 'Space' && this.selection.length) { const s = this.selection[0]; g.cam.lookAt(s.x, s.z); e.preventDefault(); return; }
    // command grid hotkeys (the camera uses WASD only when nothing claims the key)
    if (this.selection.length && this.selection[0].owner === 0 && !e.ctrlKey) {
      if (g.hud.hotkey(e.code)) { e.preventDefault(); e.stopPropagation(); this._swallow = e.code; }
    }
  }

  _setCursor(c) {
    if (c === this._cursor) return;
    this._cursor = c;
    this.el.style.cursor = c;
  }

  /** Hovered entity, the action a right-click would take, cursor and hint. */
  _updateHover() {
    const g = this.game;
    if (!this.overWorld || g.paused || (this.drag && this.drag.active) || this.placing) {
      this.hover = null;
      this.intent = null;
      this._setCursor(this.placing ? CURSOR.build : CURSOR.default);
      g.hud.hoverTip(null);
      return;
    }
    this.hover = this.pick(this.mx, this.my);
    this.intent = this.targeting ? { kind: 'attackMove', target: null, text: 'Ataque em movimento: clique no destino' } : this.intentFor(this.hover);
    this._setCursor(CURSOR[this.intent?.kind] || CURSOR.default);
    g.hud.hoverTip(this.hover, this.intent, this.mx, this.my);
  }

  update() {
    // prune dead, depleted or lost (stolen sheep) entities from the selection
    const sel = this.selection;
    if (sel.some((e) => e.alive === false || (e.type === 'tree' && e.amount <= 0) || (e.isAnimal && e.owner !== 0 && sel.length > 1))) {
      this.selection = sel.filter((e) => e.alive !== false && !(e.type === 'tree' && e.amount <= 0) && !(e.isAnimal && e.owner !== 0 && sel.length > 1));
    }
    this._updatePlacement();
    this._updateHover();
  }
}

export { RESOURCES };
