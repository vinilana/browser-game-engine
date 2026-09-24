import {
  BufferGeometry, BufferAttribute, Mesh, Sphere, Vector3, Box3, DataArrayTexture, RGBAFormat,
  UnsignedByteType, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, Frustum, Matrix4,
} from 'three';
import { WorkerPool } from '../core/WorkerPool.js';
import { EventEmitter } from '../core/EventEmitter.js';
import { CHUNK, PAD, PS, SY, WORLD_HEIGHT } from './Mesher.js';
import { createVoxelMaterials } from './VoxelMaterials.js';

const H = WORLD_HEIGHT;
const LAYER = CHUNK * CHUNK;
// 15 bits per axis keeps keys in V8's small-integer range (no heap allocation)
export const colKey = (cx, cz) => ((cx + 16384) << 15) | (cz + 16384);
function releaseArray() { this.array = null; }

class Column {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = colKey(cx, cz);
    this.blocks = null;
    this.tints = null;
    this.light = null;
    this.lightH = 0;
    this.maxY = 0;
    this.state = 0;          // 0 generating, 1 ready
    this.version = 0;        // data version
    this.meshVersion = -1;   // data version of the mesh on screen
    this.meshing = false;
    this.dirty = true;
    this.priority = false;
    this.skipDark = true;
    this.meshSkipDark = null;
    this.meshes = { opaque: null, cutout: null, translucent: null };
    this.vertexCount = 0;
  }
}

/**
 * Streams an infinite voxel world around a focus point: generation and
 * meshing run in a worker pool, geometry is uploaded to the render pipeline.
 */
