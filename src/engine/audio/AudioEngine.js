// Procedural audio: every sound is synthesized with WebAudio (no assets).
// Provides material-aware footsteps/impacts and a layered ambience
// (wind, birds, crickets, water, rain, caves, underwater muffling).

function makeNoise(ctx, seconds, type) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else if (type === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      d[i] = w;
    }
  }
  return buf;
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

// Per-material synthesis parameters.
const MATERIALS = {
  grass: { f: 2600, q: 0.7, dur: 0.16, gain: 0.5, type: 'bandpass', crunch: 0.6, tone: 0 },
  gravel: { f: 1800, q: 0.6, dur: 0.18, gain: 0.55, type: 'bandpass', crunch: 1.0, tone: 0 },
  sand: { f: 3200, q: 0.4, dur: 0.2, gain: 0.35, type: 'lowpass', crunch: 0.3, tone: 0 },
  snow: { f: 3800, q: 0.5, dur: 0.2, gain: 0.4, type: 'highpass', crunch: 0.8, tone: 0 },
  stone: { f: 1400, q: 1.2, dur: 0.09, gain: 0.55, type: 'bandpass', crunch: 0.1, tone: 180 },
  wood: { f: 650, q: 3.5, dur: 0.12, gain: 0.7, type: 'bandpass', crunch: 0.05, tone: 140 },
  glass: { f: 5200, q: 6, dur: 0.1, gain: 0.35, type: 'bandpass', crunch: 0.0, tone: 2300 },
  metal: { f: 2400, q: 10, dur: 0.25, gain: 0.35, type: 'bandpass', crunch: 0.0, tone: 900 },
  wool: { f: 900, q: 0.5, dur: 0.12, gain: 0.3, type: 'lowpass', crunch: 0.1, tone: 0 },
  water: { f: 900, q: 0.8, dur: 0.3, gain: 0.35, type: 'lowpass', crunch: 0.2, tone: 0 },
  lava: { f: 400, q: 0.8, dur: 0.4, gain: 0.4, type: 'lowpass', crunch: 0.4, tone: 0 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.state = { day: 1, underground: 0, underwater: 0, water: 0, rain: 0, altitude: 0, forest: 0, wind: 0.3 };
    this._birdTimer = 2;
    this._cricketTimer = 1;
    this._dripTimer = 3;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = new AC();
    this.ctx = ctx;
    this.white = makeNoise(ctx, 2, 'white');
    this.pink = makeNoise(ctx, 4, 'pink');
    this.brown = makeNoise(ctx, 4, 'brown');

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(this.muffle).connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 2.8, 3.2);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.12;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverb);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.9;
    this.amb.connect(this.master);

    // continuous beds
    this.windBed = this._bed(this.brown, 'lowpass', 500, 0.0);
    this.waterBed = this._bed(this.pink, 'lowpass', 900, 0.0);
    this.rainBed = this._bed(this.white, 'bandpass', 2600, 0.0, 0.4);
    this.rainLow = this._bed(this.brown, 'lowpass', 400, 0.0);
    this.caveBed = this._bed(this.brown, 'lowpass', 160, 0.0);
    this.fireBed = this._bed(this.pink, 'bandpass', 1200, 0.0, 0.7);
  }

  _bed(buffer, type, freq, gain, q = 0.7) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.amb);
    src.start(0, Math.random() * buffer.duration);
    return { src, filter: f, gain: g };
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  _panner(pan) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    return p;
  }

  _burst({ buffer = this.white, type = 'bandpass', freq = 1000, q = 1, dur = 0.1, gain = 0.5, attack = 0.003, pan = 0, rate = 1, dest = this.sfx, when = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    src.connect(f).connect(g).connect(this._panner(pan)).connect(dest);
    if (dur + attack > buffer.duration - 0.1) src.loop = true;
    src.start(t, Math.max(0, Math.random() * (buffer.duration - dur - 0.1)));
    src.stop(t + attack + dur + 0.05);
  }

  _tone({ freq = 440, type = 'sine', dur = 0.2, gain = 0.2, attack = 0.005, sweep = 0, pan = 0, dest = this.sfx, when = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + sweep), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    o.connect(g).connect(this._panner(pan)).connect(dest);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  footstep(material = 'stone', volume = 1) {
    if (!this.ctx) return;
    const m = MATERIALS[material] || MATERIALS.stone;
    const v = volume * (0.8 + Math.random() * 0.4);
    const pan = (Math.random() - 0.5) * 0.3;
    this._burst({ type: m.type, freq: m.f * (0.85 + Math.random() * 0.3), q: m.q, dur: m.dur, gain: m.gain * v * 0.6, pan });
    if (m.crunch > 0) {
      const n = 2 + Math.floor(m.crunch * 4);
      for (let i = 0; i < n; i++) {
        this._burst({ type: 'highpass', freq: 2500 + Math.random() * 3000, q: 0.7, dur: 0.02 + Math.random() * 0.03, gain: 0.12 * m.crunch * v, when: Math.random() * m.dur * 0.8, pan });
      }
    }
    if (m.tone) this._tone({ freq: m.tone * (0.9 + Math.random() * 0.2), type: 'sine', dur: 0.06, gain: 0.1 * v, sweep: -m.tone * 0.4, pan });
    this._burst({ buffer: this.brown, type: 'lowpass', freq: 220, q: 0.5, dur: 0.07, gain: 0.35 * v, pan });
  }

  breakBlock(material = 'stone') {
    if (!this.ctx) return;
    const m = MATERIALS[material] || MATERIALS.stone;
    this._burst({ type: m.type, freq: m.f * 0.9, q: m.q * 0.8, dur: m.dur * 2.2, gain: m.gain * 0.9 });
    for (let i = 0; i < 6; i++) {
      this._burst({ type: 'bandpass', freq: m.f * (0.8 + Math.random() * 1.5), q: 1.5, dur: 0.04 + Math.random() * 0.05, gain: 0.25 * m.gain, when: 0.02 + Math.random() * 0.25 });
    }
    if (material === 'glass') {
      for (let i = 0; i < 8; i++) this._tone({ freq: 2500 + Math.random() * 4000, dur: 0.15, gain: 0.05, when: Math.random() * 0.2 });
    }
    if (m.tone) this._tone({ freq: m.tone, dur: 0.12, gain: 0.15, sweep: -m.tone * 0.5 });
    this._burst({ buffer: this.brown, type: 'lowpass', freq: 180, q: 0.5, dur: 0.15, gain: 0.5 });
  }

  placeBlock(material = 'stone') {
    if (!this.ctx) return;
    const m = MATERIALS[material] || MATERIALS.stone;
    this._burst({ type: m.type, freq: m.f * 0.7, q: m.q, dur: m.dur * 1.2, gain: m.gain * 0.8 });
    this._burst({ buffer: this.brown, type: 'lowpass', freq: 260, q: 0.6, dur: 0.1, gain: 0.6 });
    if (m.tone) this._tone({ freq: m.tone * 0.8, dur: 0.08, gain: 0.12, sweep: -m.tone * 0.3 });
  }

  splash(size = 1) {
    if (!this.ctx) return;
    this._burst({ buffer: this.pink, type: 'lowpass', freq: 1600, q: 0.5, dur: 0.5 * size, gain: 0.6 * size });
    for (let i = 0; i < 8; i++) this._tone({ freq: 600 + Math.random() * 1400, dur: 0.05, gain: 0.04 * size, sweep: 800, when: Math.random() * 0.3 });
  }

  thunder(distance = 0.5) {
    if (!this.ctx) return;
    const delay = distance * 3;
    this._burst({ buffer: this.brown, type: 'lowpass', freq: 300, q: 0.3, dur: 3.5, gain: 1.2 * (1 - distance * 0.5), attack: 0.05, when: delay });
    this._burst({ buffer: this.brown, type: 'lowpass', freq: 120, q: 0.3, dur: 5, gain: 1.0, attack: 0.3, when: delay + 0.2 });
    if (distance < 0.3) this._burst({ type: 'highpass', freq: 1500, q: 0.3, dur: 0.4, gain: 0.6, when: delay });
  }

  _bird() {
    const pan = Math.random() * 2 - 1;
    const base = 2200 + Math.random() * 2600;
    const notes = 2 + Math.floor(Math.random() * 6);
    const kind = Math.random();
    let t = 0;
    for (let i = 0; i < notes; i++) {
      const dur = 0.05 + Math.random() * 0.12;
      const f = base * (0.8 + Math.random() * 0.5);
      this._tone({ freq: f, dur, gain: 0.025 + Math.random() * 0.02, sweep: (kind > 0.5 ? 1 : -1) * f * (0.2 + Math.random() * 0.5), pan, dest: this.amb, when: t });
      t += dur + 0.03 + Math.random() * 0.1;
    }
  }

  _cricket() {
    const pan = Math.random() * 2 - 1;
    const f = 4200 + Math.random() * 600;
    const pulses = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < pulses; i++) {
      this._tone({ freq: f, dur: 0.018, gain: 0.012, pan, dest: this.amb, when: i * 0.045 });
    }
  }

  _drip() {
    const f = 900 + Math.random() * 1400;
    this._tone({ freq: f, dur: 0.12, gain: 0.05, sweep: f * 0.6, pan: Math.random() * 2 - 1, dest: this.sfx });
  }

  /** Updates the ambience from the listener's environment. */
  update(dt, s = this.state) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const surface = 1 - s.underground;
    const wind = (0.18 + s.altitude * 0.5 + s.rain * 0.5 + s.wind * 0.3) * surface * (1 - s.underwater);
    this.windBed.gain.gain.setTargetAtTime(wind * 0.5, t, 0.5);
    this.windBed.filter.frequency.setTargetAtTime(300 + s.altitude * 700 + Math.sin(t * 0.3) * 120, t, 0.8);
    this.waterBed.gain.gain.setTargetAtTime(s.water * 0.35 * (1 - s.underwater), t, 0.5);
    this.rainBed.gain.gain.setTargetAtTime(s.rain * 0.28 * surface, t, 0.8);
    this.rainLow.gain.gain.setTargetAtTime(s.rain * 0.25 * surface, t, 0.8);
    this.caveBed.gain.gain.setTargetAtTime(s.underground * 0.35, t, 1.0);
    this.fireBed.gain.gain.setTargetAtTime((s.fire || 0) * 0.15, t, 0.3);
    this.muffle.frequency.setTargetAtTime(s.underwater ? 650 : 20000, t, 0.08);
    this.reverbGain.gain.setTargetAtTime(0.1 + s.underground * 0.5, t, 0.5);

    if (s.underwater) return;
    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      this._birdTimer = 0.8 + Math.random() * 5 / (0.3 + s.forest);
      if (s.day > 0.5 && surface > 0.5 && s.rain < 0.3) this._bird();
    }
    this._cricketTimer -= dt;
    if (this._cricketTimer <= 0) {
      this._cricketTimer = 0.3 + Math.random() * 1.2;
      if (s.day < 0.3 && surface > 0.5 && s.rain < 0.3) this._cricket();
    }
    this._dripTimer -= dt;
    if (this._dripTimer <= 0) {
      this._dripTimer = 1.5 + Math.random() * 6;
      if (s.underground > 0.6) this._drip();
    }
  }
}
