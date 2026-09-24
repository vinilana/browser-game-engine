import {
  BufferGeometry, BufferAttribute, Mesh, RawShaderMaterial, GLSL3, DataTexture, RGBAFormat, UnsignedByteType,
  LinearFilter, ClampToEdgeWrapping, Box3, Sphere, Vector3, Vector4, DoubleSide,
} from 'three';
import { COMMON } from '../render/shaders/common.js';

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec3 vNormal;
void main() {
  vWorld = position;
  vNormal = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
${COMMON}
uniform sampler2DArray tAlbedoArr;
uniform sampler2DArray tNormalArr;
uniform sampler2DArray tMaterialArr;
uniform sampler2D tSplat0;
uniform sampler2D tSplat1;
uniform float uLayerScale[8];
uniform vec4 uTerrain;      // originX, originZ, cellSize, vertices per side
uniform float uWaterLevel;
uniform int uRockLayer;
uniform int uWetLayer;
uniform float uWetness;
in vec3 vWorld;
in vec3 vNormal;
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gLight;

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 N = normalize(vNormal);
  vec2 suv = ((vWorld.xz - uTerrain.xy) / uTerrain.z + 0.5) / uTerrain.w;
  vec4 s0 = texture(tSplat0, suv), s1 = texture(tSplat1, suv);
  float w[8] = float[](s0.r, s0.g, s0.b, s0.a, s1.r, s1.g, s1.b, s1.a);
  float steep = smoothstep(0.42, 0.62, 1.0 - N.y);
  if (uRockLayer >= 0) w[uRockLayer] = max(w[uRockLayer], steep * 1.2);
  // break up layer borders with noise
  float bn = vnoise(vWorld.xz * 0.35) - 0.5;
  // projections: rock uses the dominant axis on steep faces
  vec2 uvTop = vWorld.xz;
  vec2 uvSide = abs(N.x) > abs(N.z) ? vec2(vWorld.z * sign(N.x), -vWorld.y) : vec2(-vWorld.x * sign(N.z), -vWorld.y);
  // explicit gradients: samples below happen in non-uniform control flow
  vec2 dTx = dFdx(uvTop), dTy = dFdy(uvTop);
  vec2 dSx = dFdx(uvSide), dSy = dFdy(uvSide);

  float hts[8];
  float best = -1e9;
  for (int i = 0; i < 8; i++) {
    hts[i] = -1e9;
    if (w[i] < 0.004) continue;
    bool sd = i == uRockLayer && steep > 0.3;
    float sc = 1.0 / uLayerScale[i];
    vec2 uv = (sd ? uvSide : uvTop) * sc;
    float h = textureGrad(tNormalArr, vec3(uv, float(i)), (sd ? dSx : dTx) * sc, (sd ? dSy : dTy) * sc).a;
    hts[i] = w[i] * 1.6 + h + bn * 0.25;
    best = max(best, hts[i]);
  }
  const float depth = 0.35;
  vec3 albedo = vec3(0.0);
  vec3 tn = vec3(0.0);
  vec4 mat = vec4(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    float b = hts[i] - (best - depth);
    if (b <= 0.0) continue;
    bool side = i == uRockLayer && steep > 0.3;
    float sc = 1.0 / uLayerScale[i];
    vec2 uv = (side ? uvSide : uvTop) * sc;
    vec2 gx = (side ? dSx : dTx) * sc, gy = (side ? dSy : dTy) * sc;
    vec3 layerUv = vec3(uv, float(i));
    albedo += textureGrad(tAlbedoArr, layerUv, gx, gy).rgb * b;
    vec3 n = textureGrad(tNormalArr, layerUv, gx, gy).xyz * 2.0 - 1.0;
    if (side) {
      // side projection: tangent frame follows the projection axes
      vec3 T = abs(N.x) > abs(N.z) ? vec3(0.0, 0.0, sign(N.x)) : vec3(-sign(N.z), 0.0, 0.0);
      vec3 B = vec3(0.0, 1.0, 0.0);
      tn += (T * n.x + B * n.y + N * n.z) * b;
    } else {
      tn += (vec3(n.x, 0.0, -n.y) + N * n.z) * b;
    }
    mat += textureGrad(tMaterialArr, layerUv, gx, gy) * b;
    wsum += b;
  }
  albedo /= wsum; mat /= wsum;
  vec3 nrm = normalize(tn / wsum + N * 0.35);

  // large-scale tonal variation hides tiling
  float m1 = vnoise(vWorld.xz * 0.031), m2 = vnoise(vWorld.xz * 0.11 + 13.0);
  albedo *= 0.86 + 0.18 * m1 + 0.08 * m2;
  albedo = mix(albedo, albedo * vec3(1.06, 1.02, 0.9), smoothstep(0.55, 0.9, m1) * 0.5);

  // wet ground near the water line
  float wet = smoothstep(uWaterLevel + 0.9, uWaterLevel + 0.05, vWorld.y);
  wet = max(wet, uWetness * saturate(N.y * 2.0 - 1.0) * 0.8);
  albedo *= mix(1.0, 0.55, wet);
  float rough = mix(mat.r, 0.12, wet);
  float flags = vWorld.y < uWaterLevel ? 4.0 : 0.0;
  gAlbedo = vec4(sqrt(max(albedo, 0.0)), mat.b);
  gNormal = vec4(encodeNormal(nrm), rough, mat.g);
  gLight = vec4(1.0, 0.0, mat.a, flags / 255.0);
}
`;

/**
 * Chunked heightfield renderer with 8-layer height-blended splatting,
 * automatic rock on steep slopes and wet shores. Outputs to the G-buffer.
 */
export class TerrainRenderer {
  /**
   * @param {object} o
   * @param {import('../render/RenderPipeline.js').RenderPipeline} o.pipeline
   * @param {import('./Heightfield.js').Heightfield} o.heightfield
   * @param {{albedo, normal, material}} o.layers DataArrayTextures (<= 8 layers)
   * @param {number[]} o.layerScales meters covered by one texture repeat, per layer
   * @param {Uint8Array} o.splat n*n*8 weights (0..255)
   */
  constructor({ pipeline, heightfield, layers, layerScales, splat, waterLevel = 0, rockLayer = -1, chunkCells = 32 }) {
    this.pipeline = pipeline;
    this.hf = heightfield;
    this.chunkCells = chunkCells;
    const n = heightfield.n;
    this.splat = splat;
    this.splat0 = new Uint8Array(n * n * 4);
    this.splat1 = new Uint8Array(n * n * 4);
    const mk = (data) => {
      const t = new DataTexture(data, n, n, RGBAFormat, UnsignedByteType);
      t.minFilter = t.magFilter = LinearFilter;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    this._packSplat(0, 0, n - 1, n - 1);
    this.tSplat0 = mk(this.splat0);
    this.tSplat1 = mk(this.splat1);
    const scales = new Array(8).fill(4);
    layerScales.forEach((v, i) => { scales[i] = v; });
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tAlbedoArr: { value: layers.albedo },
        tNormalArr: { value: layers.normal },
        tMaterialArr: { value: layers.material },
        tSplat0: { value: this.tSplat0 },
        tSplat1: { value: this.tSplat1 },
        uLayerScale: { value: scales },
        uTerrain: { value: new Vector4(heightfield.originX, heightfield.originZ, heightfield.cellSize, n) },
        uWaterLevel: { value: waterLevel },
        uRockLayer: { value: rockLayer },
        uWetLayer: { value: -1 },
        uWetness: pipeline.shared.uWetness,
      },
      side: DoubleSide,
    });
    this.chunks = [];
    const cc = chunkCells;
    const count = Math.ceil(heightfield.size / cc);
    this.chunkCount = count;
    for (let cz = 0; cz < count; cz++) {
      for (let cx = 0; cx < count; cx++) {
        const mesh = new Mesh(this._buildChunk(cx, cz), this.material);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrixWorld(true);
        pipeline.scene.add(mesh);
        pipeline.addShadowCaster(mesh);
        this.chunks.push(mesh);
      }
    }
  }

  _packSplat(i0, j0, i1, j1) {
    const n = this.hf.n;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        for (let c = 0; c < 4; c++) {
          this.splat0[k * 4 + c] = this.splat[k * 8 + c];
          this.splat1[k * 4 + c] = this.splat[k * 8 + 4 + c];
        }
      }
    }
  }

  _buildChunk(cx, cz) {
    const hf = this.hf;
    const cc = this.chunkCells;
    const i0 = cx * cc, j0 = cz * cc;
    const i1 = Math.min(hf.size, i0 + cc), j1 = Math.min(hf.size, j0 + cc);
    const w = i1 - i0 + 1, h = j1 - j0 + 1;
    const border = [];
    const onEdge = { l: i0 === 0, r: i1 === hf.size, t: j0 === 0, b: j1 === hf.size };
    const skirtCount = (onEdge.l ? h : 0) + (onEdge.r ? h : 0) + (onEdge.t ? w : 0) + (onEdge.b ? w : 0);
    const vcount = w * h + skirtCount;
    const pos = new Float32Array(vcount * 3);
    const nrm = new Float32Array(vcount * 3);
    const cs = hf.cellSize;
    const tmp = new Vector3();
    let minY = 1e9, maxY = -1e9;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const v = j * w + i;
        const x = hf.originX + (i0 + i) * cs, z = hf.originZ + (j0 + j) * cs;
        const y = hf.vertexHeight(i0 + i, j0 + j);
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        const hx = hf.vertexHeight(i0 + i + 1, j0 + j) - hf.vertexHeight(i0 + i - 1, j0 + j);
        const hz = hf.vertexHeight(i0 + i, j0 + j + 1) - hf.vertexHeight(i0 + i, j0 + j - 1);
        tmp.set(-hx, 2 * cs, -hz).normalize();
        nrm[v * 3] = tmp.x; nrm[v * 3 + 1] = tmp.y; nrm[v * 3 + 2] = tmp.z;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const idx = [];
    for (let j = 0; j < h - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
        // alternate the diagonal for a less regular look
        if ((i + j) & 1) { idx.push(a, c, b, b, c, d); } else { idx.push(a, c, d, a, d, b); }
      }
    }
    // skirts on the map border hide gaps against surrounding scenery
    let sv = w * h;
    const addSkirt = (list, flip) => {
      const start = sv;
      for (const v of list) {
        pos[sv * 3] = pos[v * 3]; pos[sv * 3 + 1] = pos[v * 3 + 1] - 25; pos[sv * 3 + 2] = pos[v * 3 + 2];
        nrm[sv * 3] = nrm[v * 3]; nrm[sv * 3 + 1] = nrm[v * 3 + 1]; nrm[sv * 3 + 2] = nrm[v * 3 + 2];
        sv++;
      }
      for (let k = 0; k < list.length - 1; k++) {
        const a = list[k], b = list[k + 1], sa = start + k, sb = start + k + 1;
        if (flip) idx.push(a, b, sa, b, sb, sa); else idx.push(a, sa, b, b, sa, sb);
      }
    };
    if (onEdge.t) addSkirt(Array.from({ length: w }, (_, i) => i), true);
    if (onEdge.b) addSkirt(Array.from({ length: w }, (_, i) => (h - 1) * w + i), false);
    if (onEdge.l) addSkirt(Array.from({ length: h }, (_, j) => j * w), false);
    if (onEdge.r) addSkirt(Array.from({ length: h }, (_, j) => j * w + w - 1), true);
    void border;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    geo.boundingBox = new Box3(
      new Vector3(hf.originX + i0 * cs, minY - 26, hf.originZ + j0 * cs),
      new Vector3(hf.originX + i1 * cs, maxY + 1, hf.originZ + j1 * cs),
    );
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new Sphere());
    return geo;
  }

  /** Rebuilds chunk meshes (and splat textures) inside a world rectangle. */
  updateRegion(minX, minZ, maxX, maxZ) {
    const hf = this.hf, cs = hf.cellSize, cc = this.chunkCells;
    const ci0 = Math.max(0, Math.floor((minX - hf.originX) / cs / cc) - (0));
    const ci1 = Math.min(this.chunkCount - 1, Math.floor((maxX - hf.originX) / cs / cc));
    const cj0 = Math.max(0, Math.floor((minZ - hf.originZ) / cs / cc));
    const cj1 = Math.min(this.chunkCount - 1, Math.floor((maxZ - hf.originZ) / cs / cc));
    for (let cz = cj0; cz <= cj1; cz++) {
      for (let cx = ci0; cx <= ci1; cx++) {
        const mesh = this.chunks[cz * this.chunkCount + cx];
        mesh.geometry.dispose();
        mesh.geometry = this._buildChunk(cx, cz);
      }
    }
    const n = hf.n;
    const i0 = Math.max(0, Math.floor((minX - hf.originX) / cs)), i1 = Math.min(n - 1, Math.ceil((maxX - hf.originX) / cs));
    const j0 = Math.max(0, Math.floor((minZ - hf.originZ) / cs)), j1 = Math.min(n - 1, Math.ceil((maxZ - hf.originZ) / cs));
    this._packSplat(i0, j0, i1, j1);
    this.tSplat0.needsUpdate = true;
    this.tSplat1.needsUpdate = true;
  }

  /** Paints a splat layer (0..7) with a soft circular brush. */
  paint(x, z, radius, layer, strength = 1) {
    const hf = this.hf, n = hf.n, cs = hf.cellSize;
    const i0 = Math.max(0, Math.floor((x - radius - hf.originX) / cs)), i1 = Math.min(n - 1, Math.ceil((x + radius - hf.originX) / cs));
    const j0 = Math.max(0, Math.floor((z - radius - hf.originZ) / cs)), j1 = Math.min(n - 1, Math.ceil((z + radius - hf.originZ) / cs));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(hf.originX + i * cs - x, hf.originZ + j * cs - z) / radius;
        if (d >= 1) continue;
        const a = (1 - d * d) * strength;
        const k = (j * n + i) * 8;
        let sum = 0;
        for (let c = 0; c < 8; c++) {
          const target = c === layer ? 255 : 0;
          this.splat[k + c] = this.splat[k + c] + (target - this.splat[k + c]) * Math.min(1, a);
          sum += this.splat[k + c];
        }
        if (sum > 0) for (let c = 0; c < 8; c++) this.splat[k + c] = Math.round(this.splat[k + c] * 255 / sum);
      }
    }
  }

  /** Paints a rectangle footprint (buildings / farms). */
  paintRect(cx, cz, halfX, halfZ, layer, border = 1.5) {
    const hf = this.hf, n = hf.n, cs = hf.cellSize;
    const i0 = Math.max(0, Math.floor((cx - halfX - border - hf.originX) / cs)), i1 = Math.min(n - 1, Math.ceil((cx + halfX + border - hf.originX) / cs));
    const j0 = Math.max(0, Math.floor((cz - halfZ - border - hf.originZ) / cs)), j1 = Math.min(n - 1, Math.ceil((cz + halfZ + border - hf.originZ) / cs));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = hf.originX + i * cs, z = hf.originZ + j * cs;
        const d = Math.hypot(Math.max(0, Math.abs(x - cx) - halfX), Math.max(0, Math.abs(z - cz) - halfZ));
        const a = d <= 0 ? 1 : Math.max(0, 1 - d / border);
        if (a <= 0) continue;
        const k = (j * n + i) * 8;
        let sum = 0;
        for (let c = 0; c < 8; c++) {
          const target = c === layer ? 255 : 0;
          this.splat[k + c] = this.splat[k + c] + (target - this.splat[k + c]) * a;
          sum += this.splat[k + c];
        }
        if (sum > 0) for (let c = 0; c < 8; c++) this.splat[k + c] = Math.round(this.splat[k + c] * 255 / sum);
      }
    }
  }
}
