// VoxelCraft — a realistic Minecraft-like open world built on the Aether Engine.
import { Vector3 } from 'three';
import { Engine } from '../engine/core/Engine.js';
import { Settings } from '../engine/core/Settings.js';
import { VoxelWorld } from '../engine/voxel/VoxelWorld.js';
import { ParticleSystem } from '../engine/fx/ParticleSystem.js';
import { Weather } from '../engine/fx/Weather.js';
import { AudioEngine } from '../engine/audio/AudioEngine.js';
import { RenderType } from '../engine/voxel/BlockRegistry.js';
import { registry, B } from './blocks.js';
import { seedFromString } from '../engine/math/rng.js';
import { Player } from './Player.js';
import { Interaction } from './Interaction.js';
import { UI } from './ui.js';
import { WorldStorage } from './storage.js';
import { WorldGenerator, SEA, Biome } from './worldgen.js';
import { Ambience } from './ambience.js';
import { Mobs } from './mobs.js';
import { FarTerrain } from '../engine/terrain/FarTerrain.js';
import { Hand } from './Hand.js';
import { Fluids } from './fluids.js';

const BIOME_NAMES = ['Oceano', 'Praia', 'Planície', 'Floresta', 'Floresta de Bétulas', 'Taiga', 'Tundra Nevada', 'Deserto', 'Montanhas', 'Rio', 'Oceano Congelado'];

class Game {
  constructor() {
    this.params = new URLSearchParams(location.search);
    this.started = false;
    this.registry = registry;
    this._dir = new Vector3();
    this._saveTimer = 20;
    this._timeFast = false;
  }

