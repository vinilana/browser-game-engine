// Mouse / keyboard interaction for "Reinos": selection, orders, building placement.
import { Raycaster, Vector2, Vector3 } from 'three';
import { BUILDINGS } from './config.js';

const _v = new Vector3();

export class Controls {
  constructor(game) {
    this.game = game;
    this.selection = [];
    this.groups = {};
    this.drag = null;
    this.placing = null;
    this.lastClick = { t: 0, id: -1 };
    this.ray = new Raycaster();
    const el = game.engine.canvas;
    this.el = el;
    el.addEventListener('mousedown', (e) => this._down(e));
    window.addEventListener('mousemove', (e) => this._move(e));
    window.addEventListener('mouseup', (e) => this._up(e));
    window.addEventListener('keydown', (e) => this._key(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
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

  /** Entity under the cursor: units > buildings > resources > trees. */
  pick(cx, cy) {
    const sim = this.sim;
    let best = null, bd = 22;
    for (const u of sim.units) {
      if (!u.alive) continue;
      if (u.owner !== 0 && !sim.isVisibleTo(0, u.x, u.z)) continue;
      const h = u.def.classes?.includes('cavalry') ? 1.6 : u.isAnimal ? 0.7 : 1.0;
      const s = this.screenOf(u.x, u.y + h, u.z);
      if (!s) continue;
      const d = Math.hypot(s[0] - cx, s[1] - cy);
      if (d < bd) { bd = d; best = u; }
    }
    if (best) return best;
    const gp = this.groundAt(cx, cy);
    if (!gp) return null;
    for (const b of sim.buildings) {
      if (b.owner !== 0 && !sim.isExploredBy(0, b.x, b.z)) continue;
      if (b.contains(gp.x, gp.z, 0.6)) return b;
    }
    // buildings are tall: also test their projected body
    for (const b of sim.buildings) {
      if (b.owner !== 0 && !sim.isExploredBy(0, b.x, b.z)) continue;
      const s = this.screenOf(b.x, b.y + b.size * 0.35, b.z);
      if (s && Math.hypot(s[0] - cx, s[1] - cy) < b.size * 3.2) return b;
    }
    for (const r of sim.resources) {
      if (!r.alive || r.type === 'carcass') continue;
      if (Math.hypot(r.x - gp.x, r.z - gp.z) < r.radius + 0.8) return r;
    }
    for (const c of sim.corpses) {
      if (c.carcass && c.carcass.alive && Math.hypot(c.x - gp.x, c.z - gp.z) < 1.5) return c.carcass;
    }
    let tree = null, td = 2.2;
    for (const t of this.game.trees.trees) {
      if (t.amount <= 0) continue;
      const d = Math.hypot(t.x - gp.x, t.z - gp.z);
      if (d < td) { td = d; tree = t; }
    }
    if (tree) return tree;
    // clicks on the canopy land on the ground behind the tree: test the projected trunk/crown
    const cam = this.game.engine.camera;
    const pxPerM = innerHeight / (2 * Math.tan((cam.fov * Math.PI) / 360));
    let sd = 1e9;
    for (const t of this.game.trees.trees) {
      if (t.amount <= 0 || t.state !== 'standing') continue;
      if (Math.abs(t.x - gp.x) > 40 || Math.abs(t.z - gp.z) > 40) continue;
      const h = t.height || 8;
      const dist = cam.position.distanceTo(_v.set(t.x, t.y + h * 0.6, t.z));
      const rPx = (1.8 * t.scale * pxPerM) / dist;
      for (const f of [0.25, 0.6, 0.85]) {
        const sc = this.screenOf(t.x, t.y + h * f, t.z);
        if (!sc) continue;
        const d = Math.hypot(sc[0] - cx, sc[1] - cy);
        if (d < rPx && d / rPx + dist * 0.001 < sd) { sd = d / rPx + dist * 0.001; tree = t; }
      }
    }
    return tree;
  }

  // ------------------------------------------------------------------ selection
  setSelection(list) {
    for (const e of this.selection) e.selected = false;
    this.selection = list.filter(Boolean);
    for (const e of this.selection) e.selected = true;
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
    const ghost = this.game.renderer.makeGhost(kind);
    this.game.engine.pipeline.forwardScene.add(ghost);
    this.placing = { kind, ghost, ok: false, x: 0, z: 0 };
  }

  cancelPlacement() {
    if (!this.placing) return;
    this.game.engine.pipeline.forwardScene.remove(this.placing.ghost);
    this.placing = null;
  }

  _updatePlacement() {
    const pl = this.placing;
    if (!pl) return;
    const inp = this.game.engine.input;
    const gp = this.groundAt(inp.mouseX, inp.mouseY);
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
    const builders = this.selection.filter((u) => u.isUnit && u.isVillager && u.alive);
    for (const u of builders) u.command({ type: 'build', target: b });
    if (!shift || !this.sim.players[0].canAfford(BUILDINGS[pl.kind].cost)) this.cancelPlacement();
  }

  // ------------------------------------------------------------------ commands
  /** Right-click order at a world point / on a target entity. */
  commandAt(x, z, target) {
    const sim = this.sim;
    const units = this.selection.filter((e) => e.isUnit && e.alive && e.owner === 0);
    const buildings = this.selection.filter((e) => e.isBuilding && e.owner === 0);
    if (!units.length) {
      for (const b of buildings) b.rally = { x, z, target: target && (target.isResource || target.type === 'tree') ? target : null };
      if (buildings.length) this.game.hud.marker(x, z, '#ffd66a');
      return;
    }
    let ack = 'move';
    if (target && target.isUnit && target.alive && target.owner !== 0 && !target.isAnimal) {
      for (const u of units) u.command({ type: 'attack', target });
      ack = 'attack';
      this.game.hud.marker(target.x, target.z, '#ff5a4a');
    } else if (target && target.isBuilding && target.owner === 1) {
      for (const u of units) u.command({ type: 'attack', target });
      ack = 'attack';
      this.game.hud.marker(target.x, target.z, '#ff5a4a');
    } else {
      const vills = units.filter((u) => u.isVillager);
      const others = units.filter((u) => !u.isVillager);
      let villHandled = false;
      if (target && vills.length) {
        villHandled = true;
        if (target.isUnit && target.isAnimal && target.alive) {
          for (const u of vills) u.command({ type: 'attack', target, hunt: true });
          ack = 'gather';
        } else if (target.type === 'tree' || (target.isResource && target.alive)) {
          for (const u of vills) u.command({ type: 'gather', target, kind: target.type });
          ack = 'gather';
        } else if (target.isBuilding && target.owner === 0 && !target.built) {
          for (const u of vills) u.command({ type: 'build', target });
          ack = 'build';
        } else if (target.isBuilding && target.owner === 0 && target.kind === 'farm') {
          target.farmer = vills[0];
          vills[0].command({ type: 'gather', target, kind: 'farm' });
          for (const u of vills.slice(1)) u.command({ type: 'move', x: target.x, z: target.z });
          ack = 'gather';
        } else if (target.isBuilding && target.owner === 0 && target.def.drop) {
          for (const u of vills) {
            if (u.carry.amount > 0 && target.accepts(u.carry.res)) u.command({ type: 'dropoff', target, then: null });
            else u.moveTo(target.x, target.z + target.size);
          }
          ack = 'move';
        } else villHandled = false;
      }
      const movers = villHandled ? others : units;
      this._formationMove(movers, x, z);
      this.game.hud.marker(x, z);
    }
    this.game.audio?.ack(units[0], ack);
  }

  _formationMove(units, x, z) {
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
      u.command({ type: 'move', x: tx, z: tz, arrive: 0.6 });
    });
  }

  // ------------------------------------------------------------------ events
  _down(e) {
    if (this.game.paused) return;
    if (e.button === 0) {
      if (this.placing) { this._place(e.shiftKey); return; }
      this.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, active: false, shift: e.shiftKey };
    } else if (e.button === 2) {
      if (this.placing) { this.cancelPlacement(); return; }
      const target = this.pick(e.clientX, e.clientY);
      const gp = this.groundAt(e.clientX, e.clientY);
      if (!gp && !target) return;
      this.commandAt(gp ? gp.x : target.x, gp ? gp.z : target.z, target);
    }
  }

