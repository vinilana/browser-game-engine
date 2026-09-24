import {
  BufferGeometry, BufferAttribute, Mesh, RawShaderMaterial, GLSL3, DataTexture, RedFormat, UnsignedByteType,
  NearestFilter, Vector2, Vector3, Vector4, Sphere, Box3, DoubleSide,
} from 'three';
import { COMMON } from '../render/shaders/common.js';

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in vec4 color;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vColor;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormal = normal;
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform sampler2D tCoverage;
uniform ivec2 uCoverageOrigin;
uniform int uCoverageSize;
uniform float uChunk;
uniform float uTime;
uniform vec4 uExclude;        // minX, minZ, maxX, maxZ (skip inside, e.g. a playable map)
in vec3 vWorld;
in vec3 vNormal;
in vec4 vColor;
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gLight;
void main() {
  if (vWorld.x > uExclude.x && vWorld.z > uExclude.y && vWorld.x < uExclude.z && vWorld.z < uExclude.w) discard;
  ivec2 c = ivec2(floor(vWorld.xz / uChunk)) - uCoverageOrigin;
  if (c.x >= 0 && c.y >= 0 && c.x < uCoverageSize && c.y < uCoverageSize) {
    if (texelFetch(tCoverage, c, 0).r > 0.5) discard;
  }
  bool water = vColor.a > 0.9;
  float forest = water ? 0.0 : clamp(vColor.a / 0.784, 0.0, 1.0);
  vec3 albedo = srgbToLinear(vColor.rgb);
  vec3 n = normalize(vNormal);
  float rough = 0.92;
  if (water) {
    n = vec3(0.0, 1.0, 0.0);
    // patchy roughness (wind slicks) instead of visible ripples
    vec2 q = vWorld.xz * 0.004;
    vec2 iq = floor(q), fq = fract(q);
    fq = fq * fq * (3.0 - 2.0 * fq);
    float v = mix(mix(hash12(iq), hash12(iq + vec2(1, 0)), fq.x), mix(hash12(iq + vec2(0, 1)), hash12(iq + vec2(1, 1)), fq.x), fq.y);
    rough = mix(0.08, 0.2, v);
  } else {
    // break up the flat shading with world-space noise
    float g = hash12(floor(vWorld.xz * 0.5));
    albedo *= 0.9 + 0.2 * g;
    if (forest > 0.02) {
      // aerial canopy: jittered crowns shaded as domes
      vec2 p = vWorld.xz / 4.6;
      vec2 ip = floor(p), fp = fract(p);
      float md = 8.0, mid = 0.0;
      vec2 mo = vec2(0.0);
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 gc = ip + vec2(i, j);
          vec2 o = vec2(hash12(gc), hash12(gc + 31.7));
          vec2 r = vec2(i, j) + o - fp;
          float d = dot(r, r);
          if (d < md) { md = d; mo = r; mid = hash12(gc + 71.3); }
        }
      }
      float crownR = 0.85 + 0.3 * mid;
      float dome = clamp(1.0 - sqrt(md) / crownR, 0.0, 1.0);
      vec3 cn = normalize(vec3(-mo.x, dome * 1.6 + 0.5, -mo.y));
      n = normalize(mix(n, cn, forest * 0.6));
      float leaf = hash12(floor(vWorld.xz * 3.0));
      albedo *= mix(1.0, (0.6 + 0.4 * dome) * (0.8 + 0.4 * mid) * (0.85 + 0.3 * leaf), forest);
    }
  }
  gAlbedo = vec4(sqrt(max(albedo, 0.0)), 1.0);
  gNormal = vec4(encodeNormal(n), rough, 0.0);
  gLight = vec4(1.0, 0.0, 0.0, 0.0);
}
`;

const tileKey = (tx, tz) => `${tx},${tz}`;

/**
 * Heightfield LOD rendered beyond (and under unloaded parts of) the voxel
 * world, giving a horizon several kilometres away. Tiles are generated in the
 * voxel worker pool through the generator's `farSample` function.
 */
export class FarTerrain {
  /**
   * @param {object} o
   * @param {import('../render/RenderPipeline.js').RenderPipeline} o.pipeline
   * @param {import('../core/WorkerPool.js').WorkerPool} [o.pool] workers exposing a 'farTile' job
   * @param {object} [o.world] voxel world: meshed columns hide the far terrain
   * @param {{minX:number,minZ:number,maxX:number,maxZ:number}} [o.exclude] rectangle never drawn
   */
  constructor({ pipeline, world = null, pool = null, radius = 1800, tileSize = 256, exclude = null, lods = [[900, 32], [Infinity, 16]] }) {
    this.pipeline = pipeline;
    this.lods = lods;
    this.world = world;
    this.pool = pool || world?.pool;
    this.radius = radius;
    this.tileSize = tileSize;
    this.tiles = new Map();
    this.inFlight = 0;
    this.enabled = true;
    this.covSize = 64;
    this.covData = new Uint8Array(this.covSize * this.covSize);
    this.coverage = new DataTexture(this.covData, this.covSize, this.covSize, RedFormat, UnsignedByteType);
    this.coverage.minFilter = this.coverage.magFilter = NearestFilter;
    this.coverage.needsUpdate = true;
    this.covOrigin = new Vector2();
    this._frame = 0;
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tCoverage: { value: this.coverage },
        uCoverageOrigin: { value: this.covOrigin },
        uCoverageSize: { value: this.covSize },
        uChunk: { value: 32 },
        uTime: pipeline.shared.uTime,
        uExclude: { value: exclude ? new Vector4(exclude.minX, exclude.minZ, exclude.maxX, exclude.maxZ) : new Vector4(1, 1, -1, -1) },
      },
      side: DoubleSide,
    });
  }

  /** Tile resolution for a distance: first [maxDist, res] entry that fits. */
  _lodFor(dist) {
    for (const [d, res] of this.lods) if (dist < d) return res;
    return this.lods[this.lods.length - 1][1];
  }

  update(focus) {
    if (!this.enabled) return;
    this._frame++;
    const T = this.tileSize;
    const ptx = Math.floor(focus.x / T), ptz = Math.floor(focus.z / T);
    const R = Math.ceil(this.radius / T);
    // coverage mask: voxel columns that already have a mesh hide the far terrain
    if (this.world && this._frame % 6 === 0) {
      const n = this.covSize;
      const ox = Math.floor(focus.x / 32) - (n >> 1), oz = Math.floor(focus.z / 32) - (n >> 1);
      this.covOrigin.set(ox, oz);
      for (let z = 0; z < n; z++) {
        for (let x = 0; x < n; x++) {
          const c = this.world.getColumn(ox + x, oz + z);
          this.covData[z * n + x] = c && c.meshVersion >= 0 ? 255 : 0;
        }
      }
      this.coverage.needsUpdate = true;
    }
    // request tiles, nearest first (re-evaluated only when needed)
    const moved = !this._lastFocus || Math.hypot(focus.x - this._lastFocus.x, focus.z - this._lastFocus.z) > 24;
    if (!moved && this._frame % 20 !== 0 && this.inFlight > 0) return;
    if (!moved && this._idle) return;
    this._lastFocus = { x: focus.x, z: focus.z };
    const want = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const tx = ptx + dx, tz = ptz + dz;
        const cx = (tx + 0.5) * T - focus.x, cz = (tz + 0.5) * T - focus.z;
        const d = Math.max(0, Math.hypot(cx, cz) - T * 0.7);
        if (d > this.radius) continue;
        want.push({ tx, tz, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    let requested = 0, missing = 0;
    for (const w of want) {
      const key = tileKey(w.tx, w.tz);
      const res = this._lodFor(w.d);
      const t = this.tiles.get(key);
      if (t && (t.res === res || t.pending)) continue;
      missing++;
      if (this.inFlight >= 3) continue;
      this._request(w.tx, w.tz, res, t);
      requested++;
    }
    this._idle = missing === 0;
    // drop far tiles
    if (this._frame % 60 === 0) {
      for (const [key, t] of this.tiles) {
        const cx = (t.tx + 0.5) * T - focus.x, cz = (t.tz + 0.5) * T - focus.z;
        if (Math.hypot(cx, cz) - T > this.radius + T && !t.pending) {
          if (t.mesh) { this.pipeline.scene.remove(t.mesh); t.mesh.geometry.dispose(); }
          this.tiles.delete(key);
        }
      }
    }
  }

  _request(tx, tz, res, existing) {
    const T = this.tileSize;
    const key = tileKey(tx, tz);
    const t = existing || { tx, tz, res: 0, mesh: null, pending: false };
    t.pending = true;
    this.tiles.set(key, t);
    this.inFlight++;
    this._idle = false;
    this.pool.run('farTile', { x0: tx * T, z0: tz * T, size: T, res }).then((g) => {
      this.inFlight--;
      this._idle = false;
      t.pending = false;
      if (this.tiles.get(key) !== t) return;
      if (t.mesh) { this.pipeline.scene.remove(t.mesh); t.mesh.geometry.dispose(); }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new BufferAttribute(g.nrm, 3, true));
      geo.setAttribute('color', new BufferAttribute(g.col, 4, true));
      geo.setIndex(new BufferAttribute(g.idx, 1));
      for (const a of [...Object.values(geo.attributes), geo.index]) a.onUpload(function () { this.array = null; });
      geo.boundingBox = new Box3(new Vector3(0, g.minY - 20, 0), new Vector3(T, g.maxY, T));
      geo.boundingSphere = geo.boundingBox.getBoundingSphere(new Sphere());
      const mesh = new Mesh(geo, this.material);
      mesh.position.set(tx * T, 0, tz * T);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      mesh.renderOrder = 1;
      this.pipeline.scene.add(mesh);
      t.mesh = mesh;
      t.res = res;
    }).catch((e) => { this.inFlight--; t.pending = false; console.error('farTile', e); });
  }

  dispose() {
    for (const t of this.tiles.values()) if (t.mesh) { this.pipeline.scene.remove(t.mesh); t.mesh.geometry.dispose(); }
    this.tiles.clear();
  }
}

