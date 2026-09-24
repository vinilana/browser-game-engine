// "Reinos" — an Age of Empires-style real-time strategy game on the Aether Engine.
import { Engine } from '../engine/core/Engine.js';
import { Settings, QUALITY_PRESETS } from '../engine/core/Settings.js';
import { WorkerPool } from '../engine/core/WorkerPool.js';
import { RTSCamera } from '../engine/camera/RTSCamera.js';
import { ParticleSystem } from '../engine/fx/ParticleSystem.js';
import { loadAssets, createMaterials } from './assets.js';
import { World } from './world.js';
import { TreeSystem, GroundCover } from './vegetation.js';
import { Simulation } from './game.js';
import { GameRenderer } from './render.js';
import { Controls } from './controls.js';
import { HUD } from './ui.js';
import { AIPlayer } from './ai.js';
import { RTSAudio } from './audio.js';
import { MAP_SIZE, GAME_SPEED, UNITS, AGES, TEAMS, RES_LABEL } from './config.js';
import { seedFromString } from '../engine/math/rng.js';

class RTSGame {
  constructor() {
    this.params = new URLSearchParams(location.search);
    this.paused = false;
    this.speed = GAME_SPEED;
    this.started = false;
  }

  async boot() {
    const canvas = document.getElementById('game');
    this.settings = new Settings({ ...QUALITY_PRESETS.high, shadowDistance: 260 }, 'aether.rts.settings.v1');
    if (this.params.get('quality')) this.settings.applyPreset(this.params.get('quality'));
    this.settings.values.shadowDistance = Math.max(200, this.settings.values.shadowDistance);
    this.engine = new Engine({ canvas, settings: this.settings });
    const e = this.engine;
    window.engine = e;
    e.input.freeCursor = true;
    e.camera.fov = 38;
    e.camera.near = 0.5;
    const P = e.pipeline;
    P.params.fogHeight = 0;
    P.params.fogDensity = 0.0011;
    P.params.fogFalloff = 0.03;
    P.params.volumetricDensity = 0.0011;
    P.params.exposureKey = 0.15;
    P.farDistance = 900;
    P.shadows.start = 14;
    P.applySettings();
    e.atmosphere.dayLength = 1800;
    e.atmosphere.hours = 9.5;
    e.atmosphere.cloudCoverage = 0.45;

    this.hud = new HUD(this);
    e.start();   // the sky animates behind the menu
    this._menu();
  }

  _menu() {
    const diff = this.params.get('difficulty') || 'normal';
    const s = this.hud.showScreen(`
      <div class="menu">
        <div class="logo">REINOS</div>
        <div class="sub">Estratégia em tempo real medieval · Aether Engine</div>
        <div class="panel">
          <label>Dificuldade<select id="mDiff"><option value="easy">Fácil</option><option value="normal">Normal</option><option value="hard">Difícil</option></select></label>
          <label>Semente do mapa<input id="mSeed" value="${this.params.get('seed') || Math.floor(Math.random() * 99999)}"/></label>
          <label>Qualidade gráfica<select id="mQual"><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="ultra">Ultra</option></select></label>
          <button id="mStart" class="primary">Começar partida</button>
          <details><summary>Como jogar</summary>
            <p><b>Botão esquerdo</b> seleciona (arraste para vários, duplo clique ou Ctrl+clique para todos do mesmo tipo) · <b>botão direito</b> age sobre o que está sob o cursor: o ícone e a dica mostram a ação (caçar, cortar, minerar, colher, esquartejar, cultivar, construir, reparar, depositar, atacar).</p>
            <p><b>Shift</b> + botão direito enfileira ordens · <b>Shift</b> ao posicionar um prédio coloca vários seguidos · soldados: <b>Q</b> ataque em movimento, <b>A/S/D</b> posturas.</p>
            <p><b>Setas / bordas da tela</b> movem a câmera · <b>roda</b> zoom · <b>botão do meio</b> ou <b>PgUp/PgDn</b> giram.</p>
            <p><b>H</b> Centro da Cidade · <b>.</b> aldeão ocioso · <b>Ctrl+1–9</b> grupos · <b>Del</b> excluir · <b>Esc/F10</b> menu.</p>
            <p>Ovelhas seguem quem chegar perto delas; leve-as ao Centro da Cidade. Colete comida, madeira, ouro e pedra, construa casas, avance de era e destrua as construções inimigas.</p>
          </details>
        </div>
      </div>`, 'menuScreen');
    document.body.classList.add('in-menu');
    s.querySelector('#mDiff').value = diff;
    s.querySelector('#mQual').value = this.settings.get('preset') || 'high';
    const go = () => {
      const q = s.querySelector('#mQual').value;
      this.settings.applyPreset(q);
      this.settings.values.shadowDistance = Math.max(200, this.settings.values.shadowDistance);
      this.engine.pipeline.applySettings();
      this.difficulty = s.querySelector('#mDiff').value;
      const raw = s.querySelector('#mSeed').value.trim() || '1';
      this.seed = /^\d+$/.test(raw) ? Number(raw) : seedFromString(raw) % 1e6;
      this.hud.hideScreen();
      document.body.classList.remove('in-menu');
      this.start().catch((err) => { console.error(err); this.hud.setLoading(1, 'Erro: ' + err.message); });
    };
    s.querySelector('#mStart').onclick = go;
    if (this.params.has('autostart')) go();
  }

