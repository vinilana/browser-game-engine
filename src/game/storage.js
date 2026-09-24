// World persistence in IndexedDB: block edits, player state, hotbar, time.
const DB = 'aether-voxelcraft';
const STORE = 'worlds';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class WorldStorage {
  constructor() { this.db = null; }

  async init() {
    try { this.db = await open(); } catch (e) { console.warn('IndexedDB indisponível', e); }
  }

  async load(seed) {
    if (!this.db) return null;
    return new Promise((resolve) => {
      const tx = this.db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(String(seed));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async save(seed, data) {
    if (!this.db) return;
    return new Promise((resolve) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, String(seed));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  static serializeEdits(edits) {
    const out = [];
    for (const [key, m] of edits) {
      const idx = new Uint32Array(m.size), ids = new Uint8Array(m.size);
      let i = 0;
      for (const [k, v] of m) { idx[i] = k; ids[i] = v; i++; }
      out.push([key, idx, ids]);
    }
    return out;
  }

  static deserializeEdits(arr) {
    const edits = new Map();
    for (const [key, idx, ids] of arr || []) {
      const m = new Map();
      for (let i = 0; i < idx.length; i++) m.set(idx[i], ids[i]);
      edits.set(key, m);
    }
    return edits;
  }
}