  _move(e) {
    if (this.drag) {
      this.drag.x1 = e.clientX; this.drag.y1 = e.clientY;
      if (Math.hypot(this.drag.x1 - this.drag.x0, this.drag.y1 - this.drag.y0) > 6) this.drag.active = true;
    }
  }

  _up(e) {
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (this.game.paused) return;
    if (d.active) {
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      const inside = this.sim.units.filter((u) => {
        if (!u.alive || u.owner !== 0) return false;
        const s = this.screenOf(u.x, u.y + 1, u.z);
        return s && s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1;
      });
      // prefer military units when mixed (like AoE when boxing an army)
      const mil = inside.filter((u) => !u.isVillager);
      const pickList = mil.length && mil.length < inside.length && inside.length > 6 ? mil : inside;
      this.setSelection(d.shift ? [...new Set([...this.selection, ...pickList])] : pickList);
      return;
    }
    const e0 = this.pick(e.clientX, e.clientY);
    const now = performance.now();
    if (e0 && this.lastClick.id === e0.id && now - this.lastClick.t < 350 && e0.isUnit && e0.owner === 0) {
      // double click: all of the same type on screen
      const same = this.sim.units.filter((u) => u.alive && u.owner === 0 && u.kind === e0.kind && (() => {
        const s = this.screenOf(u.x, u.y + 1, u.z);
        return s && s[0] > 0 && s[1] > 0 && s[0] < innerWidth && s[1] < innerHeight;
      })());
      this.setSelection(same);
    } else if (e0) {
      if (d.shift && e0.isUnit && e0.owner === 0) {
        const s = new Set(this.selection);
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
      if (e.code === 'F10' || !this.selection.length) { g.pause(!g.paused); return; }
      this.setSelection([]);
      return;
    }
    if (g.paused) return;
    const digit = e.code.startsWith('Digit') ? +e.code.slice(5) : -1;
    if (digit >= 0) {
      if (e.ctrlKey) { this.groups[digit] = [...this.selection]; e.preventDefault(); g.hud.notice(`Grupo ${digit} definido`); return; }
      const grp = (this.groups[digit] || []).filter((u) => u.alive);
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

  update() {
    this._updatePlacement();
    // prune dead entities from the selection
    if (this.selection.some((e) => e.alive === false || (e.type === 'tree' && e.amount <= 0))) {
      this.selection = this.selection.filter((e) => e.alive !== false && !(e.type === 'tree' && e.amount <= 0));
    }
  }
}
