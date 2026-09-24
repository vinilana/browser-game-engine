// HTML overlay: loading screen, main/pause menu with settings, HUD (hotbar,
// crosshair, debug), creative inventory.
import { makeBlockIcon } from './icons.js';
import { QUALITY_PRESETS } from '../engine/core/Settings.js';

const DEFAULT_HOTBAR = ['grass_block', 'stone', 'oak_planks', 'cobblestone', 'glass', 'torch', 'oak_log', 'bricks', 'glowstone'];

const TIPS = [
  'Clique duplo em Espaço (ou F) para voar.',
  'Tochas iluminam cavernas — segure uma na mão para iluminar ao redor.',
  'Pressione E para abrir o inventário criativo.',
  'F3 mostra informações de depuração do motor.',
  'Use T para acelerar o tempo e ver o pôr do sol.',
  'Pressione R para alternar a chuva.',
];

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.hotbar = new Array(9).fill(0);
    this.selected = 0;
    this.blocking = false;
    this.inventoryOpen = false;
    this.debug = false;
    this.icons = new Map();
    this.root.innerHTML = `
      <div id="loading" class="screen">
        <div class="brand"><div class="logo">VOXELCRAFT</div><div class="sub">powered by Aether Engine</div></div>
        <div class="bar"><div class="fill"></div></div>
        <div class="status">Iniciando…</div>
        <div class="tip"></div>
      </div>
      <div id="menu" class="screen hidden">
        <div class="brand"><div class="logo">VOXELCRAFT</div><div class="sub">Um mundo aberto ultra-realista no navegador · Aether Engine</div></div>
        <div class="panel">
          <button id="play" class="primary">Jogar</button>
          <button id="settingsBtn">Configurações</button>
          <button id="controlsBtn">Controles</button>
          <div class="seedrow"><label>Semente</label><input id="seed" /><button id="newWorld">Novo mundo</button></div>
        </div>
        <div id="settings" class="panel wide hidden"></div>
        <div id="controls" class="panel wide hidden">
          <h3>Controles</h3>
          <div class="keys">
            <div><b>W A S D</b> mover</div><div><b>Mouse</b> olhar</div>
            <div><b>Espaço</b> pular / nadar</div><div><b>Espaço 2x / F</b> voar</div>
            <div><b>Shift</b> agachar / descer</div><div><b>Ctrl / W 2x</b> correr</div>
            <div><b>Clique esq.</b> quebrar</div><div><b>Clique dir.</b> colocar</div>
            <div><b>Clique meio</b> copiar bloco</div><div><b>1–9 / roda</b> selecionar</div>
            <div><b>E</b> inventário</div><div><b>F3</b> depuração</div>
            <div><b>T</b> acelerar tempo</div><div><b>R</b> chuva on/off</div>
            <div><b>F2</b> screenshot</div><div><b>Esc</b> pausar</div>
          </div>
        </div>
      </div>
      <div id="hud" class="hidden">
        <div id="crosshair"></div>
        <div id="blockname"></div>
        <div id="hotbar"></div>
        <div id="debug" class="hidden"></div>
        <div id="notice"></div>
      </div>
      <div id="inventory" class="screen hidden">
        <div class="panel wide inv">
          <h3>Inventário criativo</h3>
          <div id="invgrid"></div>
          <div class="hint">Clique num bloco para colocá-lo no slot selecionado (1–9). E ou Esc para fechar.</div>
        </div>
      </div>`;
    this.$ = (sel) => this.root.querySelector(sel);
    this.$('#loading .tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    this._bindMenu();
    this._buildSettings();
  }

  // ---------------------------------------------------------------- loading
  setProgress(p, msg) {
    this.$('#loading .fill').style.width = `${Math.round(p * 100)}%`;
    if (msg) this.$('#loading .status').textContent = msg;
  }

  hideLoading() {
    this.$('#loading').classList.add('fade');
    setTimeout(() => this.$('#loading').classList.add('hidden'), 600);
  }

  // ---------------------------------------------------------------- menu
  _bindMenu() {
    const g = this.game;
    this.$('#play').onclick = () => this.resume();
    this.$('#settingsBtn').onclick = () => { this.$('#settings').classList.toggle('hidden'); this.$('#controls').classList.add('hidden'); };
    this.$('#controlsBtn').onclick = () => { this.$('#controls').classList.toggle('hidden'); this.$('#settings').classList.add('hidden'); };
    this.$('#seed').value = String(g.seedLabel ?? g.seed);
    this.$('#newWorld').onclick = () => {
      const v = this.$('#seed').value.trim();
      const url = new URL(location.href);
      url.searchParams.set('seed', v || String(Math.floor(Math.random() * 1e9)));
      location.href = url.toString();
    };
    g.engine.input.onLockChange = (locked) => {
      if (locked) {
        this.$('#menu').classList.add('hidden');
        this.$('#hud').classList.remove('hidden');
      } else if (!this.inventoryOpen && g.started) {
        this.showMenu(true);
      }
    };
    window.addEventListener('keydown', (e) => {
      if (!g.started) return;
      if (e.code === 'KeyE' && !e.repeat) {
        if (this.inventoryOpen) this.closeInventory();
        else if (g.engine.input.locked) this.openInventory();
      } else if (e.code === 'Escape' && this.inventoryOpen) {
        this.closeInventory();
      } else if (e.code === 'F3') {
        e.preventDefault();
        this.debug = !this.debug;
        this.$('#debug').classList.toggle('hidden', !this.debug);
      }
    });
    this.$('#hotbar').addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    // clicking the game view while playing recaptures the mouse
    g.engine.canvas.addEventListener('click', () => {
      if (g.started && !g.engine.input.locked && !this.inventoryOpen && this.$('#menu').classList.contains('hidden')) g.engine.input.lock();
    });
  }

  showMenu(paused) {
    this.$('#menu').classList.remove('hidden');
    this.$('#play').textContent = paused ? 'Continuar' : 'Jogar';
    this.$('#hud').classList.add('hidden');
  }

  resume() {
    this.game.start();
    this.game.engine.input.lock();
  }

  _buildSettings() {
    const s = this.game.engine.settings;
    const el = this.$('#settings');
    const presets = Object.keys(QUALITY_PRESETS).map((k) => `<option value="${k}">${{ low: 'Baixa', medium: 'Média', high: 'Alta', ultra: 'Ultra' }[k]}</option>`).join('');
    el.innerHTML = `
      <h3>Configurações</h3>
      <div class="grid">
        <label>Qualidade</label><select data-k="preset">${presets}</select>
        <label>Distância de visão <span data-v="viewDistance"></span></label><input type="range" min="3" max="20" step="1" data-k="viewDistance" />
        <label>Horizonte distante (LOD)</label><input type="checkbox" data-k="farTerrain" />
        <label>Alcance do horizonte <span data-v="farDistance"></span></label><input type="range" min="600" max="3000" step="100" data-k="farDistance" />
        <label>Escala de resolução <span data-v="renderScale"></span></label><input type="range" min="0.4" max="1" step="0.05" data-k="renderScale" />
        <label>Campo de visão <span data-v="fov"></span></label><input type="range" min="55" max="100" step="1" data-k="fov" />
        <label>Sensibilidade <span data-v="sensitivity"></span></label><input type="range" min="0.2" max="3" step="0.05" data-k="sensitivity" />
        <label>Volume <span data-v="volume"></span></label><input type="range" min="0" max="1" step="0.05" data-k="volume" />
        <label>Sombras</label><select data-k="shadowMapSize"><option value="1024">1024</option><option value="2048">2048</option><option value="3072">3072</option></select>
        <label>Texturas (reinicia)</label><select data-k="textureSize"><option value="64">64 px</option><option value="128">128 px</option><option value="256">256 px</option></select>
        <label>Distância das sombras <span data-v="shadowDistance"></span></label><input type="range" min="60" max="320" step="10" data-k="shadowDistance" />
        <label>Nuvens</label><select data-k="clouds"><option value="0">Desligadas</option><option value="1">Rápidas</option><option value="2">Volumétricas HQ</option></select>
        <label>SSAO</label><input type="checkbox" data-k="ssao" />
        <label>Luz volumétrica</label><input type="checkbox" data-k="volumetrics" />
        <label>Anti-aliasing temporal</label><input type="checkbox" data-k="taa" />
        <label>Bloom</label><input type="checkbox" data-k="bloom" />
        <label>Parallax (relevo)</label><input type="checkbox" data-k="parallax" />
        <label>Folhagem volumosa</label><input type="checkbox" data-k="fancyLeaves" />
        <label>Hora do dia <span id="timeLabel"></span></label><input type="range" min="0" max="24" step="0.1" id="timeSlider" />
        <label>Clima</label><select id="weatherSel"><option value="0">Limpo</option><option value="0.6">Chuva</option><option value="1">Tempestade</option></select>
      </div>`;
    const refresh = () => {
      el.querySelectorAll('[data-k]').forEach((inp) => {
        const k = inp.dataset.k;
        const v = s.get(k);
        if (inp.type === 'checkbox') inp.checked = !!v;
        else inp.value = String(v);
      });
      el.querySelectorAll('[data-v]').forEach((sp) => {
        const k = sp.dataset.v;
        const v = s.get(k);
        sp.textContent = k === 'viewDistance' ? `${v} (${v * 32} m)` : k === 'farDistance' ? `${(v / 1000).toFixed(1)} km` : k === 'renderScale' ? `${Math.round(v * 100)}%` : k === 'volume' ? `${Math.round(v * 100)}%` : String(v);
      });
    };
    el.addEventListener('input', (e) => {
      const inp = e.target;
      if (inp.id === 'timeSlider') {
        this.game.engine.atmosphere.hours = Number(inp.value);
        this.$('#timeLabel').textContent = this._fmtTime();
        return;
      }
      if (inp.id === 'weatherSel') { this.game.setRain(Number(inp.value)); return; }
      const k = inp.dataset.k;
      if (!k) return;
      if (k === 'preset') { s.applyPreset(inp.value); this.game.applySettings(); refresh(); return; }
      let v = inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' ? Number(inp.value) : Number(inp.value);
      s.set(k, v);
      this.game.applySettings(k);
      refresh();
    });
    this._refreshSettings = refresh;
    refresh();
    const ts = this.$('#timeSlider');
    ts.value = String(this.game.engine.atmosphere.hours);
    this.$('#timeLabel').textContent = this._fmtTime();
  }

  _fmtTime() {
    const h = this.game.engine.atmosphere.hours;
    return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------- hotbar
  buildHotbar(saved) {
    const { world, registry } = this.game;
    const names = saved && saved.length === 9 ? saved : DEFAULT_HOTBAR;
    this.hotbar = names.map((n) => (typeof n === 'number' ? n : registry.byName.get(n) || 0));
    const bar = this.$('#hotbar');
    bar.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = `<span class="num">${i + 1}</span>`;
      bar.appendChild(slot);
    }
    this._renderHotbar();
    this._buildInventory();
  }

  icon(id) {
    if (!this.icons.has(id)) this.icons.set(id, makeBlockIcon(this.game.world, id, 64));
    return this.icons.get(id);
  }

  _renderHotbar() {
    const slots = this.$('#hotbar').children;
    for (let i = 0; i < 9; i++) {
      const s = slots[i];
      s.classList.toggle('sel', i === this.selected);
      const old = s.querySelector('canvas');
      if (old) old.remove();
      const id = this.hotbar[i];
      if (id) {
        const c = this.icon(id);
        const copy = document.createElement('canvas');
        copy.width = c.width; copy.height = c.height;
        copy.getContext('2d').drawImage(c, 0, 0);
        s.appendChild(copy);
      }
    }
  }

  selectedBlock() { return this.hotbar[this.selected]; }

  select(i) {
    this.selected = ((i % 9) + 9) % 9;
    this._renderHotbar();
    const id = this.hotbar[this.selected];
    const name = id ? this.game.registry.get(id).label : '';
    const bn = this.$('#blockname');
    bn.textContent = name;
    bn.classList.remove('show');
    void bn.offsetWidth;
    if (name) bn.classList.add('show');
    this.game.onSelectionChanged?.();
  }

  pickBlock(id) {
    const def = this.game.registry.get(id);
    if (!def || def.creative === false) return;
    const existing = this.hotbar.indexOf(id);
    if (existing >= 0) { this.select(existing); return; }
    this.hotbar[this.selected] = id;
    this.select(this.selected);
  }

  // ---------------------------------------------------------------- inventory
  _buildInventory() {
    const grid = this.$('#invgrid');
    grid.innerHTML = '';
    const reg = this.game.registry;
    reg.defs.forEach((d, id) => {
      if (!id || d.creative === false || d.render === 0) return;
      const cell = document.createElement('button');
      cell.className = 'cell';
      cell.title = d.label;
      const c = this.icon(id);
      const copy = document.createElement('canvas');
      copy.width = c.width; copy.height = c.height;
      copy.getContext('2d').drawImage(c, 0, 0);
      cell.appendChild(copy);
      cell.onclick = () => {
        this.hotbar[this.selected] = id;
        this.select(this.selected);
        this.game.saveSoon();
      };
      grid.appendChild(cell);
    });
  }

  openInventory() {
    this.inventoryOpen = true;
    this.blocking = true;
    this.$('#inventory').classList.remove('hidden');
    this.game.engine.input.unlock();
  }

  closeInventory() {
    this.inventoryOpen = false;
    this.blocking = false;
    this.$('#inventory').classList.add('hidden');
    this.game.engine.input.lock();
  }

  notice(text, ms = 1800) {
    const n = this.$('#notice');
    n.textContent = text;
    n.classList.add('show');
    clearTimeout(this._noticeT);
    this._noticeT = setTimeout(() => n.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------------- per frame
  update() {
    const g = this.game;
    const input = g.engine.input;
    if (input.locked && !this.blocking) {
      for (let i = 0; i < 9; i++) if (input.wasPressed(`Digit${i + 1}`)) this.select(i);
      if (input.wheel) this.select(this.selected + input.wheel);
    }
    if (this.debug && g.engine.frame % 10 === 0) this._updateDebug();
  }

  _updateDebug() {
    const g = this.game;
    const e = g.engine;
    const p = g.player.position;
    const st = e.pipeline.stats;
    const ws = g.world.stats;
    const cam = e.camera;
    const light = g.world.getLight(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z));
    const dir = ['S', 'O', 'N', 'L'][Math.round(((((-g.player.yaw) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4];
    this.$('#debug').innerHTML = `
      <b>Aether Engine</b> · VoxelCraft<br/>
      ${e.fps.toFixed(0)} FPS · ${(e.frameTime * 1000).toFixed(1)} ms · ${e.pipeline.width}×${e.pipeline.height}<br/>
      Draw calls: ${st.drawCalls} · Triângulos: ${(st.triangles / 1e6).toFixed(2)} M<br/>
      XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)} · ${dir}<br/>
      Chunk: ${Math.floor(p.x / 32)}, ${Math.floor(p.z / 32)} · Bioma: ${g.biomeName()}<br/>
      Luz: céu ${light >> 4} · bloco ${light & 15}<br/>
      Colunas: ${ws.columns} (${ws.meshed} com malha) · Vértices: ${(ws.vertices / 1e6).toFixed(2)} M · Fila: ${ws.pending}<br/>
      Hora: ${this._fmtTime()} · Chuva: ${(e.atmosphere.rain * 100).toFixed(0)}% · ${g.player.flying ? 'Voando' : 'Andando'}<br/>
      Sombras: ${e.settings.get('shadowCascades')} cascatas ${e.settings.get('shadowMapSize')}px · ${e.settings.get('shadowDistance')} m`;
  }
}
