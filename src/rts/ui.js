// HUD for "Reinos": resource bar, command grid, selection panel, minimap,
// world overlay (selection rings, health bars, drag box) and menus.
import { Vector3 } from 'three';
import { UNITS, BUILDINGS, AGES, RES, RES_LABEL, TEAMS, MAP_SIZE, RESOURCES, CARRY } from './config.js';
import { icon } from './icons.js';
import { INTENT_COLOR } from './cursors.js';

const GRID_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'];
const KEY_LABEL = (k) => k.replace('Key', '');
const fmtCost = (c) => Object.entries(c || {}).map(([k, v]) => `<span class="c ${k}">${icon(k)}${v}</span>`).join('');
const _v = new Vector3();
const RES_CSS = { food: '#e0795a', wood: '#c99a5e', gold: '#f0c64a', stone: '#c4bcb0' };
const STANCES = [['aggressive', 'Postura agressiva', 'Persegue inimigos que avistar.'], ['defensive', 'Postura defensiva', 'Luta perto de onde está e volta ao posto.'], ['ground', 'Manter posição', 'Não sai do lugar; ataca só o que estiver ao alcance.']];
const GATHER_TASK = {
  tree: 'Cortando madeira', gold: 'Minerando ouro', stone: 'Extraindo pedra', berry: 'Colhendo frutas',
  carcass: 'Esquartejando a caça', farm: 'Cultivando a fazenda',
};
const lower = (s) => (s || '').toLowerCase();

/** Human-readable description of what a unit is doing. */
export function taskText(u) {
  const o = u.order;
  if (!o) return u.isAnimal ? null : 'Ocioso';
  const t = o.target;
  switch (o.type) {
    case 'move': return o.attackMove ? 'Avançando em ataque' : 'Andando';
    case 'attack':
      if (o.hunt) return t?.alive ? `Caçando ${lower(t.def.label)}` : 'Caçando';
      return t ? `Atacando ${lower(t.def?.label)}${t.owner === 1 ? ' inimigo(a)' : ''}` : 'Atacando';
    case 'gather': {
      if (o.kind === 'tree' && t && t.state === 'standing') return 'Derrubando uma árvore';
      if (o.kind === 'tree' && t && t.state === 'falling') return 'Madeira! A árvore está caindo';
      return GATHER_TASK[o.kind] || 'Coletando';
    }
    case 'build': return t ? `Construindo ${lower(t.def.label)} (${Math.floor(t.progress * 100)}%)` : 'Construindo';
    case 'repair': return t ? `Reparando ${lower(t.def.label)}` : 'Reparando';
    case 'dropoff': return `Levando ${lower(RES_LABEL[u.carry.res] || 'recursos')} ao depósito`;
    default: return '';
  }
}

