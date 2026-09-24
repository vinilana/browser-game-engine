// HUD for "Reinos": resource bar, command grid, selection panel, minimap,
// world overlay (selection rings, health bars, drag box) and menus.
import { Vector3 } from 'three';
import { UNITS, BUILDINGS, AGES, RES, RES_LABEL, TEAMS, MAP_SIZE, RESOURCES } from './config.js';
import { icon } from './icons.js';

const GRID_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'];
const KEY_LABEL = (k) => k.replace('Key', '');
const fmtCost = (c) => Object.entries(c || {}).map(([k, v]) => `<span class="c ${k}">${icon(k)}${v}</span>`).join('');
const _v = new Vector3();

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.overlay = document.getElementById('overlay');
    this.octx = this.overlay.getContext('2d');
    this.root.innerHTML = `
      <div id="topbar">
        <div class="res">${RES.map((r) => `<div class="r" data-r="${r}" title="${RES_LABEL[r]}">${icon(r)}<b>0</b></div>`).join('')}
          <div class="r pop" title="População">${icon('pop')}<b>0/0</b></div>
        </div>
        <div class="age"></div>
        <div class="right"><span class="clock">00:00</span><button id="idleBtn" title="Aldeão ocioso (.)">${icon('idle')}<i>0</i></button><button id="menuBtn" title="Menu (F10)">${icon('menu')}</button></div>
      </div>
      <div id="notice"></div>
      <div id="bottom">
        <div id="commands"></div>
        <div id="selection"></div>
        <div id="minimapWrap"><canvas id="minimap" width="220" height="220"></canvas></div>
      </div>
      <div id="tooltip"></div>
      <div id="screen" class="hidden"></div>
      <div id="loading" class="hidden"><div class="logo">REINOS</div><div class="sub">Estratégia em tempo real · Aether Engine</div><div class="bar"><i></i></div><div class="st">Carregando…</div></div>`;
    this.$ = (s) => this.root.querySelector(s);
    this.minimap = this.$('#minimap');
    this.mctx = this.minimap.getContext('2d');
    this.cmdSig = '';
    this.selSig = '';
    this.$('#menuBtn').onclick = () => this.game.pause(true);
    this.$('#idleBtn').onclick = () => this.game.controls.selectIdleVillager();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this.markers = [];
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = innerWidth * dpr;
    this.overlay.height = innerHeight * dpr;
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setLoading(p, text) {
    this.$('#loading')?.classList.remove('hidden');
    if (!this.$('#loading')) return;
    this.$('#loading .bar i').style.width = `${Math.round(p * 100)}%`;
    if (text) this.$('#loading .st').textContent = text;
  }

  hideLoading() { this.$('#loading').classList.add('fade'); setTimeout(() => this.$('#loading').remove(), 700); }

  notice(msg, ms = 2200) {
    const n = this.$('#notice');
    n.textContent = msg;
    n.classList.add('show');
    clearTimeout(this._nt);
    this._nt = setTimeout(() => n.classList.remove('show'), ms);
  }

  marker(x, z, color = '#7dff8a') { this.markers.push({ x, z, t: 0, color }); }

  // -------------------------------------------------------------- per frame
  update() {
    const g = this.game, sim = g.sim, p = sim.players[0];
    for (const r of RES) this.root.querySelector(`[data-r="${r}"] b`).textContent = Math.floor(p.res[r]);
    this.root.querySelector('.pop b').textContent = `${p.pop}/${p.popCap}`;
    this.root.querySelector('.pop').classList.toggle('warn', p.pop >= p.popCap);
    this.$('.age').textContent = AGES[p.age].name;
    const t = Math.floor(sim.time);
    this.$('.clock').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    const idle = sim.units.filter((u) => u.alive && u.owner === 0 && u.isVillager && !u.order).length;
    this.$('#idleBtn i').textContent = idle;
    this.$('#idleBtn').classList.toggle('on', idle > 0);
    this._commands();
    this._selection();
  }

  // -------------------------------------------------------------- command grid
  _commandsFor(sel) {
    const g = this.game, sim = g.sim, p = sim.players[0];
    const cmds = [];
    if (!sel.length || sel[0].owner !== 0) return cmds;
    const first = sel[0];
    const villagers = sel.filter((e) => e.isUnit && e.isVillager);
    if (first.isUnit) {
      if (villagers.length) {
        const order = ['house', 'mill', 'lumber_camp', 'mining_camp', 'farm', 'barracks', 'archery_range', 'stable', 'watch_tower', 'town_center'];
        order.forEach((k, i) => {
          const d = BUILDINGS[k];
          const ageOk = (d.age || 0) <= p.age;
          const reqOk = !d.requiresBuilding || sim.buildings.some((b) => b.owner === 0 && b.kind === d.requiresBuilding && b.built);
          cmds[i] = {
            icon: k, label: d.label, cost: d.cost, desc: d.desc,
            locked: !ageOk ? `Requer ${AGES[d.age].name}` : !reqOk ? `Requer ${BUILDINGS[d.requiresBuilding].label}` : null,
            action: () => g.controls.startPlacement(k),
          };
        });
      }
      cmds[10] = { icon: 'stop', label: 'Parar', action: () => sel.forEach((u) => u.command(null)) };
      cmds[11] = { icon: 'delete', label: 'Excluir', action: () => g.deleteSelection() };
    } else if (first.isBuilding && first.built) {
      const b = first;
      (b.def.train || []).forEach((k, i) => {
        const d = UNITS[k];
        const ageOk = (d.age || 0) <= p.age;
        cmds[i] = {
          icon: k === 'militia' ? 'militia' : k, label: d.label, cost: d.cost, desc: d.desc, count: b.queue.filter((q) => q === k).length,
          locked: !ageOk ? `Requer ${AGES[d.age].name}` : null,
          action: () => g.trainFromSelection(k),
        };
      });
      if (b.kind === 'town_center' && AGES[p.age + 1]) {
        const next = AGES[p.age + 1];
        const vills = sim.units.filter((u) => u.owner === 0 && u.isVillager).length;
        cmds[4] = { icon: 'age', label: `Avançar para ${next.name}`, cost: next.cost, desc: `Pesquisa: ${next.time}s. Libera novas construções e unidades.`, action: () => g.ageUpSelection(), locked: b.research ? 'Em pesquisa' : null };
        void vills;
      }
      cmds[10] = { icon: 'stop', label: 'Cancelar produção', action: () => sim.cancelTrain(b) };
      cmds[11] = { icon: 'delete', label: 'Demolir', action: () => g.deleteSelection() };
    } else if (first.isBuilding) {
      cmds[11] = { icon: 'delete', label: 'Cancelar construção', action: () => g.deleteSelection() };
    }
    return cmds;
  }

  _commands() {
    const sel = this.game.controls.selection;
    const cmds = this._commandsFor(sel);
    const p = this.game.sim.players[0];
    const sig = sel.map((e) => e.id).join(',') + '|' + cmds.map((c) => c ? `${c.label}${c.count || ''}${c.locked || ''}${c.cost ? p.canAfford(c.cost) : ''}` : '-').join(';');
    this.cmds = cmds;
    if (sig === this.cmdSig) return;
    this.cmdSig = sig;
    const el = this.$('#commands');
    el.innerHTML = '';
    for (let i = 0; i < 15; i++) {
      const c = cmds[i];
      const btn = document.createElement('button');
      btn.className = 'cmd';
      if (c) {
        const afford = !c.cost || p.canAfford(c.cost);
        btn.innerHTML = `${icon(c.icon)}<span class="k">${KEY_LABEL(GRID_KEYS[i])}</span>${c.count ? `<span class="n">${c.count}</span>` : ''}`;
        btn.classList.toggle('locked', !!c.locked);
        btn.classList.toggle('poor', !afford);
        btn.onclick = () => this.runCommand(i);
        btn.onmouseenter = (e) => this._tip(c, e);
        btn.onmouseleave = () => this._tip(null);
      } else btn.classList.add('empty');
      el.appendChild(btn);
    }
  }

  runCommand(i) {
    const c = this.cmds?.[i];
    if (!c) return;
    if (c.locked) { this.notice(c.locked); return; }
    c.action();
    this.cmdSig = '';
  }

  hotkey(code) {
    const i = GRID_KEYS.indexOf(code);
    if (i >= 0 && this.cmds?.[i]) { this.runCommand(i); return true; }
    return false;
  }

  _tip(c, e) {
    const t = this.$('#tooltip');
    if (!c) { t.classList.remove('show'); return; }
    t.innerHTML = `<b>${c.label}</b>${c.cost ? `<div class="cost">${fmtCost(c.cost)}</div>` : ''}${c.desc ? `<div>${c.desc}</div>` : ''}${c.locked ? `<div class="lock">${c.locked}</div>` : ''}`;
    const r = e.currentTarget.getBoundingClientRect();
    t.style.left = `${r.left}px`;
    t.style.bottom = `${innerHeight - r.top + 8}px`;
    t.classList.add('show');
  }

  // -------------------------------------------------------------- selection panel
  _selection() {
    const sel = this.game.controls.selection.filter((e) => e.alive !== false && (e.type !== 'tree' || e.amount > 0));
    const el = this.$('#selection');
    const sim = this.game.sim;
    if (!sel.length) {
      if (this.selSig !== 'none') { this.selSig = 'none'; el.innerHTML = '<div class="empty">Selecione unidades ou construções.<br/><small>Botão esquerdo seleciona · direito comanda · arraste para selecionar vários</small></div>'; }
      return;
    }
    if (sel.length === 1) {
      const e = sel[0];
      const sig = `1:${e.id}:${Math.ceil(e.hp || 0)}:${e.carry?.amount || 0}:${e.queue?.join() || ''}:${e.built}:${Math.floor((e.amount ?? 0))}:${Math.floor((e.progress || 0) * 100)}:${e.trainT ? Math.floor(e.trainT) : 0}:${e.research ? Math.floor(e.research.t) : ''}:${e.food ?? ''}`;
      if (sig === this.selSig) return;
      this.selSig = sig;
      let name, iconName, hp = null, lines = [];
      if (e.isUnit) {
        name = e.def.label; iconName = e.isAnimal ? e.kind : e.kind; hp = [e.hp, e.maxHp];
        if (!e.isAnimal) {
          lines.push(`<span title="Ataque">⚔ ${e.def.attack}</span><span title="Armadura corpo a corpo / perfurante">🛡 ${e.def.armor}/${e.def.pierceArmor}</span>${e.def.range > 2 ? `<span title="Alcance">➶ ${e.def.range} m</span>` : ''}`);
        }
        if (e.carry?.amount) lines.push(`Carregando: ${Math.floor(e.carry.amount)} ${RES_LABEL[e.carry.res].toLowerCase()}`);
        if (e.order?.type === 'gather') lines.push('Coletando');
        else if (e.order?.type === 'build') lines.push('Construindo');
        else if (e.order?.type === 'attack') lines.push('Atacando');
        if (e.owner >= 0) lines.push(`<span style="color:${TEAMS[e.owner].css}">${TEAMS[e.owner].name}</span>`);
      } else if (e.isBuilding) {
        name = e.def.label; iconName = e.kind; hp = [e.hp, e.maxHp];
        if (!e.built) lines.push(`Em construção: ${Math.floor(e.progress * 100)}%`);
        if (e.kind === 'farm') lines.push(`Comida restante: ${Math.floor(e.food)}`);
        if (e.def.pop) lines.push(`+${e.def.pop} de população`);
        if (e.def.drop) lines.push(`Depósito: ${e.def.drop.map((r) => RES_LABEL[r]).join(', ')}`);
        if (e.owner >= 0) lines.push(`<span style="color:${TEAMS[e.owner].css}">${TEAMS[e.owner].name}</span>`);
      } else {
        name = RESOURCES[e.type]?.label || 'Recurso'; iconName = e.type === 'gold' ? 'gold' : e.type === 'stone' ? 'stone' : e.type === 'tree' ? 'tree' : 'berry';
        lines.push(`Restante: ${Math.floor(e.amount)}`);
      }
      let queue = '';
      if (e.isBuilding && e.owner === 0 && (e.queue?.length || e.research)) {
        const items = [];
        if (e.research) items.push(`<div class="q active">${icon('age')}<i style="width:${(e.research.t / e.research.time) * 100}%"></i></div>`);
        e.queue.forEach((k, i) => items.push(`<div class="q ${i === 0 ? 'active' : ''}" data-i="${i}">${icon(k)}${i === 0 ? `<i style="width:${(e.trainT / UNITS[k].time) * 100}%"></i>` : ''}</div>`));
        queue = `<div class="queue">${items.join('')}</div>${e.blockedByPop ? '<div class="warn">Construa casas!</div>' : ''}`;
      }
      el.innerHTML = `<div class="single"><div class="portrait">${icon(iconName)}</div><div class="info"><h3>${name}</h3>
        ${hp ? `<div class="hp"><i style="width:${(Math.max(0, hp[0]) / hp[1]) * 100}%"></i><span>${Math.ceil(Math.max(0, hp[0]))}/${hp[1]}</span></div>` : ''}
        <div class="lines">${lines.map((l) => `<div>${l}</div>`).join('')}</div>${queue}</div></div>`;
      el.querySelectorAll('.q[data-i]').forEach((q) => { q.onclick = () => this.game.sim.cancelTrain(e, +q.dataset.i); });
      if (e.blockedByPop) e.blockedByPop = false;
      return;
    }
    const sig = 'n:' + sel.map((e) => `${e.id}:${Math.ceil(e.hp)}`).join(',');
    if (sig === this.selSig) return;
    this.selSig = sig;
    el.innerHTML = `<div class="multi">${sel.slice(0, 40).map((e) => `<div class="mi" data-id="${e.id}">${icon(e.isBuilding ? e.kind : e.kind)}<i style="width:${(e.hp / e.maxHp) * 100}%"></i></div>`).join('')}</div>`;
    el.querySelectorAll('.mi').forEach((m) => {
      m.onclick = () => {
        const ent = sel.find((e) => e.id === +m.dataset.id);
        if (ent) this.game.controls.setSelection([ent]);
      };
    });
    void sim;
  }

  // -------------------------------------------------------------- minimap
  buildMinimapBase(map) {
    const N = 220;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    const n = map.size + 1;
    const colors = [[96, 116, 52], [132, 124, 72], [110, 88, 62], [52, 64, 34], [196, 180, 132], [120, 116, 108], [80, 68, 52], [140, 120, 92]];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = Math.floor((x / N) * map.size), j = Math.floor((y / N) * map.size);
        const k = j * n + i;
        const h = map.heights[k];
        let r = 0, gg = 0, b = 0;
        for (let l = 0; l < 8; l++) { const w = map.splat[k * 8 + l] / 255; r += colors[l][0] * w; gg += colors[l][1] * w; b += colors[l][2] * w; }
        const hx = map.heights[k + 1] - h;
        const shade = 1 + Math.max(-0.3, Math.min(0.3, hx * 0.25)) + (h - 8) * 0.008;
        if (h < 0) { r = 40; gg = 76; b = 96; }
        const o = (y * N + x) * 4;
        img.data[o] = r * shade; img.data[o + 1] = gg * shade; img.data[o + 2] = b * shade; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(28,48,22,0.85)';
    for (const t of map.trees) ctx.fillRect((t.x / MAP_SIZE) * N - 1, (t.z / MAP_SIZE) * N - 1, 2, 2);
    this.miniBase = c;
    this.minimap.onmousedown = (e) => this._miniClick(e);
    this.minimap.onmousemove = (e) => { if (e.buttons & 1) this._miniClick(e); };
    this.minimap.oncontextmenu = (e) => { e.preventDefault(); this._miniClick(e, true); };
  }

  _miniClick(e, right = false) {
    const r = this.minimap.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * MAP_SIZE, z = ((e.clientY - r.top) / r.height) * MAP_SIZE;
    if (right || e.button === 2) this.game.controls.commandAt(x, z, null);
    else this.game.cam.lookAt(x, z);
  }

  drawMinimap() {
    const ctx = this.mctx, N = 220, sim = this.game.sim;
    if (!this.miniBase) return;
    ctx.drawImage(this.miniBase, 0, 0);
    // fog
    const f = sim.fowN;
    const fog = this._fogImg || (this._fogImg = ctx.createImageData(f, f));
    const exp = sim.explored[0], vis = sim.visible[0];
    for (let k = 0; k < f * f; k++) {
      const a = sim.revealAll ? 0 : vis[k] ? 0 : exp[k] ? 110 : 245;
      fog.data[k * 4] = 0; fog.data[k * 4 + 1] = 0; fog.data[k * 4 + 2] = 0; fog.data[k * 4 + 3] = a;
    }
    const fc = this._fogCanvas || (this._fogCanvas = Object.assign(document.createElement('canvas'), { width: f, height: f }));
    fc.getContext('2d').putImageData(fog, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fc, 0, 0, N, N);
    const S = N / MAP_SIZE;
    for (const r of sim.resources) {
      if (!r.alive || !sim.isExploredBy(0, r.x, r.z)) continue;
      ctx.fillStyle = r.type === 'gold' ? '#f2c230' : r.type === 'stone' ? '#b9b3a8' : '#c0304a';
      ctx.fillRect(r.x * S - 1.5, r.z * S - 1.5, 3, 3);
    }
    for (const b of sim.buildings) {
      if (b.owner !== 0 && !sim.isExploredBy(0, b.x, b.z)) continue;
      ctx.fillStyle = TEAMS[b.owner].css;
      const s = Math.max(3, b.size * S);
      ctx.fillRect(b.x * S - s / 2, b.z * S - s / 2, s, s);
    }
    for (const u of sim.units) {
      if (!u.alive) continue;
      if (u.owner !== 0 && !sim.isVisibleTo(0, u.x, u.z)) continue;
      ctx.fillStyle = u.owner >= 0 ? TEAMS[u.owner].css : '#e8e2d0';
      ctx.fillRect(u.x * S - 1, u.z * S - 1, 2.5, 2.5);
    }
    // camera footprint
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([sx, sy]) => this.game.controls.groundAtNDC(sx * 2 - 1, (1 - sy) * 2 - 1));
    if (corners.every(Boolean)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x * S, p.z * S) : ctx.moveTo(p.x * S, p.z * S)));
      ctx.closePath();
      ctx.stroke();
    }
  }

  // -------------------------------------------------------------- world overlay
  drawOverlay(dt) {
    const ctx = this.octx, g = this.game, cam = g.engine.camera, sim = g.sim;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const proj = (x, y, z) => {
      _v.set(x, y, z).project(cam);
      if (_v.z > 1) return null;
      return [(_v.x * 0.5 + 0.5) * innerWidth, (-_v.y * 0.5 + 0.5) * innerHeight];
    };
    const ring = (x, z, r, color, width = 1.6) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const p = proj(px, g.world.heightAt(px, pz) + 0.05, pz);
        if (!p) return;
        if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
      }
      ctx.stroke();
    };
    const bar = (x, y, z, f, w = 34) => {
      const p = proj(x, y, z);
      if (!p) return;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(p[0] - w / 2 - 1, p[1] - 1, w + 2, 5);
      ctx.fillStyle = f > 0.5 ? '#5fd66a' : f > 0.25 ? '#e3c140' : '#e0483c';
      ctx.fillRect(p[0] - w / 2, p[1], w * Math.max(0, f), 3);
    };
    const selSet = new Set(g.controls.selection);
    for (const e of g.controls.selection) {
      if (e.alive === false) continue;
      const color = e.owner >= 0 ? TEAMS[e.owner].css : '#e8e2d0';
      if (e.isUnit) {
        ring(e.x, e.z, e.def.radius + 0.35, color);
        bar(e.x, e.y + (e.def.classes?.includes('cavalry') ? 2.9 : 2.1), e.z, e.hp / e.maxHp, e.isAnimal ? 24 : 30);
      } else if (e.isBuilding) {
        ring(e.x, e.z, e.size * 0.72, color, 2);
        bar(e.x, e.y + (g.renderer.buildingViews.get(e)?.height || 6) + 1, e.z, e.hp / e.maxHp, 70);
        if (e.rally && e.owner === 0) {
          const p = proj(e.rally.x, g.world.heightAt(e.rally.x, e.rally.z), e.rally.z);
          if (p) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] - 22); ctx.stroke(); ctx.fillStyle = TEAMS[0].css; ctx.fillRect(p[0], p[1] - 22, 12, 8); }
        }
      } else if (e.type === 'tree' ? e.amount > 0 : e.alive) {
        ring(e.x, e.z, (e.radius || 0.8) + 0.6, '#e8e2d0');
      }
    }
    // damaged units in view (not selected)
    for (const u of sim.units) {
      if (!u.alive || selSet.has(u) || u.hp >= u.maxHp || u.isAnimal) continue;
      if (u.owner !== 0 && !sim.isVisibleTo(0, u.x, u.z)) continue;
      bar(u.x, u.y + 2.1, u.z, u.hp / u.maxHp, 24);
    }
    // order markers
    for (const m of this.markers) {
      m.t += dt;
      const r = 0.4 + m.t * 2.2;
      ctx.globalAlpha = Math.max(0, 1 - m.t * 1.6);
      ring(m.x, m.z, r, m.color, 2);
      ctx.globalAlpha = 1;
    }
    this.markers = this.markers.filter((m) => m.t < 0.65);
    // drag box
    const d = g.controls.drag;
    if (d && d.active) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
  }

  // -------------------------------------------------------------- screens
  showScreen(html, cls = '') {
    const s = this.$('#screen');
    s.className = cls;
    s.innerHTML = html;
    return s;
  }

  hideScreen() { this.$('#screen').className = 'hidden'; }
}