export class VoxelWorld extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('../render/RenderPipeline.js').RenderPipeline} opts.pipeline
   * @param {import('./BlockRegistry.js').BlockRegistry} opts.registry
   * @param {() => Worker} opts.workerFactory
   * @param {number} opts.seed
   * @param {number} [opts.viewDistance] in columns
   * @param {number} [opts.textureSize]
   */
  constructor(opts) {
    super();
    this.pipeline = opts.pipeline;
    this.registry = opts.registry;
    this.seed = opts.seed;
    this.viewDistance = opts.viewDistance ?? 8;
    this.textureSize = opts.textureSize ?? 128;
    this.generatorOptions = opts.generatorOptions ?? {};
    this.fancyLeaves = opts.fancyLeaves ?? true;
    this.columns = new Map();
    this.edits = new Map();
    this.pool = new WorkerPool(opts.workerFactory, opts.workers);
    this.focus = new Vector3();
    this.focusDir = new Vector3(0, 0, -1);
    this._order = [];
    this._orderKey = '';
    this._frame = 0;
    this.maxGenInFlight = this.pool.size * 2;
    this.maxMeshInFlight = this.pool.size * 2;
    this.genInFlight = 0;
    this.meshInFlight = 0;
    this.stats = { columns: 0, meshed: 0, vertices: 0 };
    this.nearRadius = 2;       // columns meshed with full cave detail
    this.applyQueue = [];      // finished meshes waiting for GPU upload
    this.uploadBudget = 2.5e6; // bytes of vertex data uploaded per frame
    this._frustum = new Frustum();
    this._projScreen = new Matrix4();
  }

  async init(onProgress) {
    await this.pool.broadcast('init', { seed: this.seed, options: this.generatorOptions });
    onProgress?.(0.05, 'Sintetizando texturas PBR');
    await this._buildTextures(onProgress);
    this.materials = createVoxelMaterials(this.pipeline.shared, this.textures, this.textureSize);
  }

  async _buildTextures(onProgress) {
    const names = this.registry.textureNames;
    const size = this.textureSize;
    const per = Math.ceil(names.length / (this.pool.size * 2));
    const jobs = [];
    let done = 0;
    for (let i = 0; i < names.length; i += per) {
      const slice = names.slice(i, i + per);
      jobs.push(this.pool.run('textures', { names: slice, size }).then((r) => {
        done += slice.length;
        onProgress?.(0.05 + 0.25 * (done / names.length), 'Sintetizando texturas PBR');
        return r;
      }));
    }
    const results = (await Promise.all(jobs)).flat();
    const L = names.length;
    const layerBytes = size * size * 4;
    const albedo = new Uint8Array(layerBytes * L);
    const normal = new Uint8Array(layerBytes * L);
    const material = new Uint8Array(layerBytes * L);
    this.textureData = new Map();
    results.forEach((t) => {
      const i = this.registry.textureIndex.get(t.name);
      albedo.set(t.albedo, i * layerBytes);
      normal.set(t.normal, i * layerBytes);
      material.set(t.material, i * layerBytes);
      this.textureData.set(t.name, t);
    });
    const make = (data, srgb) => {
      const tex = new DataArrayTexture(data, size, size, L);
      tex.format = RGBAFormat;
      tex.type = UnsignedByteType;
      tex.wrapS = tex.wrapT = RepeatWrapping;
      tex.minFilter = LinearMipmapLinearFilter;
      tex.magFilter = LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 16;
      if (srgb) tex.colorSpace = SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    };
    this.textures = { albedo: make(albedo, true), normal: make(normal, false), material: make(material, false) };
  }

  // -------------------------------------------------------------------------
  // Block access
  // -------------------------------------------------------------------------
  getColumn(cx, cz) { return this.columns.get(colKey(cx, cz)); }

  isColumnReady(x, z) {
    const c = this.getColumn(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    return !!(c && c.state === 1);
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.columns.get(colKey(cx, cz));
    if (!c || !c.blocks) return 0;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    return c.blocks[(y * CHUNK + lz) * CHUNK + lx];
  }

  /** Returns packed light (sky << 4 | block) at a block position. */
  getLight(x, y, z) {
    if (y >= H) return 15 << 4;
    if (y < 0) return 0;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.columns.get(colKey(cx, cz));
    if (!c || !c.light) return 15 << 4;
    if (y >= c.lightH) return 15 << 4;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    return c.light[(y * CHUNK + lz) * CHUNK + lx];
  }

  getSkyLight(x, y, z) { return this.getLight(Math.floor(x), Math.floor(y), Math.floor(z)) >> 4; }
  getBlockLight(x, y, z) { return this.getLight(Math.floor(x), Math.floor(y), Math.floor(z)) & 15; }

  /** Height of the highest non-air block at x,z (or -1). */
  getHeight(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.getColumn(cx, cz);
    if (!c || !c.blocks) return -1;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    for (let y = c.maxY; y >= 0; y--) {
      if (c.blocks[(y * CHUNK + lz) * CHUNK + lx] !== 0) return y;
    }
    return -1;
  }

  /** Highest solid (collidable) block. */
  getSurfaceY(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.getColumn(cx, cz);
    if (!c || !c.blocks) return -1;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    const solid = this.registry.solid;
    for (let y = c.maxY; y >= 0; y--) {
      if (solid[c.blocks[(y * CHUNK + lz) * CHUNK + lx]]) return y;
    }
    return -1;
  }

  setBlock(x, y, z, id, { record = true } = {}) {
    if (y < 0 || y >= H) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.getColumn(cx, cz);
    if (!c || !c.blocks) return false;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    const idx = (y * CHUNK + lz) * CHUNK + lx;
    const old = c.blocks[idx];
    if (old === id) return false;
    c.blocks[idx] = id;
    if (id !== 0 && y > c.maxY) c.maxY = y;
    c.version++;
    if (record) {
      let m = this.edits.get(c.key);
      if (!m) { m = new Map(); this.edits.set(c.key, m); }
      m.set(idx, id);
      this.editsDirty = true;
    }
    // remesh this column and neighbours whose padded region contains the block
    const affected = [[0, 0]];
    const west = lx < PAD, east = lx >= CHUNK - PAD, north = lz < PAD, south = lz >= CHUNK - PAD;
    if (west) affected.push([-1, 0]);
    if (east) affected.push([1, 0]);
    if (north) affected.push([0, -1]);
    if (south) affected.push([0, 1]);
    if (west && north) affected.push([-1, -1]);
    if (west && south) affected.push([-1, 1]);
    if (east && north) affected.push([1, -1]);
    if (east && south) affected.push([1, 1]);
    for (const [dx, dz] of affected) {
      const n = this.getColumn(cx + dx, cz + dz);
      if (!n) continue;
      if (n !== c) n.version++;
      n.dirty = true;
      n.priority = true;
    }
    this._dispatchPriority();
    this.emit('blockChanged', { x, y, z, id, old });
    return true;
  }

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------
  _computeOrder(pcx, pcz) {
    const R = this.viewDistance + 1;
    const key = `${pcx},${pcz},${R},${Math.round(Math.atan2(this.focusDir.z, this.focusDir.x) * 4)}`;
    if (key === this._orderKey) return this._order;
    this._orderKey = key;
    const list = [];
    const fx = this.focusDir.x, fz = this.focusDir.z;
    const fl = Math.hypot(fx, fz) || 1;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > R + 0.5) continue;
        const facing = d > 0 ? (dx * fx + dz * fz) / (d * fl) : 1;
        list.push({ dx, dz, d, score: d - facing * Math.min(d, 2.5) });
      }
    }
    list.sort((a, b) => a.score - b.score);
    this._order = list;
    return list;
  }

  /**
   * @param {Vector3} focus world position (player)
   * @param {Vector3} dir view direction
   */
  update(focus, dir) {
    this._frame++;
    this.focus.copy(focus);
    if (dir) this.focusDir.copy(dir);
    const pcx = Math.floor(focus.x / CHUNK), pcz = Math.floor(focus.z / CHUNK);
    const R = this.viewDistance;
    const order = this._computeOrder(pcx, pcz);

    // generation
    for (const o of order) {
      if (this.genInFlight >= this.maxGenInFlight) break;
      const cx = pcx + o.dx, cz = pcz + o.dz;
      const key = colKey(cx, cz);
      if (this.columns.has(key)) continue;
      this._generate(cx, cz);
    }

    this._drainApplyQueue();

    // meshing
    this._dispatchPriority();
    for (const o of order) {
      if (this.meshInFlight >= this.maxMeshInFlight) break;
      if (o.d > R + 0.5) continue;
      const c = this.columns.get(colKey(pcx + o.dx, pcz + o.dz));
      if (!c || c.state !== 1 || c.meshing || c.awaitingUpload) continue;
      const wantSkip = Math.max(Math.abs(o.dx), Math.abs(o.dz)) > this.nearRadius;
      c.skipDark = wantSkip;
      const needs = c.dirty || c.meshSkipDark !== wantSkip;
      if (!needs) continue;
      if (!this._neighborsReady(c)) continue;
      this._mesh(c, false);
    }

    // unload far columns
    if (this._frame % 30 === 0) {
      const U = R + 3;
      for (const c of this.columns.values()) {
        if (Math.abs(c.cx - pcx) > U || Math.abs(c.cz - pcz) > U) {
          if (c.state === 1 && !c.meshing) this._unload(c);
        }
      }
    }

    let verts = 0, meshed = 0;
    for (const c of this.columns.values()) { verts += c.vertexCount; if (c.meshVersion >= 0) meshed++; }
    this.stats.columns = this.columns.size;
    this.stats.meshed = meshed;
    this.stats.vertices = verts;
    this.stats.pending = this.pool.busy;
  }

  _neighborsReady(c) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.columns.get(colKey(c.cx + dx, c.cz + dz));
        if (!n || n.state !== 1) return false;
      }
    }
    return true;
  }

  _dispatchPriority() {
    for (const c of this.columns.values()) {
      if (c.priority && c.state === 1 && !c.meshing && this._neighborsReady(c)) {
        c.priority = false;
        this._mesh(c, true);
      }
    }
  }

  _generate(cx, cz) {
    const c = new Column(cx, cz);
    this.columns.set(c.key, c);
    this.genInFlight++;
    this.pool.run('generate', { cx, cz }).then((res) => {
      this.genInFlight--;
      if (this.columns.get(c.key) !== c) return;
      c.blocks = res.blocks;
      c.tints = res.tints;
      c.maxY = res.maxY;
      const edits = this.edits.get(c.key);
      if (edits) {
        for (const [idx, id] of edits) {
          c.blocks[idx] = id;
          const y = Math.floor(idx / LAYER);
          if (id !== 0 && y > c.maxY) c.maxY = y;
        }
      }
      c.state = 1;
      c.dirty = true;
      this.emit('columnLoaded', c);
    }).catch((err) => {
      this.genInFlight--;
      console.error('generate failed', err);
      this.columns.delete(c.key);
    });
  }

  _buildRegion(c) {
    let top = 0;
    const cols = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.columns.get(colKey(c.cx + dx, c.cz + dz));
        cols.push(n);
        if (n.maxY > top) top = n.maxY;
      }
    }
    const RH = Math.min(H, top + 3);
    const region = new Uint8Array(SY * RH);
    for (let gz = 0; gz < 3; gz++) {
      const z0 = gz === 0 ? CHUNK - PAD : 0;
      const zn = gz === 1 ? CHUNK : PAD;
      const zo = gz === 0 ? 0 : gz === 1 ? PAD : PAD + CHUNK;
      for (let gx = 0; gx < 3; gx++) {
        const x0 = gx === 0 ? CHUNK - PAD : 0;
        const xn = gx === 1 ? CHUNK : PAD;
        const xo = gx === 0 ? 0 : gx === 1 ? PAD : PAD + CHUNK;
        const src = cols[gz * 3 + gx].blocks;
        for (let y = 0; y < RH; y++) {
          for (let z = 0; z < zn; z++) {
            let s = (y * CHUNK + z0 + z) * CHUNK + x0;
            let d = y * SY + (zo + z) * PS + xo;
            for (let x = 0; x < xn; x++) region[d++] = src[s++];
          }
        }
      }
    }
    return { region, RH };
  }

  _mesh(c, priority) {
    const { region, RH } = this._buildRegion(c);
    const tints = c.tints.slice();
    const version = c.version;
    const skipDark = c.skipDark;
    c.meshing = true;
    c.dirty = false;
    this.meshInFlight++;
    this.pool.run('mesh', { region, H: RH, tints, cx: c.cx, cz: c.cz, skipDark, fancyLeaves: this.fancyLeaves }, [region.buffer, tints.buffer], { priority })
      .then((res) => {
        this.meshInFlight--;
        c.meshing = false;
        if (this.columns.get(c.key) !== c) return;
        c.light = res.light;
        c.lightH = res.lightH;
        const bytes = ['opaque', 'cutout', 'translucent'].reduce((a, k) => a + (res[k]?.vcount || 0) * 20, 0);
        const job = { c, res, version, skipDark, bytes };
        // player edits are applied immediately; streaming results are spread over frames
        if (priority) this._finishMesh(job);
        else {
          const i = c.awaitingUpload ? this.applyQueue.findIndex((j) => j.c === c) : -1;
          if (i >= 0) this.applyQueue[i] = job; else this.applyQueue.push(job);
          c.awaitingUpload = true;
        }
      })
      .catch((err) => {
        this.meshInFlight--;
        c.meshing = false;
        c.dirty = true;
        console.error('mesh failed', err);
      });
  }

  _finishMesh({ c, res, version, skipDark }) {
    c.awaitingUpload = false;
    if (this.columns.get(c.key) !== c) return;
    if (c.meshVersion > version) return;
    this._applyMesh(c, res);
    c.meshVersion = version;
    c.meshSkipDark = skipDark;
    if (c.version !== version) c.dirty = true;
    if (c.priority) this._dispatchPriority();
    this.emit('columnMeshed', c);
  }

  _drainApplyQueue() {
    if (!this.applyQueue.length) return;
    // nearest first
    const fx = this.focus.x / CHUNK, fz = this.focus.z / CHUNK;
    this.applyQueue.sort((a, b) => ((a.c.cx - fx) ** 2 + (a.c.cz - fz) ** 2) - ((b.c.cx - fx) ** 2 + (b.c.cz - fz) ** 2));
    let budget = this.uploadBudget;
    while (this.applyQueue.length && (budget > 0 || budget === this.uploadBudget)) {
      const job = this.applyQueue.shift();
      budget -= job.bytes;
      this._finishMesh(job);
    }
  }

  _applyMesh(c, res) {
    const P = this.pipeline;
    const M = this.materials;
    let verts = 0;
    const groups = [
      ['opaque', M.opaque, M.shadowOpaque, P.scene],
      ['cutout', M.cutout, M.shadowCutout, P.scene],
      ['translucent', M.translucent, null, P.forwardScene],
    ];
    for (const [name, mat, shadowMat, scene] of groups) {
      const g = res[name];
      const old = c.meshes[name];
      if (old) {
        scene.remove(old);
        old.geometry.dispose();
        P.removeShadowCaster(old);
        c.meshes[name] = null;
      }
      if (!g || g.vcount === 0) continue;
      verts += g.vcount;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(g.pos, 4));
      geo.setAttribute('data0', new BufferAttribute(g.d0, 4));
      geo.setAttribute('data1', new BufferAttribute(g.d1, 4));
      geo.setAttribute('tint', new BufferAttribute(g.tint, 4));
      geo.setIndex(new BufferAttribute(g.idx, 1));
      // static geometry: drop the CPU copies once uploaded to the GPU
      for (const a of [...Object.values(geo.attributes), geo.index]) a.onUpload(releaseArray);
      const top = Math.max(c.maxY + 2, 1);
      geo.boundingBox = new Box3(new Vector3(-1, 0, -1), new Vector3(CHUNK + 1, top, CHUNK + 1));
      geo.boundingSphere = new Sphere(new Vector3(CHUNK / 2, top / 2, CHUNK / 2),
        Math.hypot(CHUNK / 2 + 1, top / 2, CHUNK / 2 + 1));
      const mesh = new Mesh(geo, mat);
      mesh.position.set(c.cx * CHUNK, 0, c.cz * CHUNK);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      mesh.userData.column = c;
      scene.add(mesh);
      if (shadowMat) P.addShadowCaster(mesh, shadowMat);
      c.meshes[name] = mesh;
    }
    c.vertexCount = verts;
  }

  _unload(c) {
    const P = this.pipeline;
    for (const name of ['opaque', 'cutout', 'translucent']) {
      const m = c.meshes[name];
      if (!m) continue;
      (name === 'translucent' ? P.forwardScene : P.scene).remove(m);
      m.geometry.dispose();
      P.removeShadowCaster(m);
    }
    this.columns.delete(c.key);
    this.emit('columnUnloaded', c);
  }

  /** Forces every loaded column to be re-meshed (e.g. after a quality change). */
  remeshAll() {
    for (const c of this.columns.values()) if (c.state === 1) c.dirty = true;
  }

  setViewDistance(d) {
    this.viewDistance = d;
    this._orderKey = '';
  }

  /** Voxel DDA raycast. Returns {x,y,z,id,nx,ny,nz,dist} or null. */
  raycast(origin, dir, maxDist = 8, filter) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const tdx = sx !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tdy = sy !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tdz = sz !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tmx = sx > 0 ? (x + 1 - origin.x) * tdx : sx < 0 ? (origin.x - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - origin.y) * tdy : sy < 0 ? (origin.y - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - origin.z) * tdz : sz < 0 ? (origin.z - z) * tdz : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    const sel = this.registry.selectable;
    for (let i = 0; i < 256 && t <= maxDist; i++) {
      const id = this.getBlock(x, y, z);
      if (id !== 0 && (filter ? filter(id) : sel[id])) {
        return { x, y, z, id, nx, ny, nz, dist: t };
      }
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  dispose() {
    for (const c of [...this.columns.values()]) this._unload(c);
    this.pool.terminate();
  }
}
