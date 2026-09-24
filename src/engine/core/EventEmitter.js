// Minimal event emitter used across the engine.
export class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (...a) => { off(); fn(...a); });
    return off;
  }

  off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  emit(type, ...args) {
    const set = this._listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(...args);
  }
}