  async start() {
    const e = this.engine;
    this.pool = new WorkerPool(() => new Worker(new URL('./rts.worker.js', import.meta.url), { type: 'module' }));
    await this.pool.broadcast('init', { seed: this.seed });
    this.hud.setLoading(0.08, 'Gerando o mapa…');
    const texSize = this.settings.get('textureSize') >= 256 ? 256 : this.settings.get('textureSize') <= 64 ? 128 : 256;
    const [map, assets] = await Promise.all([
      this.pool.run('generateMap', {}),
      loadAssets(this.pool, texSize, (p) => this.hud.setLoading(0.1 + p * 0.6, 'Sintetizando materiais PBR…')),
    ]);
    this.map = map;
    this.hud.setLoading(0.75, 'Construindo o mundo…');
    await new Promise((r) => setTimeout(r, 30));
    this.materials = createMaterials(assets);
    this.world = new World(this, map, assets);
    this.trees = new TreeSystem(this, map.trees);
    for (const t of this.trees.trees) this.world.path.markCircle(t.x, t.z, 0.6, 1);
    if (this.settings.get('preset') !== 'low') this.cover = new GroundCover(this, map.splat, map.size + 1);
    this.particles = new ParticleSystem(e.pipeline, { world: null, max: 3000 });
    this.particles.dust = (x, y, z, n = 12, spread = 2, alpha = 0.35) => {
      for (let k = 0; k < n; k++) {
        this.particles.emit({
          position: [x + (Math.random() - 0.5) * spread, y + 0.3, z + (Math.random() - 0.5) * spread],
          velocity: [(Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5],
          life: 2 + Math.random() * 1.5, size: 0.5 + Math.random() * 0.5, grow: 2.2, drag: 0.8,
          color: [0.5, 0.44, 0.35, alpha],
        });
      }
    };
    this.sim = new Simulation(this);
    this.renderer = new GameRenderer(this);
    this.audio = new RTSAudio(this);
    this.audio.volume = this.settings.get('volume');
    this.cam = new RTSCamera(e.camera, {
      heightAt: (x, z) => this.world.heightAt(x, z), bounds: { minX: 4, minZ: 4, maxX: MAP_SIZE - 4, maxZ: MAP_SIZE - 4 }, wasd: false, viewBias: 0.12,
    });
    this.controls = new Controls(this);
    this.hud.buildMinimapBase(map);
    e.pipeline.setWorldMask(this.sim.fowTex, 0, 0, MAP_SIZE, MAP_SIZE, 0.5);
    if (this.params.has('reveal')) this.sim.revealAll = true;
    this._setupPlayers();
    this.ai = new AIPlayer(this, 1, this.difficulty);

    const tc = this.sim.buildings.find((b) => b.owner === 0 && b.kind === 'town_center');
    // face the map centre; shift the target toward the camera so the TC sits above the HUD
    const yaw = Math.atan2(MAP_SIZE / 2 - tc.x, MAP_SIZE / 2 - tc.z) + Math.PI;
    this.cam.yaw = this.cam.goalYaw = yaw;
    this.cam.distance = this.cam.goalDistance = 62;
    this.cam.jumpTo(tc.x + Math.sin(yaw) * 6, tc.z + Math.cos(yaw) * 6);

    e.addSystem({ update: (dt) => this.update(dt) });
    e.on('postRender', (dt) => this._postRender(dt));
    if (!e.running) e.start();
    this.hud.setLoading(1, 'Pronto');
    this.hud.hideLoading();
    this.started = true;
    window.worldReady = true;
    this.hud.notice('Colete recursos e expanda seu reino!', 4000);
    const startAudio = () => { this.audio.start(); this.audio.setVolume(this.settings.get('volume')); window.removeEventListener('pointerdown', startAudio); };
    window.addEventListener('pointerdown', startAudio);
  }

  _setupPlayers() {
    const sim = this.sim;
    this.map.starts.forEach((s, owner) => {
      const tc = sim.placeBuilding('town_center', owner, Math.round(s.x), Math.round(s.z), { built: true, free: true });
      const around = (k, r) => {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        return [tc.x + Math.cos(a) * r, tc.z + Math.sin(a) * r];
      };
      for (let k = 0; k < 3; k++) { const [x, z] = around(k, 10); sim.addUnit('villager', owner, x, z); }
      const [sx, sz] = around(3, 11);
      sim.addUnit('scout', owner, sx, sz);
    });
    for (const r of this.map.resources) sim.addResource(r.type, r.x, r.z);
    for (const a of this.map.animals) sim.addUnit(a.type, -1, a.x, a.z);
  }

  // ------------------------------------------------------------------ actions
  trainFromSelection(kind) {
    const b = this.controls.selection.find((e) => e.isBuilding && e.def.train?.includes(kind));
    if (!b) return;
    const r = this.sim.train(b, kind);
    if (r === 'cost') { this.hud.notice(`Recursos insuficientes para ${UNITS[kind].label}`); this.audio.error(); }
    else if (r === 'age') { this.hud.notice(`${UNITS[kind].label} requer ${AGES[UNITS[kind].age].name}`); this.audio.error(); }
    else if (r === 'ok') this.audio.select(b);
  }

  ageUpSelection() {
    const b = this.controls.selection.find((e) => e.kind === 'town_center');
    if (!b) return;
    const r = this.sim.ageUp(b);
    if (r === 'cost') { this.hud.notice('Recursos insuficientes para avançar de era'); this.audio.error(); }
    else if (r === 'ok') this.hud.notice(`Pesquisando ${AGES[this.sim.players[0].age + 1].name}…`);
  }

  deleteSelection() {
    for (const e of this.controls.selection) {
      if (e.owner !== 0) continue;
      if (e.isUnit) this.sim.killUnit(e);
      else if (e.isBuilding) {
        if (!e.built) this.sim.players[0].refund(e.def.cost, 1 - e.progress);
        this.sim.destroyBuilding(e);
      }
    }
    this.controls.setSelection([]);
  }

  pause(on) {
    this.paused = on;
    if (!on) { this.hud.hideScreen(); return; }
    const s = this.hud.showScreen(`
      <div class="menu small"><div class="logo">Pausado</div>
        <div class="panel">
          <button id="pResume" class="primary">Continuar</button>
          <label>Velocidade do jogo<select id="pSpeed"><option value="1">Lenta (1.0×)</option><option value="1.6">Normal (1.6×)</option><option value="2.2">Rápida (2.2×)</option></select></label>
          <label>Volume<input id="pVol" type="range" min="0" max="1" step="0.05" value="${this.settings.get('volume')}"/></label>
          <label>Hora do dia<input id="pTime" type="range" min="5" max="20" step="0.25" value="${this.engine.atmosphere.hours}"/></label>
          <label><span>Revelar mapa</span><input id="pReveal" type="checkbox" ${this.sim.revealAll ? 'checked' : ''}/></label>
          <button id="pRestart">Nova partida</button>
        </div></div>`, 'menuScreen dim');
    s.querySelector('#pSpeed').value = String(this.speed);
    s.querySelector('#pResume').onclick = () => this.pause(false);
    s.querySelector('#pSpeed').onchange = (ev) => { this.speed = Number(ev.target.value); };
    s.querySelector('#pVol').oninput = (ev) => { this.settings.set('volume', Number(ev.target.value)); this.audio.setVolume(Number(ev.target.value)); };
    s.querySelector('#pTime').oninput = (ev) => { this.engine.atmosphere.hours = Number(ev.target.value); };
    s.querySelector('#pReveal').onchange = (ev) => { this.sim.revealAll = ev.target.checked; this.sim.fowT = 0; };
    s.querySelector('#pRestart').onclick = () => location.reload();
  }

  // ------------------------------------------------------------------ hooks
  onBuildingComplete(b) {
    if (b.owner === 0) { this.audio.bell(); this.hud.notice(`${b.def.label} concluído(a)`); }
  }
  onUnitTrained(u) { if (u.owner === 0) this.audio.select(u); }
  onAgeUp(owner, age) {
    if (owner === 0) { this.audio.fanfare(); this.hud.notice(`Você avançou para a ${AGES[age].name}!`, 4000); }
    else this.hud.notice(`O inimigo avançou para a ${AGES[age].name}`, 3000);
  }
  onDamaged(t, from) {
    if (t.owner === 0 && from && from.owner === 1) {
      if (this.audio._throttle('underAttack', 15000)) {
        this.audio.horn(true);
        this.hud.notice(t.isBuilding ? 'Suas construções estão sendo atacadas!' : 'Você está sendo atacado!', 3000);
        this.lastAlert = { x: t.x, z: t.z };
      }
    }
  }
  onGatherTick() {}
  onBuildTick() {}

  /** Short-lived debris (wood chips, sparks, clods). */
  _chips(x, y, z, color, n, speed = 2, size = 0.05, emissive = 0) {
    for (let k = 0; k < n; k++) {
      this.particles.emit({
        position: [x, y, z],
        velocity: [(Math.random() - 0.5) * speed, speed * (0.5 + Math.random() * 0.6), (Math.random() - 0.5) * speed],
        gravity: 9, drag: 0.4, life: 0.45 + Math.random() * 0.45, size: size * (0.7 + Math.random() * 0.6),
        spin: (Math.random() - 0.5) * 12, color, emissive,
      });
    }
  }

  /** A work blow lands (synchronised with the animation): sound and debris at the point of contact. */
  onStrike(u, kind, t) {
    if (!this.sim.isVisibleTo(0, u.x, u.z)) return;
    const fx = u.x + Math.sin(u.heading) * 0.75, fz = u.z + Math.cos(u.heading) * 0.75;
    switch (kind) {
      case 'chop': {
        this.audio.chop(u.x, u.z);
        const standing = t && t.state === 'standing';
        this._chips(fx, u.y + (standing ? 1.0 : 0.35), fz, [0.8, 0.64, 0.42, 1], 5, 2.2, 0.045);
        if (standing) {
          this.trees.shake(t, u.x, u.z);
          // a few leaves shaken loose from the crown drift down
          for (let k = 0; k < 2; k++) {
            this.particles.emit({
              position: [t.x + (Math.random() - 0.5) * 3, t.y + (t.height || 8) * (0.55 + Math.random() * 0.3), t.z + (Math.random() - 0.5) * 3],
              velocity: [(Math.random() - 0.5) * 0.8, -0.2, (Math.random() - 0.5) * 0.8], gravity: 0.35, drag: 1.5, life: 3.5,
              size: 0.08, spin: 3, color: [0.34, 0.44, 0.16, 1],
            });
          }
        }
        break;
      }
      case 'gold': case 'stone':
        this.audio.mine(u.x, u.z);
        if (kind === 'gold') this._chips(fx, u.y + 0.5, fz, [1, 0.78, 0.3, 1], 4, 2.6, 0.03, 8);
        this._chips(fx, u.y + 0.5, fz, kind === 'gold' ? [0.58, 0.5, 0.32, 1] : [0.62, 0.6, 0.57, 1], 3, 1.8, 0.05);
        break;
      case 'hammer':
        this.audio.hammer(u.x, u.z);
        this._chips(fx, u.y + 0.8, fz, [0.72, 0.62, 0.48, 0.8], 2, 1.2, 0.04);
        break;
      case 'berry':
        this.audio.forage(u.x, u.z);
        if (Math.random() < 0.5) this._chips(fx, u.y + 0.7, fz, [0.3, 0.42, 0.15, 1], 1, 0.8, 0.05);
        break;
      case 'farm':
        this.audio.hoe(u.x, u.z);
        this._chips(fx, u.y + 0.1, fz, [0.36, 0.27, 0.18, 1], 3, 1.4, 0.05);
        break;
      case 'carcass':
        this.audio.butcher(u.x, u.z);
        break;
      default:
    }
  }
  onMeleeHit(u, t) {
    if (!this.sim.isVisibleTo(0, t.x, t.z)) return;
    const metal = t.isUnit && !t.isAnimal && !t.isVillager && !u.isVillager;
    if (t.isBuilding) this.audio.thud(u.x, u.z, 0.8);
    else if (metal) this.audio.clash(t.x, t.z);
    else this.audio.thud(t.x, t.z, t.isAnimal ? 0.7 : 1);
    const y = t.isBuilding ? u.y + 1 : t.y + (t.isAnimal ? 0.6 : 1.1);
    const x = t.isBuilding ? u.x + Math.sin(u.heading) * 0.8 : t.x, z = t.isBuilding ? u.z + Math.cos(u.heading) * 0.8 : t.z;
    if (metal) this._chips(x, y, z, [1, 0.85, 0.5, 1], 3, 2.4, 0.025, 7);
    this.particles.emit({ position: [x, y, z], velocity: [0, 0.3, 0], life: 0.6, size: 0.3, grow: 1.5, drag: 1, color: [0.55, 0.5, 0.42, 0.25] });
  }
  onWhiff(u) { if (this.sim.isVisibleTo(0, u.x, u.z)) this.audio.whiff(u.x, u.z); }
  onFire(from, kind) {
    if (!this.sim.isVisibleTo(0, from.x, from.z)) return;
    if (kind === 'spear') this.audio.spearThrow(from.x, from.z); else this.audio.bowShot(from.x, from.z);
  }
  onProjectileHit(p, t) {
    if (t.isUnit && this.sim.isVisibleTo(0, t.x, t.z)) this.audio.thud(t.x, t.z, p.kind === 'spear' ? 0.9 : 0.35);
  }
  onUnitDied(u) {
    if (u.isAnimal && this.sim.isVisibleTo(0, u.x, u.z)) this.audio.thud(u.x, u.z, 0.6);
  }
  onHerdConverted(a, from, to) {
    if (to === 0) {
      this.audio.baa(a.x, a.z);
      if (this.audio._throttle('herdMsg', 25000)) this.hud.notice('Ovelhas reunidas! Leve-as para perto do Centro da Cidade.', 3500);
    } else if (from === 0 && this.audio._throttle('herdLost', 12000)) {
      this.hud.notice('O inimigo levou uma das suas ovelhas!', 3000);
      this.audio.error();
    }
  }
  onFarmReseeded(b) {
    if (b.owner === 0 && this.audio._throttle('reseed', 5000)) this.hud.notice('Fazenda replantada (−60 de madeira)');
  }
  onFarmExhausted(b) {
    if (b.owner === 0) { this.hud.notice('Uma fazenda se esgotou: falta madeira para replantar', 3000); this.audio.error(); }
  }
  onRepaired(b) {
    if (b.owner === 0 && this.audio._throttle('repaired', 3000)) this.hud.notice(`${b.def.label} reparado(a)`);
  }
  onRepairStalled(u, b, res) {
    if (u.owner === 0 && this.audio._throttle('repairStall', 4000)) { this.hud.notice(`Sem ${RES_LABEL[res].toLowerCase()} para continuar o reparo`); this.audio.error(); }
  }
  onDeposit(u, b, res, amount) {
    if (u.owner !== 0 || !amount || !this.sim.isVisibleTo(0, u.x, u.z)) return;
    const css = { food: '#ff9a7a', wood: '#e8b77a', gold: '#ffd84a', stone: '#d6d0c6' }[res] || '#fff';
    this.hud.floatText(u.x, u.y + 0.6, u.z, `+${Math.floor(amount)} ${RES_LABEL[res].toLowerCase()}`, css);
  }
  onBuildingDestroyed(b) { if (this.sim.isVisibleTo(0, b.x, b.z) || b.owner === 0) this.audio.collapse(b.x, b.z); }
  onResourceDepleted() {}
  onGameOver(winner) {
    const p = this.sim.players[0];
    const won = winner === 0;
    this.audio[won ? 'fanfare' : 'horn'](true);
    const s = this.hud.showScreen(`
      <div class="menu"><div class="logo ${won ? 'win' : 'lose'}">${won ? 'Vitória!' : 'Derrota'}</div>
        <div class="sub">${won ? 'Seu reino prevaleceu.' : 'Seu reino caiu.'} Tempo de jogo: ${Math.floor(this.sim.time / 60)} min</div>
        <div class="panel stats">
          ${Object.keys(p.gathered).map((r) => `<div><span>${RES_LABEL[r]} ${r === 'gold' ? 'coletado' : 'coletada'}</span><b>${Math.floor(p.gathered[r])}</b></div>`).join('')}
          <div><span>Unidades inimigas abatidas</span><b>${p.stats.unitsKilled}</b></div>
          <div><span>Unidades perdidas</span><b>${p.stats.unitsLost}</b></div>
          <div><span>Construções erguidas</span><b>${p.stats.buildingsBuilt}</b></div>
          <button id="goAgain" class="primary">Jogar novamente</button>
        </div></div>`, 'menuScreen dim');
    s.querySelector('#goAgain').onclick = () => location.reload();
  }

  // ------------------------------------------------------------------ loop
  update(dt) {
    if (!this.started) return;
    const e = this.engine;
    this.cam.update(dt, e.input, { x: 0, y: 0, w: innerWidth, h: innerHeight - (this.paused ? 0 : 0) });
    this.world.update(this.cam.target);
    if (!this.paused) {
      const sdt = Math.min(dt, 0.1) * this.speed;
      // sub-step the simulation for stability at high speeds
      const steps = Math.ceil(sdt / 0.06);
      for (let k = 0; k < steps; k++) {
        this.sim.update(sdt / steps);
        this.ai.update(sdt / steps);
      }
      this.trees.update(sdt);
      this._fx(sdt);
    }
    this.renderer.update(dt);
    this.particles.update(dt, e.camera.position);
    this.controls.update();
    this._hudT = (this._hudT || 0) - dt;
    if (this._hudT <= 0) { this._hudT = 0.1; this.hud.update(); }
    this.audio.ambient(dt);
    e.pipeline.cameraSkyLight = 1;
    e.pipeline.heldLight = 0;
  }

  _fx(dt) {
    // burning damaged buildings
    for (const b of this.sim.buildings) {
      if (!b.built || b.hp > b.maxHp * 0.55) continue;
      if (b.owner !== 0 && !this.sim.isVisibleTo(0, b.x, b.z)) continue;
      const k = 1 - b.hp / b.maxHp;
      if (Math.random() < dt * 14 * k) {
        const x = b.x + (Math.random() - 0.5) * b.size * 0.6, z = b.z + (Math.random() - 0.5) * b.size * 0.6;
        this.particles.emit({ position: [x, b.y + 2 + Math.random() * 3, z], velocity: [0.3, 2.2, 0.2], life: 3.5, size: 0.8, grow: 3, drag: 0.4, color: [0.12, 0.11, 0.1, 0.55] });
        this.particles.emit({ position: [x, b.y + 1.5 + Math.random() * 2, z], velocity: [0, 1.6, 0], life: 0.7, size: 0.45, grow: -0.5, color: [1, 0.45, 0.12, 0.9], emissive: 12 });
      }
    }
    // chimney smoke from houses
    for (const b of this.sim.buildings) {
      if (b.kind !== 'house' || !b.built || Math.random() > dt * 1.2) continue;
      if (b.owner !== 0 && !this.sim.isVisibleTo(0, b.x, b.z)) continue;
      this.particles.emit({ position: [b.x - 1.5, b.y + 5.9, b.z - 1.1], velocity: [0.35, 0.8, 0.1], life: 6, size: 0.35, grow: 4, drag: 0.2, color: [0.5, 0.5, 0.5, 0.18] });
    }
  }

  _postRender(dt) {
    if (!this.started) return;
    this.hud.drawOverlay(dt);
    this._miniT = (this._miniT || 0) - dt;
    if (this._miniT <= 0) { this._miniT = 0.2; this.hud.drawMinimap(); }
  }
}

const game = new RTSGame();
window.game = game;
game.boot().catch((err) => console.error(err));
export { TEAMS };
