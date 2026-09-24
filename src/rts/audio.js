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

  /** Order acknowledgement: a short motif per verb so the ear confirms what was ordered. */
  ack(u, kind) {
    if (!this.ctx || !this._throttle('ack', 120)) return;
    const two = (f, g = 0.05, type = 'triangle') => {
      this._tone({ freq: f, type, dur: 0.07, gain: g });
      this._tone({ freq: f * 1.5, type, dur: 0.07, gain: g * 0.8, when: 0.07 });
    };
    switch (kind) {
      case 'attack': case 'attackMove':
        two(330);
        if (u && !u.isVillager) this._tone({ freq: 2600, type: 'triangle', dur: 0.2, gain: 0.03, when: 0.02 });
        break;
      case 'hunt':
        this._tone({ freq: 392, type: 'sawtooth', dur: 0.12, gain: 0.025, attack: 0.02 });
        this._tone({ freq: 523, type: 'sawtooth', dur: 0.16, gain: 0.025, attack: 0.02, when: 0.1 });
        break;
      case 'chop':
        this._burst({ type: 'bandpass', freq: 760, q: 5, dur: 0.06, gain: 0.3 });
        this._burst({ type: 'bandpass', freq: 700, q: 5, dur: 0.06, gain: 0.25, when: 0.11 });
        break;
      case 'mine':
        this._tone({ freq: 2600, type: 'triangle', dur: 0.08, gain: 0.04 });
        this._tone({ freq: 3100, type: 'triangle', dur: 0.08, gain: 0.03, when: 0.09 });
        break;
      case 'forage': case 'farm':
        this._burst({ type: 'bandpass', freq: 2800, q: 0.8, dur: 0.12, gain: 0.12 });
        two(660, 0.03, 'sine');
        break;
      case 'butcher':
        this._burst({ type: 'bandpass', freq: 420, q: 3, dur: 0.08, gain: 0.25 });
        two(494, 0.03, 'sine');
        break;
      case 'build': case 'repair':
        this._burst({ type: 'bandpass', freq: 520, q: 6, dur: 0.05, gain: 0.3 });
        this._burst({ type: 'bandpass', freq: 560, q: 6, dur: 0.05, gain: 0.3, when: 0.12 });
        break;
      case 'dropoff':
        this._burst({ buffer: this.brown, type: 'lowpass', freq: 300, q: 0.7, dur: 0.1, gain: 0.5 });
        two(587, 0.03, 'sine');
        break;
      case 'rally':
        two(784, 0.03, 'sine');
        break;
      default:
        two(550);
    }
  }

  /** Knife work on a carcass. */
  butcher(x, z) {
    if (!this.ctx) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.03) return;
    this._burst({ type: 'bandpass', freq: 380 + Math.random() * 120, q: 2.5, dur: 0.08, gain: 0.3 * vol, pan });
    this._burst({ type: 'highpass', freq: 3500, q: 0.7, dur: 0.03, gain: 0.08 * vol, pan, when: 0.02 });
  }

  /** Farming: hoe in soft soil. */
  hoe(x, z) {
    if (!this.ctx || !this._throttle('hoe', 250)) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.05) return;
    this._burst({ buffer: this.brown, type: 'lowpass', freq: 500, q: 0.8, dur: 0.1, gain: 0.35 * vol, pan });
    this._burst({ type: 'bandpass', freq: 1800, q: 0.7, dur: 0.07, gain: 0.07 * vol, pan });
  }

  spearThrow(x, z) {
    if (!this.ctx) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.03) return;
    this._burst({ type: 'bandpass', freq: 900, q: 0.9, dur: 0.3, gain: 0.25 * vol, pan, attack: 0.08 });
    this._tone({ freq: 180, dur: 0.1, gain: 0.05 * vol, sweep: -60, pan });
  }

  /** A blow that finds only air. */
  whiff(x, z) {
    if (!this.ctx || !this._throttle('whiff', 90)) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.05) return;
    this._burst({ type: 'bandpass', freq: 1400, q: 1.2, dur: 0.16, gain: 0.12 * vol, pan, attack: 0.05 });
  }

  /** Blunt hit on flesh / leather. */
  thud(x, z, g = 1) {
    if (!this.ctx) return;
    const { vol, pan } = this._spatial(x, z);
    if (vol < 0.03) return;
    this._burst({ buffer: this.brown, type: 'lowpass', freq: 260, q: 0.8, dur: 0.12, gain: 0.7 * vol * g, pan });
    this._burst({ type: 'bandpass', freq: 700, q: 2, dur: 0.05, gain: 0.15 * vol * g, pan });
  }

  /** A sheep's bleat (vibrato through a vowel-like formant). */
  baa(x, z) {
    if (!this.ctx || !this._throttle('baa', 700)) return;
    const { vol, pan } = x === undefined ? { vol: 0.8, pan: 0 } : this._spatial(x, z);
    if (vol < 0.05) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 300 + Math.random() * 90;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.08, t + 0.08);
    o.frequency.linearRampToValueAtTime(base * 0.92, t + 0.55);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 22; lg.gain.value = base * 0.045;
    lfo.connect(lg).connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 950; f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * vol, t + 0.05);
    g.gain.setValueAtTime(0.16 * vol, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(f1).connect(f2).connect(g).connect(p).connect(this.sfx);
    o.start(t); lfo.start(t); o.stop(t + 0.65); lfo.stop(t + 0.65);
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
