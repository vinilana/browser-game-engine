// Quality presets and persisted user settings.
export const QUALITY_PRESETS = {
  low: {
    renderScale: 0.6, viewDistance: 6, textureSize: 64, shadowMapSize: 1024, shadowCascades: 2, shadowDistance: 80,
    ssao: false, volumetrics: false, volumetricSteps: 8, clouds: 1, taa: true, bloom: true, parallax: false, fancyLeaves: false,
    maxFps: 0,
  },
  medium: {
    renderScale: 0.8, viewDistance: 8, textureSize: 128, shadowMapSize: 2048, shadowCascades: 3, shadowDistance: 120,
    ssao: true, volumetrics: true, volumetricSteps: 12, clouds: 1, taa: true, bloom: true, parallax: false, fancyLeaves: true,
    maxFps: 0,
  },
  high: {
    renderScale: 1.0, viewDistance: 10, textureSize: 128, shadowMapSize: 2048, shadowCascades: 4, shadowDistance: 180,
    ssao: true, volumetrics: true, volumetricSteps: 16, clouds: 2, taa: true, bloom: true, parallax: true, fancyLeaves: true,
    maxFps: 0,
  },
  ultra: {
    renderScale: 1.0, viewDistance: 14, textureSize: 256, shadowMapSize: 3072, shadowCascades: 4, shadowDistance: 256,
    ssao: true, volumetrics: true, volumetricSteps: 24, clouds: 2, taa: true, bloom: true, parallax: true, fancyLeaves: true,
    maxFps: 0,
  },
};

const STORAGE_KEY = 'aether.settings.v1';

export class Settings {
  constructor(defaults = {}, storageKey = STORAGE_KEY) {
    this.storageKey = storageKey;
    this.values = { preset: 'high', fov: 75, sensitivity: 1, volume: 0.8, farTerrain: true, farDistance: 1800, ...QUALITY_PRESETS.high, ...defaults };
    this.listeners = new Set();
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
      if (saved) Object.assign(this.values, saved);
    } catch { /* storage unavailable */ }
  }

  get(k) { return this.values[k]; }

  set(k, v) {
    this.values[k] = v;
    this._save();
    for (const fn of this.listeners) fn(k, v);
  }

  applyPreset(name) {
    const p = QUALITY_PRESETS[name];
    if (!p) return;
    this.values.preset = name;
    for (const [k, v] of Object.entries(p)) this.values[k] = v;
    this._save();
    for (const fn of this.listeners) fn('*', null);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _save() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.values)); } catch { /* ignore */ }
  }
}
