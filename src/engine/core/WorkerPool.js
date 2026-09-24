// Pool of module workers with a simple job protocol:
//   main -> worker: { id, type, payload }            (+ transferables)
//   worker -> main: { id, ok, result | error }       (+ transferables)
// Jobs are queued and dispatched to the least loaded worker. Priority jobs
// jump the queue (used for player edits so remeshing feels instant).
export class WorkerPool {
  /**
   * @param {() => Worker} factory
   * @param {number} size
   * @param {number} maxInFlightPerWorker
   */
  constructor(factory, size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)), maxInFlightPerWorker = 2) {
    this.size = size;
    this.maxInFlight = maxInFlightPerWorker;
    this.workers = [];
    this.queue = [];
    this.pending = new Map();
    this._nextId = 1;
    for (let i = 0; i < size; i++) {
      const w = factory();
      const slot = { worker: w, inFlight: 0 };
      w.onmessage = (e) => this._onMessage(slot, e.data);
      w.onerror = (e) => console.error('[WorkerPool] worker error', e.message || e);
      this.workers.push(slot);
    }
  }

  /** Sends the same message to every worker (e.g. init). Resolves when all acknowledge. */
  broadcast(type, payload) {
    return Promise.all(this.workers.map((slot) => this._send(slot, type, payload, [])));
  }

  /**
   * Queues a job. Returns a promise with the worker result.
   * @param {string} type
   * @param {any} payload
   * @param {Transferable[]} transfer
   * @param {{priority?: boolean}} opts
   */
  run(type, payload, transfer = [], opts = {}) {
    return new Promise((resolve, reject) => {
      const job = { type, payload, transfer, resolve, reject };
      if (opts.priority) this.queue.unshift(job); else this.queue.push(job);
      this._pump();
    });
  }

  get busy() {
    return this.queue.length + this.workers.reduce((a, s) => a + s.inFlight, 0);
  }

  get idleCapacity() {
    return this.workers.reduce((a, s) => a + Math.max(0, this.maxInFlight - s.inFlight), 0) - this.queue.length;
  }

  _send(slot, type, payload, transfer) {
    const id = this._nextId++;
    slot.inFlight++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, slot });
      slot.worker.postMessage({ id, type, payload }, transfer);
    });
  }

  _pump() {
    while (this.queue.length) {
      let best = null;
      for (const s of this.workers) {
        if (s.inFlight < this.maxInFlight && (!best || s.inFlight < best.inFlight)) best = s;
      }
      if (!best) return;
      const job = this.queue.shift();
      this._send(best, job.type, job.payload, job.transfer).then(job.resolve, job.reject);
    }
  }

  _onMessage(slot, msg) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    slot.inFlight--;
    if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error));
    this._pump();
  }

  terminate() {
    for (const s of this.workers) s.worker.terminate();
    this.workers.length = 0;
  }
}

/**
 * Worker-side helper: registers handlers and wires the job protocol.
 * Handlers may return a value or { result, transfer } via `withTransfer`.
 */
export function exposeWorker(handlers) {
  self.onmessage = async (e) => {
    const { id, type, payload } = e.data;
    try {
      const fn = handlers[type];
      if (!fn) throw new Error('Unknown job type: ' + type);
      let out = await fn(payload);
      let transfer = [];
      if (out && out.__transfer) { transfer = out.__transfer; out = out.value; }
      self.postMessage({ id, ok: true, result: out }, transfer);
    } catch (err) {
      console.error(err);
      self.postMessage({ id, ok: false, error: String(err && err.stack || err) });
    }
  };
}

export function withTransfer(value, transfer) {
  return { __transfer: transfer, value };
}
