import { ShaderMaterial, GLSL3, Color, FrontSide, Vector2 } from 'three';
import { COMMON } from '../shaders/common.js';

// Shared vertex code (also used by the matching shadow material).
const VERT_COMMON = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <color_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
uniform vec2 uUvScale;
uniform float uTime;
uniform float uWindStrength;
#ifdef USE_WIND
in float aWind;
#endif
out vec2 vUv;
out vec3 vNormalW;
out vec3 vWorldPos;

vec3 windDisplace(vec3 wp, float w) {
  float t = uTime;
  float gust = sin(t * 0.55 + wp.x * 0.021 + wp.z * 0.017) * 0.5 + 0.5;
  vec3 o;
  o.x = sin(t * 1.3 + wp.x * 0.13 + wp.y * 0.09) * 0.6 + gust * 0.9;
  o.z = cos(t * 1.1 + wp.z * 0.11 + wp.y * 0.07) * 0.5 + gust * 0.35;
  o.y = sin(t * 2.3 + wp.x * 0.7 + wp.z * 0.6) * 0.15;
  // leaf flutter
  o += vec3(sin(t * 6.1 + wp.y * 3.1 + wp.x), sin(t * 5.3 + wp.z * 2.7), cos(t * 6.7 + wp.x * 2.9)) * 0.12;
  return o * w * uWindStrength * 0.12;
}