/** Name, colour and detail lines for the hover hint. */
function describe(e, sim) {
  const own = (o) => (o === 0 ? 'Você' : o === 1 ? 'Inimigo' : null);
  if (e.isUnit) {
    const lines = [];
    if (e.isAnimal) {
      lines.push(`${e.def.food} de comida`);
      lines.push(e.owner < 0 ? (e.def.herdable ? 'Selvagem · aproxime uma unidade para reunir' : 'Selvagem') : e.owner === 0 ? 'Seu rebanho' : 'Rebanho inimigo');
    } else {
      lines.push(`Vida ${Math.ceil(e.hp)}/${e.maxHp}`);
      if (e.owner === 0) { const t = taskText(e); if (t) lines.push(t); }
      if (e.carry?.amount) lines.push(`Carregando ${Math.floor(e.carry.amount)} de ${lower(RES_LABEL[e.carry.res])}`);
    }
    return { name: e.def.label, owner: e.owner, sub: own(e.owner), lines };
  }
  if (e.isBuilding) {
    const lines = [`Vida ${Math.ceil(e.hp)}/${e.maxHp}`];
    if (!e.built) lines.push(`Em construção: ${Math.floor(e.progress * 100)}%`);
    if (e.kind === 'farm' && e.built) lines.push(`${Math.floor(e.food)} de comida restante`);
    return { name: e.def.label, owner: e.owner, sub: own(e.owner), lines };
  }
  if (e.type === 'tree') {
    const n = sim.workersOn(e);
    return { name: e.state === 'standing' ? 'Árvore' : 'Tronco caído', owner: -1, lines: [`${Math.ceil(e.amount)} de madeira`, n ? `${n} lenhador(es)` : null].filter(Boolean) };
  }
  if (e.isResource) {
    const n = sim.workersOn(e);
    const name = e.type === 'carcass' ? `Carcaça de ${lower(UNITS[e.species]?.label || 'animal')}` : RESOURCES[e.type]?.label || 'Recurso';
    const lines = [`${Math.ceil(e.amount)} de ${lower(RES_LABEL[e.res])}${e.type === 'carcass' ? ' (estragando)' : ''}`];
    if (n) lines.push(`${n} aldeão(ões) trabalhando`);
    return { name, owner: -1, lines };
  }
  return null;
}

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
      <div id="hovertip"></div>
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
    this.flashes = [];
    this.floats = [];
    this.hoverEl = this.$('#hovertip');
    this._ht = { e: null, since: 0, sig: '' };
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

  /** Order feedback on the ground: 'move' plants a small flag, 'attackMove' a pennant, 'rally' a banner. */
  marker(x, z, color = '#9fe39a', kind = 'move') { this.markers.push({ x, z, t: 0, color, kind }); }

  /** Blinks a ring around the target of an order (follows it while it moves). */
  flash(e, color = '#ffffff') {
    this.flashes = this.flashes.filter((f) => f.e !== e);
    this.flashes.push({ e, t: 0, color });
  }

  /** Small rising text in the world (e.g. "+10" on a drop-off). */
  floatText(x, y, z, text, color = '#fff') { this.floats.push({ x, y, z, text, color, t: 0 }); }

  /** Hint next to the cursor: what is under it and what a right-click would do. */
  hoverTip(e, intent = null, mx = 0, my = 0) {
    const el = this.hoverEl, ht = this._ht;
    if (!e && !(intent && intent.kind !== 'move' && !intent.target)) {
      if (ht.e || ht.shown) { el.classList.remove('show'); ht.e = null; ht.shown = false; ht.sig = ''; }
      return;
    }
    const now = performance.now();
    if (ht.e !== e) {
      ht.e = e; ht.since = now;
      if (ht.shown) { el.classList.remove('show'); ht.shown = false; }
    }
    const act = intent && intent.kind !== 'move' && e ? intent : null;
    // scenery (trees, piles) only gets a hint quickly when a click would do something with it
    const delay = act || !e || e.isUnit || e.isBuilding ? 140 : 650;
    if (now - ht.since < delay) return;
    const info = e ? describe(e, this.game.sim) : { name: intent.text, owner: -1, lines: [] };
    if (!info) return;
    const sig = `${info.name}|${info.lines.join('|')}|${act?.kind}|${act?.text}`;
    if (sig !== ht.sig) {
      ht.sig = sig;
      const col = info.owner >= 0 ? TEAMS[info.owner].css : '#f3e2b3';
      const ac = act ? INTENT_COLOR[act.kind] || '#fff' : '';
      el.innerHTML = `<b style="color:${col}">${info.name}</b>${info.sub ? `<span class="who">${info.sub}</span>` : ''}`
        + info.lines.map((l) => `<div>${l}</div>`).join('')
        + (act ? `<div class="act" style="color:${ac}"><i class="rmb"></i>${act.text}</div>` : '');
    }
    const w = el.offsetWidth || 180, h = el.offsetHeight || 60;
    let x = mx + 22, y = my + 18;
    if (x + w > innerWidth - 8) x = mx - w - 14;
    if (y + h > innerHeight - 200) y = my - h - 12;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (!ht.shown) { el.classList.add('show'); ht.shown = true; }
  }

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
      const soldiers = sel.filter((e) => e.isUnit && e.isMilitary);
      if (soldiers.length && !villagers.length) {
        cmds[0] = { icon: 'attackMove', label: 'Ataque em movimento', desc: 'Clique no destino: os soldados avançam atacando tudo o que encontrarem. Shift encadeia pontos.', action: () => g.controls.startTargeting('attackMove') };
        STANCES.forEach(([k, label, desc], i) => {
          cmds[5 + i] = { icon: k, label, desc, active: soldiers.every((u) => u.stance === k), action: () => { soldiers.forEach((u) => { u.stance = k; }); this.notice(label); } };
        });
      }
      cmds[10] = { icon: 'stop', label: 'Parar', desc: 'Cancela as ordens (inclusive as da fila).', action: () => sel.forEach((u) => u.stop?.()) };
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
    const sig = sel.map((e) => e.id).join(',') + '|' + cmds.map((c) => c ? `${c.label}${c.count || ''}${c.locked || ''}${c.cost ? p.canAfford(c.cost) : ''}${c.active ? '*' : ''}` : '-').join(';');
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
        btn.classList.toggle('active', !!c.active);
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
      const task = e.isUnit ? taskText(e) : '';
      const workers = !e.isUnit && !e.isBuilding ? sim.workersOn(e) : 0;
      const sig = `1:${e.id}:${Math.ceil(e.hp || 0)}:${e.carry?.amount || 0}:${Array.isArray(e.queue) ? e.queue.length : ''}:${e.isBuilding ? e.queue.join() : ''}:${e.built}:${Math.floor((e.amount ?? 0))}:${Math.floor((e.progress || 0) * 100)}:${e.trainT ? Math.floor(e.trainT) : 0}:${e.research ? Math.floor(e.research.t) : ''}:${e.food ?? ''}:${task}:${e.stance}:${e.owner}:${workers}`;
      if (sig === this.selSig) return;
      this.selSig = sig;
      let name, iconName, hp = null, lines = [];
      if (e.isUnit) {
        name = e.def.label; iconName = e.kind; hp = [e.hp, e.maxHp];
        if (!e.isAnimal) {
          lines.push(`<span title="Ataque">⚔ ${e.def.attack}</span><span title="Armadura corpo a corpo / perfurante">🛡 ${e.def.armor}/${e.def.pierceArmor}</span>${e.def.range > 2 ? `<span title="Alcance">➶ ${e.def.range} m</span>` : ''}`);
        } else {
          lines.push(`${e.def.food} de comida · ${e.owner < 0 ? 'selvagem' : e.owner === 0 ? 'seu rebanho' : 'rebanho inimigo'}`);
        }
        if (task && e.owner === 0) lines.push(`<span class="task">${task}</span>`);
        if (e.carry?.amount) {
          const c = e.carry;
          lines.push(`<span class="load"><span class="c ${c.res}">${icon(c.kind === 'carcass' ? 'meat' : c.res)}</span><span class="lb"><i style="width:${(c.amount / CARRY) * 100}%;background:${RES_CSS[c.res]}"></i></span>${Math.floor(c.amount)}/${CARRY}</span>`);
        }
        if (e.isMilitary && e.owner === 0) lines.push(`<span class="dim">${STANCES.find((s) => s[0] === e.stance)?.[1] || ''}</span>`);
        if (e.queue?.length && e.owner === 0) lines.push(`<span class="dim">+${e.queue.length} ordem(ns) na fila</span>`);
        if (e.owner >= 0) lines.push(`<span style="color:${TEAMS[e.owner].css}">${TEAMS[e.owner].name}</span>`);
      } else if (e.isBuilding) {
        name = e.def.label; iconName = e.kind; hp = [e.hp, e.maxHp];
        if (!e.built) lines.push(`Em construção: ${Math.floor(e.progress * 100)}%`);
        if (e.kind === 'farm') lines.push(`Comida restante: ${Math.floor(e.food)}`);
        if (e.def.pop) lines.push(`+${e.def.pop} de população`);
        if (e.def.drop) lines.push(`Depósito: ${e.def.drop.map((r) => RES_LABEL[r]).join(', ')}`);
        if (e.owner >= 0) lines.push(`<span style="color:${TEAMS[e.owner].css}">${TEAMS[e.owner].name}</span>`);
      } else {
        const info = describe(e, sim);
        name = info.name;
        iconName = e.type === 'gold' ? 'gold' : e.type === 'stone' ? 'stone' : e.type === 'tree' ? 'tree' : e.type === 'carcass' ? 'meat' : 'berry';
        lines.push(...info.lines);
      }
      let queue = '';
      if (e.isBuilding && e.rally && e.owner === 0) lines.push(`<span class="dim">Ponto de encontro${e.rally.target ? ': ' + lower(e.rally.target.type === 'tree' ? 'árvore' : RESOURCES[e.rally.target.type]?.label || e.rally.target.def?.label || '') : ' definido'}</span>`);
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
    const sig = 'n:' + sel.map((e) => `${e.id}:${Math.ceil(e.hp)}:${e.carry?.amount > 0 ? 1 : 0}`).join(',');
    if (sig === this.selSig) return;
    this.selSig = sig;
    el.innerHTML = `<div class="multi">${sel.slice(0, 40).map((e) => `<div class="mi" data-id="${e.id}" title="${e.def?.label || ''}${e.isUnit && e.owner === 0 && taskText(e) ? ' — ' + taskText(e) : ''}">${icon(e.kind)}<i style="width:${(e.hp / e.maxHp) * 100}%"></i>${e.carry?.amount > 0 ? `<b class="ld" style="background:${RES_CSS[e.carry.res]}"></b>` : ''}</div>`).join('')}</div>`;
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
    const ground = (x, z, lift = 0.06) => proj(x, g.world.heightAt(x, z) + lift, z);
    const ring = (x, z, r, color, width = 1.6, dash = null) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      const n = r > 4 ? 40 : 24;
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const p = ground(x + Math.cos(a) * r, z + Math.sin(a) * r);
        if (!p) { ctx.setLineDash([]); return; }
        if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const bar = (x, y, z, f, w = 34) => {
      const p = proj(x, y, z);
      if (!p) return;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(p[0] - w / 2 - 1, p[1] - 1, w + 2, 5);
      ctx.fillStyle = f > 0.5 ? '#5fd66a' : f > 0.25 ? '#e3c140' : '#e0483c';
      ctx.fillRect(p[0] - w / 2, p[1], w * Math.max(0, f), 3);
    };
    /** Ground outline matching the shape of an entity (log for felled trees). */
    const outline = (e, color, width, dash) => {
      if (e.isUnit) ring(e.x, e.z, e.def.radius + 0.35, color, width, dash);
      else if (e.isBuilding) ring(e.x, e.z, e.size * 0.72, color, width + 0.4, dash);
      else if (e.type === 'tree' && e.state !== 'standing' && e.fallDir !== undefined) {
        const [x0, z0, x1, z1] = g.trees.logSegment(e);
        const a = ground(x0, z0, 0.4), b = ground(x1, z1, 0.4);
        if (!a || !b) return;
        ctx.strokeStyle = color; ctx.lineWidth = width + 5; ctx.lineCap = 'round'; ctx.globalAlpha *= 0.35;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.globalAlpha /= 0.35; ctx.lineCap = 'butt';
        ring((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) * 0.55, color, width, dash);
      } else if (e.type === 'tree') ring(e.x, e.z, 1.1 * (e.scale || 1), color, width, dash);
      else ring(e.x, e.z, (e.type === 'carcass' ? 0.9 : e.radius || 0.8) + 0.55, color, width, dash);
    };
    const relColor = (e) => (e.owner === 0 ? '#8fb8ff' : e.owner === 1 ? '#ff6a5a' : '#ffe39a');
    const selSet = new Set(g.controls.selection);

    // hovered entity (dashed, in the colour of the pending action when there is one)
    const hv = g.controls.hover;
    if (hv && !selSet.has(hv) && (hv.alive !== false) && !g.controls.drag?.active) {
      const it = g.controls.intent;
      const col = it && it.target === hv ? INTENT_COLOR[it.kind] || relColor(hv) : relColor(hv);
      outline(hv, col, 1.6, [5, 4]);
    }
    for (const e of g.controls.selection) {
      if (e.alive === false) continue;
      const color = e.owner >= 0 ? TEAMS[e.owner].css : '#e8e2d0';
      if (e.isUnit) {
        outline(e, color, 1.6);
        bar(e.x, e.y + (e.def.classes?.includes('cavalry') ? 2.9 : e.isAnimal ? 1.4 : 2.1), e.z, e.hp / e.maxHp, e.isAnimal ? 24 : 30);
      } else if (e.isBuilding) {
        outline(e, color, 2);
        bar(e.x, e.y + (g.renderer.buildingViews.get(e)?.height || 6) + 1, e.z, e.hp / e.maxHp, 70);
        if (e.rally && e.owner === 0) {
          const a = ground(e.x, e.z, 0.3), p = ground(e.rally.x, e.rally.z, 0);
          if (a && p) {
            ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); ctx.setLineDash([]);
            this._flag(ctx, p[0], p[1], TEAMS[0].css, 1);
          }
        }
      } else if (e.type === 'tree' ? e.amount > 0 : e.alive) {
        outline(e, '#e8e2d0', 1.6);
      }
    }
    // planned routes of selected units (current move + Shift-queued orders)
    let shown = 0;
    for (const u of g.controls.selection) {
      if (!u.isUnit || u.owner !== 0 || !u.alive || shown > 40) continue;
      const pts = [];
      const add = (o) => {
        if (!o) return;
        if (o.type === 'move') pts.push([o.x, o.z, o.attackMove]);
        else if (o.target && (o.type !== 'gather' || u.queue.length)) pts.push([o.target.x, o.target.z, o.type === 'attack']);
      };
      if (u.order?.type === 'move' || u.queue.length) add(u.order);
      for (const q of u.queue) add(q);
      if (!pts.length) continue;
      shown++;
      let prev = ground(u.x, u.z, 0.1);
      ctx.lineWidth = 1.3;
      ctx.setLineDash([3, 5]);
      for (const [x, z, hostile] of pts) {
        const p = ground(x, z, 0.1);
        if (!prev || !p) break;
        ctx.strokeStyle = hostile ? 'rgba(255,150,90,.75)' : 'rgba(190,255,190,.7)';
        ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
        ctx.fillStyle = hostile ? '#ff9a55' : '#bff5b0';
        ctx.fillRect(p[0] - 2, p[1] - 2, 4, 4);
        prev = p;
      }
      ctx.setLineDash([]);
    }
    // damaged units in view (not selected)
    for (const u of sim.units) {
      if (!u.alive || selSet.has(u) || u.hp >= u.maxHp || u.isAnimal) continue;
      if (u.owner !== 0 && !sim.isVisibleTo(0, u.x, u.z)) continue;
      bar(u.x, u.y + 2.1, u.z, u.hp / u.maxHp, 24);
    }
    // order targets blink three times
    for (const f of this.flashes) {
      f.t += dt;
      const e = f.e;
      if (e.alive === false || (e.type === 'tree' && e.amount <= 0)) { f.t = 9; continue; }
      if (Math.sin(f.t * Math.PI * 2 * 3.3) > -0.2) {
        ctx.globalAlpha = Math.max(0, 1 - f.t / 0.95);
        outline(e, f.color, 2.6);
        ctx.globalAlpha = 1;
      }
    }
    this.flashes = this.flashes.filter((f) => f.t < 0.95);
    // ground markers
    for (const m of this.markers) {
      m.t += dt;
      const a = Math.max(0, 1 - m.t / 0.9);
      ctx.globalAlpha = a;
      ring(m.x, m.z, 0.3 + m.t * 1.8, m.color, 2);
      if (m.t < 0.3) ring(m.x, m.z, 0.25 + (0.3 - m.t) * 3, m.color, 1.2);
      const p = ground(m.x, m.z, 0);
      if (p) this._flag(ctx, p[0], p[1] - Math.max(0, 0.12 - m.t) * 90, m.color, a, m.kind);
      ctx.globalAlpha = 1;
    }
    this.markers = this.markers.filter((m) => m.t < 0.9);
    // floating numbers
    ctx.font = '600 14px "Palatino Linotype", Georgia, serif';
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      f.t += dt;
      const p = proj(f.x, f.y + 1.2 + f.t * 1.4, f.z);
      if (!p) continue;
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, f.t - 0.6) / 0.7);
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillText(f.text, p[0] + 1, p[1] + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p[0], p[1]);
      ctx.globalAlpha = 1;
    }
    this.floats = this.floats.filter((f) => f.t < 1.3);
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

  /** Little flag / pennant planted at a screen point. */
  _flag(ctx, x, y, color, alpha = 1, kind = 'rally') {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#2a1d10';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 20); ctx.stroke();
    ctx.strokeStyle = '#e8dcc0';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 20); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    if (kind === 'attackMove') { ctx.moveTo(x, y - 20); ctx.lineTo(x + 13, y - 16); ctx.lineTo(x, y - 12); }
    else { ctx.moveTo(x, y - 20); ctx.lineTo(x + 12, y - 20); ctx.lineTo(x + 9, y - 16.5); ctx.lineTo(x + 12, y - 13); ctx.lineTo(x, y - 13); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
    ctx.globalAlpha = 1;
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
