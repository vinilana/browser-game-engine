// Procedural sound design for "Reinos" (built on the engine's AudioEngine).
import { Vector3 } from 'three';
import { AudioEngine } from '../engine/audio/AudioEngine.js';

const _v = new Vector3();

export class RTSAudio extends AudioEngine {
  constructor(game) {
    super();
    this.game = game;
    this._last = new Map();
  }

  /** Volume + pan for a world position relative to the camera view. */
  _spatial(x, z) {
    const cam = this.game.engine.camera;
    const t = this.game.cam.target;
    const d = Math.hypot(x - t.x, z - t.z);
    const dist = this.game.cam.distance;
    const vol = Math.max(0, 1 - d / (dist * 1.6 + 30)) * (1.2 - Math.min(0.7, dist / 250));
    _v.set(x, this.game.world.heightAt(x, z), z).project(cam);
    return { vol, pan: Math.max(-1, Math.min(1, _v.x)) };
  }

  _throttle(key, gap) {
    const now = performance.now();
    if (now - (this._last.get(key) || 0) < gap) return false;
    this._last.set(key, now);
    return true;
  }

  chop(x, z) {
    if (!this.ctx) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.03) return;
    this._burst({ type: 'bandpass', freq: 700 + Math.random() * 200, q: 4, dur: 0.09, gain: 0.5 * vol, pan });
    this._tone({ freq: 190, dur: 0.06, gain: 0.12 * vol, sweep: -60, pan });
  }

  mine(x, z) {
    if (!this.ctx) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.03) return;
    this._tone({ freq: 2400 + Math.random() * 900, type: 'triangle', dur: 0.12, gain: 0.07 * vol, pan });
    this._burst({ type: 'highpass', freq: 2500, q: 0.8, dur: 0.05, gain: 0.3 * vol, pan });
  }

  hammer(x, z) {
    if (!this.ctx) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.03) return;
    this._burst({ type: 'bandpass', freq: 520, q: 5, dur: 0.07, gain: 0.45 * vol, pan });
    this._tone({ freq: 320, dur: 0.05, gain: 0.1 * vol, pan });
  }

  forage(x, z) {
    if (!this.ctx || !this._throttle('forage', 400)) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.05) return;
    this._burst({ type: 'bandpass', freq: 3000, q: 0.6, dur: 0.12, gain: 0.12 * vol, pan });
  }

  clash(x, z) {
    if (!this.ctx) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.03) return;
    const f = 1800 + Math.random() * 1500;
    this._tone({ freq: f, type: 'triangle', dur: 0.25, gain: 0.08 * vol, pan });
    this._tone({ freq: f * 1.51, type: 'sine', dur: 0.2, gain: 0.04 * vol, pan });
    this._burst({ type: 'highpass', freq: 3000, q: 0.7, dur: 0.06, gain: 0.3 * vol, pan });
  }

  bowShot(x, z) {
    if (!this.ctx) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.03) return;
    this._tone({ freq: 140, dur: 0.08, gain: 0.12 * vol, sweep: 60, pan });
    this._burst({ type: 'bandpass', freq: 1800, q: 1.2, dur: 0.25, gain: 0.18 * vol, pan, attack: 0.03 });
  }

  treeFall(x, z) {
    if (!this.ctx) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.03) return;
    // creak then thud
    this._tone({ freq: 90, type: 'sawtooth', dur: 0.9, gain: 0.03 * vol, sweep: 50, pan });
    this._burst({ buffer: this.brown, type: 'lowpass', freq: 220, q: 0.6, dur: 0.6, gain: 0.9 * vol, pan, when: 1.9 });
    this._burst({ type: 'bandpass', freq: 1400, q: 0.5, dur: 0.5, gain: 0.25 * vol, pan, when: 1.9 });
  }

  collapse(x, z) {
    if (!this.ctx) return;
    const { vol, pan } = this._spatial(x, z);
    this._burst({ buffer: this.brown, type: 'lowpass', freq: 180, q: 0.5, dur: 2.0, gain: 1.2 * Math.max(0.2, vol), pan });
    for (let k = 0; k < 10; k++) this._burst({ type: 'bandpass', freq: 600 + Math.random() * 1500, q: 1, dur: 0.1, gain: 0.2 * vol, pan, when: Math.random() * 1.2 });
  }

  bell() {
    if (!this.ctx) return;
    for (const [f, g] of [[523, 0.08], [1046, 0.04], [1568, 0.025], [2093, 0.015]]) this._tone({ freq: f, dur: 2.2, gain: g, attack: 0.005 });
  }

  horn(urgent = false) {
    if (!this.ctx) return;
    const base = urgent ? 196 : 262;
    for (const [m, d] of [[1, 0], [1.5, 0.28], [2, 0.56]]) {
      this._tone({ freq: base * m, type: 'sawtooth', dur: 0.4, gain: 0.035, attack: 0.05, when: d });
      this._tone({ freq: base * m * 1.005, type: 'square', dur: 0.4, gain: 0.015, attack: 0.05, when: d });
    }
  }

  fanfare() {
    if (!this.ctx) return;
    const notes = [392, 523, 659, 784, 1046];
    notes.forEach((f, i) => {
      this._tone({ freq: f, type: 'sawtooth', dur: i === notes.length - 1 ? 1.4 : 0.22, gain: 0.04, attack: 0.02, when: i * 0.18 });
      this._tone({ freq: f / 2, type: 'triangle', dur: i === notes.length - 1 ? 1.4 : 0.22, gain: 0.05, attack: 0.02, when: i * 0.18 });
    });
  }

  select(e) {
    if (!this.ctx) return;
    this._tone({ freq: e?.isBuilding ? 440 : 660, type: 'sine', dur: 0.06, gain: 0.05 });
    this._burst({ type: 'bandpass', freq: 2200, q: 2, dur: 0.03, gain: 0.08 });
  }

  ack(u, kind) {
    if (!this.ctx || !this._throttle('ack', 120)) return;
    const f = kind === 'attack' ? 330 : 550;
    this._tone({ freq: f, type: 'triangle', dur: 0.07, gain: 0.05 });
    this._tone({ freq: f * 1.5, type: 'triangle', dur: 0.07, gain: 0.04, when: 0.07 });
    if (u && !u.isVillager && kind === 'attack') this._tone({ freq: 2600, type: 'triangle', dur: 0.2, gain: 0.03, when: 0.02 });
  }

  error() {
    if (!this.ctx) return;
    this._tone({ freq: 150, type: 'square', dur: 0.18, gain: 0.04 });
  }

  place() {
    if (!this.ctx) return;
    this._burst({ buffer: this.brown, type: 'lowpass', freq: 240, q: 0.6, dur: 0.18, gain: 0.7 });
    this._burst({ type: 'bandpass', freq: 800, q: 2, dur: 0.08, gain: 0.25 });
  }

  /** Ambient bed follows the camera: wind stronger when zoomed out, birds by day, water near lakes. */
  ambient(dt) {
    const g = this.game;
    const s = this.state;
    s.day = g.engine.atmosphere.daylight;
    s.altitude = Math.min(1, g.cam.distance / 200);
    s.forest = 0.6;
    s.underground = 0;
    s.underwater = 0;
    let w = 0;
    for (const l of g.map.lakes) w = Math.max(w, 1 - Math.hypot(l.x - g.cam.target.x, l.z - g.cam.target.z) / (l.r + 40));
    s.water = Math.max(0, w);
    s.rain = g.engine.atmosphere.rain;
    this.update(dt, s);
  }
}