  async init() {
    const canvas = document.getElementById('game');
    this.settings = new Settings();
    if (this.params.get('quality')) this.settings.applyPreset(this.params.get('quality'));
    this.engine = new Engine({ canvas, settings: this.settings });
    let lastSeed = null;
    try { lastSeed = localStorage.getItem('aether.lastSeed'); } catch { /* ignore */ }
    const rawSeed = (this.params.get('seed') || lastSeed || '20260923').trim();
    this.seed = /^-?\d+$/.test(rawSeed) ? Number(rawSeed) | 0 : seedFromString(rawSeed) | 0;
    this.seedLabel = rawSeed;
    try { localStorage.setItem('aether.lastSeed', rawSeed); } catch { /* ignore */ }
    this.ui = new UI(this);
    this.ui.setProgress(0.02, 'Preparando o motor gráfico…');

    this.storage = new WorldStorage();
    await this.storage.init();
    const saved = this.params.has('fresh') ? null : await this.storage.load(this.seed);

    this.world = new VoxelWorld({
      pipeline: this.engine.pipeline,
      registry,
      seed: this.seed,
      viewDistance: this.settings.get('viewDistance'),
      textureSize: Number(this.params.get('tex') || this.settings.get('textureSize') || 128),
      fancyLeaves: this.settings.get('fancyLeaves') !== false,
      workerFactory: () => new Worker(new URL('./world.worker.js', import.meta.url), { type: 'module' }),
    });
    if (saved?.edits) this.world.edits = WorldStorage.deserializeEdits(saved.edits);
    window.engine = this.engine;
    window.world = this.world;
    await this.world.init((p, msg) => this.ui.setProgress(p * 0.9, msg));
    this.world.materials.common.uParallax.value = this.settings.get('parallax') ? 1 : 0;

    this.player = new Player(this.engine, this.world, registry);
    this.interaction = new Interaction(this);
    this.particles = new ParticleSystem(this.engine.pipeline, { world: this.world, textureArray: this.world.textures.albedo });
    this.weather = new Weather(this.engine.pipeline, this.world);
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.get('volume');
    this.ambience = new Ambience(this);
    this.mobs = new Mobs(this);
    this.hand = new Hand(this);
    this.fluids = new Fluids(this);
    this.generator = new WorldGenerator(this.seed);
    this.farTerrain = new FarTerrain({ pipeline: this.engine.pipeline, world: this.world, radius: this.settings.get('farDistance') });
    this._applyFar();

    this.player.onStep = (mat, vol) => this.audio.footstep(mat, vol);
    this.player.onLand = (speed, mat) => this.audio.footstep(mat, Math.min(2, speed / 8));
    this.player.onSplash = (s) => {
      this.audio.splash(s);
      const p = this.player.position;
      for (let i = 0; i < 30 * s; i++) {
        this.particles.emit({ position: [p.x + (Math.random() - 0.5), Math.floor(p.y) + 1.05, p.z + (Math.random() - 0.5)],
          velocity: [(Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3],
          life: 0.8, size: 0.05 + Math.random() * 0.05, gravity: 14, color: [0.7, 0.8, 0.9, 0.7] });
      }
    };
    this.weather.onLightning = () => {
      this._flash = 1;
      this.audio.thunder(Math.random());
    };
    this.world.on('blockChanged', () => this.weather.markDirty());

    if (saved?.time !== undefined) this.engine.atmosphere.timeOfDay = saved.time;
    else if (this.params.get('t')) this.engine.atmosphere.hours = Number(this.params.get('t'));
    else this.engine.atmosphere.hours = 9.5;
    if (saved?.rain) this.setRain(saved.rain);
    this.ui.buildHotbar(saved?.hotbar);

    // spawn
    const cam = this.engine.camera;
    if (saved?.player) {
      const sp = saved.player;
      this.player.spawnAt(sp.x, sp.y, sp.z);
      this.player.yaw = sp.yaw; this.player.pitch = sp.pitch; this.player.flying = !!sp.flying;
    } else {
      const s = this._findSpawnColumn();
      this.player.spawnAt(s.x + 0.5, 200, s.z + 0.5);
      this._needsSpawnY = true;
      this.player.yaw = 0.6;
      this.player.pitch = -0.05;
    }
    cam.position.copy(this.player.position).add(new Vector3(0, 1.62, 0));
    cam.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');

    this.engine.addSystem({ update: (dt) => this.update(dt) });
    this.engine.start();

    // wait for the area around the player
    await this._waitForSpawnArea();
    this.ui.setProgress(1, 'Pronto');
    this.ui.hideLoading();
    if (this.params.has('autostart')) {
      this.start();
      document.getElementById('menu').classList.add('hidden');
      document.getElementById('hud').classList.remove('hidden');
    } else {
      this.ui.showMenu(false);
    }
    window.worldReady = true;

    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
  }

  _findSpawnColumn() {
    const gen = new WorldGenerator(this.seed);
    const s = {};
    for (let r = 0; r < 4000; r += 16) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos(a * 0.785) * r), z = Math.round(Math.sin(a * 0.785) * r);
        gen.sample(x, z, s);
        if (s.h > SEA + 2 && s.h < SEA + 30 && (s.biome === Biome.PLAINS || s.biome === Biome.FOREST || s.biome === Biome.BIRCH_FOREST)) return { x, z };
      }
    }
    return { x: 0, z: 0 };
  }

  async _waitForSpawnArea() {
    const p = this.player.position;
    const target = 9;
    return new Promise((resolve) => {
      const check = () => {
        let ready = 0;
        const pcx = Math.floor(p.x / 32), pcz = Math.floor(p.z / 32);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const c = this.world.getColumn(pcx + dx, pcz + dz);
            if (c && c.meshVersion >= 0) ready++;
          }
        }
        this.ui.setProgress(0.9 + 0.1 * (ready / target), 'Gerando o mundo…');
        if (ready >= target) {
          if (this._needsSpawnY) {
            let y = this.world.getSurfaceY(Math.floor(p.x), Math.floor(p.z));
            // avoid spawning on a tree
            const top = this.world.getBlock(Math.floor(p.x), y, Math.floor(p.z));
            if (registry.renderType[top] === RenderType.CUTOUT) {
              for (let yy = y; yy > 0; yy--) {
                const b = this.world.getBlock(Math.floor(p.x), yy, Math.floor(p.z));
                if (b === B.grass_block || b === B.dirt || b === B.sand) { y = yy; break; }
              }
              const nx = p.x + 3;
              this.player.spawnAt(nx, y + 1.01, p.z);
            } else {
              this.player.spawnAt(p.x, y + 1.01, p.z);
            }
            this._needsSpawnY = false;
          }
          resolve();
        } else setTimeout(check, 100);
      };
      check();
    });
  }

  start() {
    this.started = true;
    this.audio.start();
    this.audio.setVolume(this.settings.get('volume'));
  }

  applySettings(key) {
    const s = this.settings;
    if (!key || key === 'viewDistance') this.world.setViewDistance(s.get('viewDistance'));
    if (!key || key === 'parallax') this.world.materials.common.uParallax.value = s.get('parallax') ? 1 : 0;
    if (!key || key === 'volume') this.audio.setVolume(s.get('volume'));
    if (!key || key === 'farTerrain' || key === 'farDistance') this._applyFar();
    if (!key || key === 'fancyLeaves') {
      const fl = s.get('fancyLeaves') !== false;
      if (fl !== this.world.fancyLeaves) { this.world.fancyLeaves = fl; this.world.remeshAll(); }
    }
  }

  _applyFar() {
    const on = !!this.settings.get('farTerrain');
    this.farTerrain.enabled = on;
    this.farTerrain.radius = this.settings.get('farDistance');
    for (const t of this.farTerrain.tiles.values()) if (t.mesh) t.mesh.visible = on;
    this.engine.pipeline.farDistance = on ? this.settings.get('farDistance') : 0;
  }

  setRain(v) {
    this.weather.target = v;
    this.ui.notice(v > 0.8 ? 'Tempestade chegando…' : v > 0 ? 'Começou a chover' : 'O tempo está abrindo');
  }

  biomeName() {
    const p = this.player.position;
    const s = this.generator.sample(Math.floor(p.x), Math.floor(p.z), {});
    return BIOME_NAMES[s.biome] || '?';
  }

  onBlockBroken(x, y, z, id) {
    this.hand?.onAction();
    const def = registry.get(id);
    this.audio.breakBlock(def?.sound || 'stone');
    const layer = registry.faceLayer[id * 6 + 4];
    const tint = registry.tint[id] ? [0.45, 0.62, 0.28] : [1, 1, 1];
    const n = registry.renderType[id] === RenderType.CROSS ? 10 : 26;
    for (let i = 0; i < n; i++) {
      this.particles.emit({
        position: [x + 0.15 + Math.random() * 0.7, y + 0.15 + Math.random() * 0.7, z + 0.15 + Math.random() * 0.7],
        velocity: [(Math.random() - 0.5) * 4, 1.5 + Math.random() * 3.5, (Math.random() - 0.5) * 4],
        life: 0.7 + Math.random() * 0.7, size: 0.05 + Math.random() * 0.07, gravity: 20, drag: 0.8, collide: true,
        spin: (Math.random() - 0.5) * 8,
        color: [...tint, 1],
        tex: [layer, Math.random() * 0.75, Math.random() * 0.75, 0.25],
      });
    }
    this.saveSoon();
  }

  onBlockPlaced(x, y, z, id) {
    this.hand?.onAction();
    this.audio.placeBlock(registry.get(id)?.sound || 'stone');
    this.saveSoon();
  }

  saveSoon() { this._saveTimer = Math.min(this._saveTimer, 3); }

  async save() {
    if (!this.player || !this.storage) return;
    const p = this.player.position;
    await this.storage.save(this.seed, {
      edits: WorldStorage.serializeEdits(this.world.edits),
      player: { x: p.x, y: p.y, z: p.z, yaw: this.player.yaw, pitch: this.player.pitch, flying: this.player.flying },
      hotbar: this.ui.hotbar,
      time: this.engine.atmosphere.timeOfDay,
      rain: this.weather.target,
    });
  }

  // ------------------------------------------------------------------------
  update(dt) {
    const e = this.engine;
    const input = e.input;
    const cam = e.camera;
    cam.getWorldDirection(this._dir);
    this.world.update(this.player.position, this._dir);
    this.farTerrain.update(this.player.position);

    if (this.started && input.locked && !this.ui.blocking) {
      if (input.wasPressed('KeyT')) {
        this._timeFast = !this._timeFast;
        e.atmosphere.timeScale = this._timeFast ? 60 : 1;
        this.ui.notice(this._timeFast ? 'Tempo acelerado (60×)' : 'Tempo normal');
      }
      if (input.wasPressed('KeyR')) this.setRain(this.weather.target > 0 ? 0 : 0.85);
      if (input.wasPressed('F2')) this._screenshot = true;
      if (input.wasPressed('F1')) document.getElementById('hud').classList.toggle('hidden');
    }
    if (this.started && !this.ui.blocking) this.player.update(dt);
    else this.player._updateCamera(dt);
    if (this.started) this.interaction.update(dt);
    this.ui.update();
    this.hand.update(dt);
    this.fluids.update(dt);
    this.mobs.update(dt);
    this.ambience.update(dt);
    this.weather.update(dt, cam.position);
    this.particles.update(dt, cam.position);

    // lightning flash
    this._flash = Math.max(0, (this._flash || 0) - dt * 3);
    e.pipeline.params.ambientBoost = 1.25 + this._flash * 8;

    this._saveTimer -= dt;
    if (this._saveTimer <= 0) { this._saveTimer = 20; this.save(); }
  }
}

const game = new Game();
window.game = game;
game.init().catch((err) => {
  console.error(err);
  const s = document.querySelector('#loading .status');
  if (s) s.textContent = 'Erro: ' + err.message;
});

// F2 screenshots are captured right after rendering (the drawing buffer is not preserved)
queueMicrotask(() => {
  const hook = () => {
    if (!game.engine) return requestAnimationFrame(hook);
    game.engine.on('postRender', () => {
      if (!game._screenshot) return;
      game._screenshot = false;
      game.engine.canvas.toBlob((b) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `voxelcraft-${Date.now()}.png`;
        a.click();
      });
    });
  };
  hook();
});

export { game, B };
