// Environment sensing (caves, water, forests) that drives the renderer,
// procedural audio and ambient particles (fireflies, falling leaves, torch
// flames/smoke, underwater bubbles, dust).
import { RenderType } from '../engine/voxel/BlockRegistry.js';
import { B } from './blocks.js';

export class Ambience {
  constructor(game) {
    this.game = game;
    this.torches = [];
    this._scanTimer = 0;
    this._senseTimer = 0;
    this._leafTimer = 0;
    this._flyTimer = 0;
    this.water = 0;
    this.forest = 0;
    this.underground = 0;
    this.leafBlocks = [];
  }

  _scan() {
    const { world } = this.game;
    const p = this.game.engine.camera.position;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    const torches = [];
    const leaves = [];
    let water = 0, total = 0, leafCount = 0;
    const R = 14, RY = 8;
    for (let y = py - RY; y <= py + RY; y++) {
      for (let z = pz - R; z <= pz + R; z++) {
        for (let x = px - R; x <= px + R; x++) {
          const id = world.getBlock(x, y, z);
          if (id === 0) continue;
          if (id === B.torch) torches.push([x, y, z]);
          else if (id === B.water) water++;
          else if (id === B.oak_leaves || id === B.birch_leaves || id === B.spruce_leaves) {
            leafCount++;
            if (leaves.length < 400 && world.getBlock(x, y - 1, z) === 0) leaves.push([x, y, z, id]);
          }
          total++;
        }
      }
    }
    this.torches = torches;
    this.leafBlocks = leaves;
    this.water = Math.min(1, water / 300);
    this.forest = Math.min(1, leafCount / 500);
  }

  update(dt) {
    const g = this.game;
    const { world, engine, particles, registry } = g;
    const pipe = engine.pipeline;
    const cam = engine.camera.position;
    const atmo = engine.atmosphere;

    this._scanTimer -= dt;
    if (this._scanTimer <= 0) { this._scanTimer = 1.0; this._scan(); }

    // --- renderer environment -------------------------------------------
    const light = world.getLight(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z));
    const sky = (light >> 4) / 15;
    pipe.cameraSkyLight = sky;
    this.underground += ((sky < 0.35 ? 1 : 0) - this.underground) * Math.min(1, dt * 0.8);
    const underwater = g.player.headInWater;
    pipe.underwater = underwater;
    if (underwater) {
      let y = Math.floor(cam.y);
      while (y < 255 && registry.liquid[world.getBlock(Math.floor(cam.x), y + 1, Math.floor(cam.z))]) y++;
      pipe.waterSurfaceY = y + 0.9;
    }
    const held = g.ui.selectedBlock();
    pipe.heldLight = held ? registry.emission[held] / 15 : 0;

    // --- audio ---------------------------------------------------------------
    const s = g.audio.state;
    s.day = atmo.daylight;
    s.underground = this.underground;
    s.underwater = underwater ? 1 : 0;
    s.water = this.water;
    s.rain = atmo.rain;
    s.altitude = Math.max(0, Math.min(1, (cam.y - 70) / 90));
    s.forest = this.forest;
    s.fire = Math.min(1, (light & 15) / 12) * (this.torches.length > 0 ? 1 : 0);
    g.audio.update(dt, s);

    if (!particles) return;
    // --- torch flames & smoke -------------------------------------------------
    for (const [x, y, z] of this.torches) {
      if (Math.random() < dt * 6) {
        particles.emit({ position: [x + 0.5 + (Math.random() - 0.5) * 0.05, y + 0.72, z + 0.5 + (Math.random() - 0.5) * 0.05],
          velocity: [(Math.random() - 0.5) * 0.08, 0.35 + Math.random() * 0.2, (Math.random() - 0.5) * 0.08],
          life: 0.35, size: 0.07, color: [1.0, 0.55, 0.18, 0.9], emissive: 6, grow: -0.6 });
      }
      if (Math.random() < dt * 2.5) {
        particles.emit({ position: [x + 0.5, y + 0.85, z + 0.5],
          velocity: [(Math.random() - 0.5) * 0.15, 0.6 + Math.random() * 0.3, (Math.random() - 0.5) * 0.15],
          life: 2.2, size: 0.07, grow: 2.5, color: [0.25, 0.25, 0.25, 0.35], drag: 0.4 });
      }
    }

    // --- falling leaves --------------------------------------------------------
    this._leafTimer -= dt;
    const windy = 1 + atmo.rain * 2;
    if (this._leafTimer <= 0 && this.leafBlocks.length) {
      this._leafTimer = 0.25 / windy;
      const [x, y, z, id] = this.leafBlocks[Math.floor(Math.random() * this.leafBlocks.length)];
      const layer = registry.faceLayer[id * 6 + 2];
      const tint = id === B.oak_leaves ? [0.45, 0.6, 0.25] : [1, 1, 1];
      particles.emit({ position: [x + Math.random(), y - 0.05, z + Math.random()],
        velocity: [0.6 * windy, -0.6, 0.25 * windy], life: 7, size: 0.09, gravity: 0.15, drag: 0.6, collide: true,
        spin: (Math.random() - 0.5) * 3, color: [...tint, 1], tex: [layer, 0.3 + Math.random() * 0.3, 0.3 + Math.random() * 0.3, 0.14] });
    }

    // --- fireflies at night / dust by day ---------------------------------------
    this._flyTimer -= dt;
    if (this._flyTimer <= 0) {
      this._flyTimer = 0.12;
      const night = 1 - atmo.daylight;
      if (night > 0.6 && sky > 0.8 && atmo.rain < 0.2 && !underwater) {
        const x = cam.x + (Math.random() - 0.5) * 30, z = cam.z + (Math.random() - 0.5) * 30;
        const gy = world.getSurfaceY(Math.floor(x), Math.floor(z));
        const top = world.getBlock(Math.floor(x), gy, Math.floor(z));
        if (gy > 0 && (top === B.grass_block || registry.renderType[world.getBlock(Math.floor(x), gy + 1, Math.floor(z))] === RenderType.CROSS)) {
          particles.emit({ position: [x, gy + 1.3 + Math.random() * 1.8, z],
            velocity: [(Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6],
            life: 4 + Math.random() * 4, size: 0.035, color: [0.75, 1.0, 0.35, 1], emissive: 60, drag: 0.05, fade: true });
        }
      }
      if (underwater && Math.random() < 0.5) {
        particles.emit({ position: [cam.x + (Math.random() - 0.5) * 2, cam.y - 0.5, cam.z + (Math.random() - 0.5) * 2],
          velocity: [0, 1.2, 0], gravity: -1.5, life: 2.5, size: 0.03, color: [0.8, 0.9, 1.0, 0.5] });
      }
    }
  }
}