void computeVertex() {
  vUv = uv * uUvScale;
  #include <color_vertex>
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 n = objectNormal;
  #ifdef USE_INSTANCING
    n = mat3(instanceMatrix) * n;
  #endif
  #ifdef USE_BATCHING
    n = mat3(batchingMatrix) * n;
  #endif
  vNormalW = normalize(mat3(modelMatrix) * n);
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  vec4 lp = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    lp = batchingMatrix * lp;
  #endif
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
  #endif
  vec4 wp = modelMatrix * lp;
  #ifdef USE_WIND
    wp.xyz += windDisplace(wp.xyz, aWind);
  #endif
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const VERT = /* glsl */ `
${VERT_COMMON}
void main() { computeVertex(); }
`;

const FRAG = /* glsl */ `
${COMMON}
uniform vec3 uColor;
uniform sampler2D tMap;
uniform sampler2D tNormalMap;
uniform sampler2D tMaterialMap;
uniform float uNormalScale;
uniform float uRoughness;
uniform float uMetalness;
uniform float uEmissive;
uniform float uSkyLight;
uniform float uBlockLight;
uniform float uFlags;
uniform float uAlphaTest;
uniform float uClipY;
in vec2 vUv;
in vec3 vNormalW;
in vec3 vWorldPos;
#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA) || defined(USE_INSTANCING_COLOR) || defined(USE_BATCHING_COLOR)
in vec4 vColor;
#endif
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gLight;

vec3 perturbNormal(vec3 N, vec3 p, vec2 uv, vec3 mapN) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  return normalize(mat3(T * invmax, B * invmax, N) * mapN);
}

void main() {
  if (vWorldPos.y > uClipY) discard;
  vec3 albedo = uColor;
#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA) || defined(USE_INSTANCING_COLOR) || defined(USE_BATCHING_COLOR)
  albedo *= vColor.rgb;
#endif
#ifdef USE_MAP
  vec4 t = texture(tMap, vUv);
  float coverage = t.a;
#ifdef ALPHA_MAX_LOD
  // thin cutouts (grass blades, wheat) melt into solid cards at low mips: take the
  // coverage from a clamped mip instead (TAA resolves the extra aliasing)
  vec2 tsz = vec2(textureSize(tMap, 0));
  vec2 ddx = dFdx(vUv * tsz), ddy = dFdy(vUv * tsz);
  float lod = 0.5 * log2(max(max(dot(ddx, ddx), dot(ddy, ddy)), 1e-8));
  if (lod > ALPHA_MAX_LOD) coverage = textureLod(tMap, vUv, ALPHA_MAX_LOD).a;
#endif
  if (coverage < uAlphaTest) discard;
  albedo *= t.rgb;
#endif
  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  float rough = uRoughness, metal = uMetalness, ao = 1.0, emit = uEmissive;
#ifdef USE_MATERIALMAP
  vec4 m = texture(tMaterialMap, vUv);
  rough *= m.r; metal *= m.g; ao = m.b; emit += m.a;
#endif
#ifdef USE_NORMALMAP
  vec3 mapN = texture(tNormalMap, vUv).xyz * 2.0 - 1.0;
  mapN.y = -mapN.y;           // procedural maps store "image up" in +y
  mapN.xy *= uNormalScale;
  n = perturbNormal(n, vWorldPos, vUv, normalize(mapN));
#endif
  gAlbedo = vec4(sqrt(max(albedo, 0.0)), ao);
  gNormal = vec4(encodeNormal(n), clamp(rough, 0.03, 1.0), metal);
  gLight = vec4(uSkyLight, uBlockLight, emit, uFlags / 255.0);
}
`;

const SHADOW_FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform float uAlphaTest;
uniform float uClipY;
in vec2 vUv;
in vec3 vWorldPos;
layout(location = 0) out vec4 outColor;
void main() {
  if (vWorldPos.y > uClipY) discard;
#ifdef USE_MAP
  if (texture(tMap, vUv).a < uAlphaTest) discard;
#endif
  outColor = vec4(1.0);
}
`;

let _timeUniform = { value: 0 };
/** Lets every GBufferMaterial share the pipeline clock (for wind). */
export function setGBufferTimeUniform(u) { _timeUniform = u; }

/**
 * Deferred G-buffer material for arbitrary meshes (entities, props, GLTF).
 * Colors are linear; `map` should be an sRGB texture. Supports normal maps
 * (tangent-free), a packed material map (r=roughness, g=metalness, b=AO,
 * a=emission), vertex/instance colors, skinning, morphing, instancing,
 * wind animation (per-vertex `aWind` weight) and a world-height clip plane.
 */
export class GBufferMaterial extends ShaderMaterial {
  constructor({
    color = new Color(1, 1, 1), map = null, normalMap = null, materialMap = null, normalScale = 1,
    roughness = 0.8, metalness = 0, emissive = 0, vertexColors = false, side = FrontSide, alphaTest = 0.5,
    wind = false, uvScale = [1, 1], flags = 8, alphaMaxLod = -1,
  } = {}) {
    const defines = {};
    if (map) defines.USE_MAP = '';
    if (map && alphaMaxLod >= 0) defines.ALPHA_MAX_LOD = alphaMaxLod.toFixed(1);
    if (normalMap) defines.USE_NORMALMAP = '';
    if (materialMap) defines.USE_MATERIALMAP = '';
    if (wind) defines.USE_WIND = '';
    super({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines,
      side,
      vertexColors,
      uniforms: {
        uColor: { value: color instanceof Color ? color : new Color(color) },
        tMap: { value: map },
        tNormalMap: { value: normalMap },
        tMaterialMap: { value: materialMap },
        uNormalScale: { value: normalScale },
        uRoughness: { value: roughness },
        uMetalness: { value: metalness },
        uEmissive: { value: emissive },
        uSkyLight: { value: 1 },
        uBlockLight: { value: 0 },
        uFlags: { value: flags },
        uAlphaTest: { value: alphaTest },
        uClipY: { value: 1e9 },
        uUvScale: { value: new Vector2(uvScale[0], uvScale[1]) },
        uTime: _timeUniform,
        uWindStrength: { value: 1 },
      },
    });
    this.isGBufferMaterial = true;
  }

  setLight(sky, block) {
    this.uniforms.uSkyLight.value = sky;
    this.uniforms.uBlockLight.value = block;
  }

  /** Depth-only material matching this one (alpha test, wind, clip, instancing). */
  getShadowMaterial() {
    if (this._shadow) return this._shadow;
    const defines = {};
    if (this.defines.USE_MAP !== undefined) defines.USE_MAP = '';
    if (this.defines.USE_WIND !== undefined) defines.USE_WIND = '';
    this._shadow = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: SHADOW_FRAG,
      defines,
      side: this.side,
      uniforms: this.uniforms,
      polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2,
    });
    return this._shadow;
  }

  clone() {
    const m = super.clone();
    m.isGBufferMaterial = true;
    // keep sharing textures and the clock instead of deep-copying them
    for (const k of Object.keys(this.uniforms)) {
      const v = this.uniforms[k].value;
      if (v && v.isTexture) m.uniforms[k].value = v;
    }
    m.uniforms.uTime = _timeUniform;
    m._shadow = null;
    return m;
  }
}

/** Generic depth material (instancing / skinning / morph aware). */
export function createDefaultShadowMaterial() {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: SHADOW_FRAG,
    uniforms: {
      tMap: { value: null }, uAlphaTest: { value: 0 }, uClipY: { value: 1e9 }, uUvScale: { value: new Vector2(1, 1) },
      uTime: { value: 0 }, uWindStrength: { value: 0 },
    },
    polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2,
  });
}
