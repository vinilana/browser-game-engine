import {
  RawShaderMaterial, GLSL3, DoubleSide, FrontSide, DataTexture, RGBAFormat, UnsignedByteType,
  RepeatWrapping, LinearFilter, LinearMipmapLinearFilter, Vector2,
} from 'three';
import { COMMON } from '../render/shaders/common.js';
import { ATMOSPHERE_CORE, ATMOSPHERE_LOOKUP } from '../render/shaders/atmosphere.js';
import { CLOUDS, ENV_LOOKUP } from '../render/shaders/sky.js';
import { SHADOW_SAMPLING } from '../render/shaders/shadows.js';
import { FOG_CHUNK, PBR_FUNCTIONS } from '../render/shaders/lighting.js';

// ---------------------------------------------------------------------------
// Shared vertex code: attribute decoding + wind animation.
// ---------------------------------------------------------------------------
const VOXEL_VERTEX_COMMON = /* glsl */ `
in vec4 position;   // x*16, y*16, z*16, texture layer
in vec4 data0;      // face | waving<<3 | tint<<5, u*16, v*16, ao(0..3)
in vec4 data1;      // sky*17, block*17, material flags, -
in vec4 tint;       // biome tint (sRGB)
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uWindStrength;

vec3 windOffset(vec3 world, int waving, float vcoord) {
  vec3 o = vec3(0.0);
  float t = uTime;
  if (waving == 1) {
    o.x = sin(t * 1.7 + world.x * 0.7 + world.y * 0.5) * 0.03 + sin(t * 3.3 + world.z * 1.3 + world.y) * 0.012;
    o.z = cos(t * 1.5 + world.z * 0.6 + world.y * 0.4) * 0.03 + sin(t * 2.9 + world.x * 1.1) * 0.01;
    o.y = sin(t * 2.1 + world.x * 0.9 + world.z * 0.9) * 0.018;
  } else if (waving >= 2) {
    float top = 1.0 - vcoord;
    float gust = sin(t * 0.63 + world.x * 0.045 + world.z * 0.031) * 0.5 + 0.5;
    o.x = (sin(t * 2.1 + world.x * 0.8 + world.z * 0.35) * 0.07 + gust * gust * 0.12) * top;
    o.z = (cos(t * 1.8 + world.z * 0.7 + world.x * 0.25) * 0.055 + gust * 0.03) * top;
    o.y = -abs(o.x) * 0.3 * top;
  }
  return o * uWindStrength;
}
`;

const GBUFFER_VERT = /* glsl */ `
precision highp float;
precision highp int;
${VOXEL_VERTEX_COMMON}
out vec3 vUvL;
out vec4 vLight;       // sky, block, ao, -
out vec3 vTint;
out vec3 vViewPos;
out vec3 vWorld;
flat out int vFace;
flat out int vMat;
flat out int vTintMode;

void main() {
  vec3 local = position.xyz / 16.0;
  int flags = int(data0.x + 0.5);
  int face = flags & 7;
  int waving = (flags >> 3) & 3;
  vTintMode = (flags >> 5) & 3;
  vec3 world = (modelMatrix * vec4(local, 1.0)).xyz;
  vec2 uv = data0.yz / 16.0;
  local += windOffset(world, waving, uv.y);
  vec4 mv = modelViewMatrix * vec4(local, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewPos = mv.xyz;
  vWorld = world;
  vUvL = vec3(uv, position.w);
  float ao = data0.w / 3.0;
  vLight = vec4(data1.x / 255.0, data1.y / 255.0, 0.38 + 0.62 * pow(ao, 1.15), 0.0);
  vTint = pow(tint.rgb / 255.0, vec3(2.2));
  vFace = face;
  vMat = int(data1.z + 0.5);
}
`;

const FACE_TABLES = /* glsl */ `
const vec3 FN[6] = vec3[](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1));
const vec3 FT[6] = vec3[](vec3(0,0,-1), vec3(0,0,1), vec3(1,0,0), vec3(1,0,0), vec3(1,0,0), vec3(-1,0,0));
const vec3 FB[6] = vec3[](vec3(0,1,0), vec3(0,1,0), vec3(0,0,-1), vec3(0,0,1), vec3(0,1,0), vec3(0,1,0));
`;

const GBUFFER_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;
${COMMON}
${FACE_TABLES}
uniform sampler2DArray tAlbedoArr;
uniform sampler2DArray tNormalArr;
uniform sampler2DArray tMaterialArr;
uniform float uTexSize;
uniform float uCutout;
uniform float uParallax;
uniform mat4 viewMatrix;
in vec3 vUvL;
in vec4 vLight;
in vec3 vTint;
in vec3 vViewPos;
in vec3 vWorld;
flat in int vFace;
flat in int vMat;
flat in int vTintMode;
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gLight;

void main() {
  vec2 uv = vUvL.xy;
  float layer = vUvL.z;
  vec3 N = FN[vFace];
  vec3 T = FT[vFace];
  vec3 B = FB[vFace];
  bool plant = (vMat & 2) != 0;

  // Parallax occlusion mapping (close range, opaque blocks only)
  if (uParallax > 0.5 && uCutout < 0.5) {
    float dist = length(vViewPos);
    if (dist < 14.0) {
      mat3 viewRot = mat3(viewMatrix);
      vec3 Vw = normalize(-(transpose(viewRot) * vViewPos));
      vec3 Vt = vec3(dot(Vw, T), dot(Vw, B), dot(Vw, N));
      float scale = 0.045 * (1.0 - smoothstep(8.0, 14.0, dist));
      vec2 dir = vec2(-Vt.x, Vt.y) / max(Vt.z, 0.25) * scale;
      const int STEPS = 12;
      float stepH = 1.0 / float(STEPS);
      float curH = 1.0;
      vec2 cur = uv;
      float h = texture(tNormalArr, vec3(cur, layer)).a;
      float prevH = h;
      vec2 prevUv = cur;
      for (int i = 0; i < STEPS; i++) {
        if (h >= curH) break;
        prevUv = cur; prevH = h;
        cur += dir * stepH;
        curH -= stepH;
        h = texture(tNormalArr, vec3(cur, layer)).a;
      }
      float a = (h - curH);
      float b = (prevH - (curH + stepH));
      float w = a / max(a - b, 1e-4);
      uv = mix(cur, prevUv, clamp(w, 0.0, 1.0));
    }
  }

  vec4 alb = texture(tAlbedoArr, vec3(uv, layer));
  if (uCutout > 0.5) {
    vec2 px = uv * uTexSize;
    vec2 dx = dFdx(px), dy = dFdy(px);
    float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
    if (alb.a * (1.0 + lod * 0.3) < 0.5) discard;
  }
  vec3 albedo = alb.rgb;
  // world-space macro variation hides texture tiling at mid/long range
  {
    vec2 mp = vWorld.xz * 0.045 + vWorld.y * 0.021;
    vec2 ip = floor(mp), fp = fract(mp);
    fp = fp * fp * (3.0 - 2.0 * fp);
    float m1 = mix(mix(hash12(ip), hash12(ip + vec2(1.0, 0.0)), fp.x), mix(hash12(ip + vec2(0.0, 1.0)), hash12(ip + vec2(1.0, 1.0)), fp.x), fp.y);
    vec2 mp2 = mp * 4.1 + 17.0;
    vec2 ip2 = floor(mp2), fp2 = fract(mp2);
    fp2 = fp2 * fp2 * (3.0 - 2.0 * fp2);
    float m2 = mix(mix(hash12(ip2), hash12(ip2 + vec2(1.0, 0.0)), fp2.x), mix(hash12(ip2 + vec2(0.0, 1.0)), hash12(ip2 + vec2(1.0, 1.0)), fp2.x), fp2.y);
    albedo *= 0.9 + 0.13 * m1 + 0.07 * m2;
  }
  if (vTintMode == 1) albedo *= vTint;
  else if (vTintMode == 2) albedo *= mix(vec3(1.0), vTint, alb.a);

  vec4 mat = texture(tMaterialArr, vec3(uv, layer));
  vec3 n;
  if (plant) {
    n = vec3(0.0, 1.0, 0.0);
  } else {
    vec3 tn = texture(tNormalArr, vec3(uv, layer)).xyz * 2.0 - 1.0;
    if (!gl_FrontFacing) { N = -N; tn.x = -tn.x; }
    n = normalize(T * tn.x + B * tn.y + N * tn.z);
  }
  float ao = vLight.z * mat.b;
  gAlbedo = vec4(sqrt(max(albedo, 0.0)), ao);
  gNormal = vec4(encodeNormal(n), mat.r, mat.g);
  gLight = vec4(vLight.x, vLight.y, mat.a, float(vMat & 31) / 255.0);
}
`;

const SHADOW_VERT = /* glsl */ `
precision highp float;
precision highp int;
${VOXEL_VERTEX_COMMON}
out vec3 vUvL;
void main() {
  vec3 local = position.xyz / 16.0;
  int flags = int(data0.x + 0.5);
  int waving = (flags >> 3) & 3;
  vec3 world = (modelMatrix * vec4(local, 1.0)).xyz;
  vec2 uv = data0.yz / 16.0;
  local += windOffset(world, waving, uv.y);
  vUvL = vec3(uv, position.w);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
}
`;

const SHADOW_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray tAlbedoArr;
uniform float uCutout;
in vec3 vUvL;
layout(location = 0) out vec4 outColor;
void main() {
  if (uCutout > 0.5 && texture(tAlbedoArr, vUvL).a < 0.5) discard;
  outColor = vec4(1.0);
}
`;

// ---------------------------------------------------------------------------
// Translucent (water / glass) forward shader.
// ---------------------------------------------------------------------------
const TRANSLUCENT_VERT = /* glsl */ `
precision highp float;
precision highp int;
${VOXEL_VERTEX_COMMON}
out vec3 vUvL;
out vec4 vLight;
out vec3 vViewPos;
out vec3 vWorld;
out vec3 vTint;
flat out int vFace;
flat out int vMat;
void main() {
  vec3 local = position.xyz / 16.0;
  int flags = int(data0.x + 0.5);
  vec3 world = (modelMatrix * vec4(local, 1.0)).xyz;
  vec4 mv = modelViewMatrix * vec4(local, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewPos = mv.xyz;
  vWorld = world;
  vUvL = vec3(data0.yz / 16.0, position.w);
  vLight = vec4(data1.x / 255.0, data1.y / 255.0, 1.0, 0.0);
  vTint = pow(tint.rgb / 255.0, vec3(2.2));
  vFace = flags & 7;
  vMat = int(data1.z + 0.5);
}
`;

const TRANSLUCENT_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler3D;
${COMMON}
${ATMOSPHERE_CORE}
${ATMOSPHERE_LOOKUP}
${CLOUDS}
${ENV_LOOKUP}
${SHADOW_SAMPLING}
${PBR_FUNCTIONS}
${FACE_TABLES}
uniform vec3 uCameraPos;
uniform mat4 uCamRot;
uniform mat4 projectionMatrix;
uniform float uFrame;
${FOG_CHUNK}
uniform sampler2D tSceneColor;
uniform sampler2D tSceneDepth;
uniform sampler2DArray tAlbedoArr;
uniform sampler2DArray tNormalArr;
uniform sampler2DArray tMaterialArr;
uniform sampler2D tWaterNormal;
uniform vec2 uResolution;
uniform float uUnderwater;
uniform vec3 uBlockLightColor;
uniform float uBlockLightIntensity;
uniform float uWetness;
in vec3 vUvL;
in vec4 vLight;
in vec3 vViewPos;
in vec3 vWorld;
in vec3 vTint;
flat in int vFace;
flat in int vMat;
layout(location = 0) out vec4 fragColor;

float waterSlick(vec2 p) {
  // large-scale wind patches: calmer (glassy) vs. rougher water
  float a = texture(tCloudNoise, vec3(p * 0.0035 + uTime * 0.0012, 0.23)).r;
  float b = texture(tCloudNoise, vec3(p * 0.011 - uTime * 0.002, 0.61)).g;
  return saturate(a * 0.7 + b * 0.5 - 0.1);
}

vec3 waterNormal(vec2 p, float dist, float slick) {
  float t = uTime;
  vec3 n0 = texture(tWaterNormal, p * 0.018 + vec2(t * 0.004, -t * 0.003)).xyz * 2.0 - 1.0;
  vec3 n1 = texture(tWaterNormal, p * 0.055 + vec2(t * 0.011, t * 0.007)).xyz * 2.0 - 1.0;
  vec3 n2 = texture(tWaterNormal, p * 0.13 + vec2(-t * 0.017, t * 0.021)).xyz * 2.0 - 1.0;
  vec3 n3 = texture(tWaterNormal, p * 0.31 + vec2(t * 0.031, -t * 0.026)).xyz * 2.0 - 1.0;
  vec2 d = n0.xy * 0.85 + n1.xy * 0.6 + n2.xy * 0.35 + n3.xy * 0.2 * (1.0 - saturate(dist / 60.0));
  float strength = mix(0.75, 1.7, slick) * (1.0 + uWetness * 0.6);
  return normalize(vec3(d.x * strength, 1.0, d.y * strength));
}

vec3 viewToScreen(vec3 v) {
  vec4 c = projectionMatrix * vec4(v, 1.0);
  return vec3(c.xy / c.w * 0.5 + 0.5, c.w);
}

// Screen-space reflection against the opaque scene copy.
vec4 traceSSR(vec3 originV, vec3 dirV, float dither) {
  if (dirV.z > 0.2) return vec4(0.0);
  float stepLen = 0.6;
  vec3 p = originV + dirV * stepLen * dither;
  vec3 prev = originV;
  for (int i = 0; i < 40; i++) {
    prev = p;
    p += dirV * stepLen;
    stepLen *= 1.09;
    vec3 s = viewToScreen(p);
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z <= 0.0) return vec4(0.0);
    float sceneDist = texture(tSceneDepth, s.xy).x;
    float rayDist = length(p);
    if (rayDist > sceneDist && rayDist - sceneDist < stepLen * 2.5 + 0.4) {
      // refine
      vec3 a = prev, b = p;
      for (int k = 0; k < 5; k++) {
        vec3 m = (a + b) * 0.5;
        vec3 ms = viewToScreen(m);
        if (length(m) > texture(tSceneDepth, ms.xy).x) b = m; else a = m;
      }
      vec3 hs = viewToScreen(b);
      vec2 edge = smoothstep(0.0, 0.08, hs.xy) * smoothstep(1.0, 0.92, hs.xy);
      return vec4(texture(tSceneColor, hs.xy).rgb, edge.x * edge.y);
    }
  }
  return vec4(0.0);
}

void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec3 pRel = (uCamRot * vec4(vViewPos, 0.0)).xyz;
  float dist = length(pRel);
  vec3 V = -pRel / max(dist, 1e-4);
  float sky = vLight.x;
  float blk = vLight.y;
  bool isWater = (vMat & 32) != 0;
  bool underside = (vMat & 64) != 0;
  float dither = ignT(gl_FragCoord.xy, uFrame);
  vec3 lightCol = directLightColor();
  vec3 L = uLightDir;

  vec3 N = FN[vFace];
  float slick = isWater ? waterSlick(vWorld.xz) : 0.5;
  if (isWater && (vFace == 2 || vFace == 3)) {
    vec3 wn = waterNormal(vWorld.xz, dist, slick);
    N = vFace == 2 ? wn : vec3(wn.x, -wn.y, wn.z);
  }
  float sceneDist = texture(tSceneDepth, suv).x;

  vec3 color;
  float shadowVis = 1.0;
  if (dot(lightCol, lightCol) > 0.0) {
    vec2 sh = sampleShadow(pRel, FN[vFace], 1.0, dist, dither, 6);
    shadowVis = mix(smoothstep(0.86, 1.0, sky), sh.x, sh.y) * cloudShadowAt(pRel + uCameraPos, L);
  }
  float skyAmb = pow(sky, 2.2);

  if (isWater) {
    // Refraction with depth-aware distortion
    float thickness = max(sceneDist - dist, 0.0);
    vec2 offs = N.xz * 0.05 * saturate(thickness * 0.4) / (1.0 + dist * 0.03);
    vec2 ruv = suv + offs;
    float rDist = texture(tSceneDepth, ruv).x;
    if (rDist < dist) { ruv = suv; rDist = sceneDist; }
    thickness = max(rDist - dist, 0.0);
    vec3 refr = texture(tSceneColor, ruv).rgb;

    vec3 sigmaA = vec3(0.42, 0.14, 0.11);
    vec3 absorb = exp(-sigmaA * min(thickness, 200.0));
    vec3 inscatterLight = (shIrradiance(vec3(0.0, 1.0, 0.0)) * skyAmb * 0.9 + lightCol * shadowVis * max(L.y, 0.0) * 0.1)
                        + uBlockLightColor * uBlockLightIntensity * exp2((blk * 15.0 - 15.0) * 0.46) * step(0.01, blk) * 0.3;
    float deep = saturate(thickness / 14.0);
    vec3 waterCol = mix(vec3(0.016, 0.045, 0.042), vec3(0.0035, 0.014, 0.028), deep) * vTint;
    vec3 under = refr * absorb + waterCol * inscatterLight * (1.0 - absorb);

    if (underside || uUnderwater > 0.5) {
      // seen from below: Snell's window
      float cosI = abs(dot(N, V));
      float tir = smoothstep(0.62, 0.48, cosI);
      vec3 deep = waterCol * inscatterLight * 0.6;
      color = mix(refr, deep, tir);
    } else {
      vec3 R = reflect(-V, N);
      R.y = abs(R.y);
      float rough = mix(0.02, 0.16, saturate(dist / 200.0)) + slick * 0.06;
      vec3 envR = envRadiance(R, rough) * mix(0.15, 1.0, skyAmb);
      vec3 Rv = normalize((transpose(uCamRot) * vec4(R, 0.0)).xyz);
      vec4 ssr = traceSSR(vViewPos, Rv, dither);
      vec3 refl = mix(envR, ssr.rgb, ssr.a);
      float NdotV = saturate(dot(N, V));
      float F = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
      color = mix(under, refl, F);
#ifdef DEBUG_WATER
      if (DEBUG_WATER == 1) { fragColor = vec4(under, 1.0); return; }
      if (DEBUG_WATER == 2) { fragColor = vec4(refl, 1.0); return; }
      if (DEBUG_WATER == 3) { fragColor = vec4(vec3(F), 1.0); return; }
      if (DEBUG_WATER == 4) { fragColor = vec4(N * 0.5 + 0.5, 1.0); return; }
#endif
      // sun glint
      vec3 H = normalize(L + V);
      float NdotL = saturate(dot(N, L));
      float a = mix(0.03, 0.09, slick) + saturate(dist / 300.0) * 0.08;
      vec3 spec = D_GGX(saturate(dot(N, H)), a * a) * V_SmithGGXCorrelated(NdotV, NdotL, a * a) * F_Schlick(vec3(0.02), saturate(dot(V, H)));
      color += spec * lightCol * NdotL * shadowVis;
      // shoreline foam
      float foamN = texture(tCloudNoise, vec3(vWorld.xz * 0.35 + uTime * 0.02, uTime * 0.01)).g;
      float foam = smoothstep(0.3, 0.02, thickness) * smoothstep(0.55, 0.85, foamN + 0.2 * sin(uTime * 1.5 + thickness * 8.0));
      color = mix(color, (shIrradiance(vec3(0.0, 1.0, 0.0)) * skyAmb + lightCol * shadowVis * max(L.y, 0.0) / PI) * 0.7, foam * 0.35);
    }
  } else {
    // glass
    vec4 alb = texture(tAlbedoArr, vUvL);
    vec4 mat = texture(tMaterialArr, vUvL);
    vec3 tn = texture(tNormalArr, vUvL).xyz * 2.0 - 1.0;
    vec3 n = normalize(FT[vFace] * tn.x + FB[vFace] * tn.y + FN[vFace] * tn.z);
    if (dot(n, V) < 0.0) n = -n;
    vec2 ruv = suv + n.xz * 0.004;
    vec3 refr = texture(tSceneColor, ruv).rgb;
    vec3 tint = mix(vec3(0.93, 0.97, 0.96), alb.rgb, 0.3);
    vec3 R = reflect(-V, n);
    float NdotV = saturate(dot(n, V));
    float F = 0.04 + 0.96 * pow(1.0 - NdotV, 5.0);
    vec3 refl = envRadiance(R, 0.05) * skyAmb;
    vec3 body = refr * tint;
    // opaque frame / streaks lit as a dielectric
    vec3 frameLit = alb.rgb * (shIrradiance(n) * skyAmb + lightCol * saturate(dot(n, L)) * shadowVis / PI
                    + uBlockLightColor * uBlockLightIntensity * exp2((blk * 15.0 - 15.0) * 0.46) * step(0.01, blk));
    color = mix(body, frameLit, alb.a);
    color = mix(color, refl, F * (1.0 - alb.a));
    vec3 H = normalize(L + V);
    float NdotL = saturate(dot(n, L));
    color += D_GGX(saturate(dot(n, H)), 0.004) * 0.25 * F * lightCol * NdotL * shadowVis;
  }

  color = applyFog(color, pRel, dist, sky, suv);
  fragColor = vec4(max(color, 0.0), 1.0);
}
`;

/** Builds a tileable water normal map from a sum of periodic waves. */
export function createWaterNormalTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const waves = [];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 28; i++) {
    const k = 1 + Math.floor(rnd() * (2 + i * 0.9));
    const ang = rnd() * Math.PI * 2;
    const kx = Math.round(Math.cos(ang) * k), ky = Math.round(Math.sin(ang) * k);
    if (kx === 0 && ky === 0) continue;
    const amp = 1 / Math.pow(Math.hypot(kx, ky), 1.35);
    waves.push([kx, ky, amp, rnd() * Math.PI * 2]);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let dx = 0, dy = 0;
      for (const [kx, ky, a, ph] of waves) {
        // sharpened (trochoid-like) wave: derivative of a*(1-|sin|)^1.5 approximated with cos
        const th = 2 * Math.PI * (kx * u + ky * v) + ph;
        const c = Math.cos(th) * a;
        dx += c * kx;
        dy += c * ky;
      }
      const s = 0.09;
      let nx = -dx * s, ny = -dy * s, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const o = (y * size + x) * 4;
      data[o] = (nx * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * 0.5 + 0.5) * 255;
      data[o + 2] = (nz * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Creates every material used to draw voxel chunks.
 * @param {object} shared uniforms shared with the render pipeline
 * @param {{albedo, normal, material}} arrays DataArrayTextures
 */
export function createVoxelMaterials(shared, arrays, texSize) {
  const common = {
    uTime: shared.uTime,
    uWindStrength: { value: 1 },
    tAlbedoArr: { value: arrays.albedo },
    tNormalArr: { value: arrays.normal },
    tMaterialArr: { value: arrays.material },
    uTexSize: { value: texSize },
    uParallax: { value: 1 },
  };
  const gbuf = (cutout) => new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: GBUFFER_VERT,
    fragmentShader: GBUFFER_FRAG,
    uniforms: { ...common, uCutout: { value: cutout ? 1 : 0 } },
    side: cutout ? DoubleSide : FrontSide,
  });
  const shadow = (cutout) => new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: SHADOW_VERT,
    fragmentShader: SHADOW_FRAG,
    uniforms: { ...common, uCutout: { value: cutout ? 1 : 0 } },
    side: cutout ? DoubleSide : FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1.2,
    polygonOffsetUnits: 2,
  });
  const waterNormal = createWaterNormalTexture(256);
  const translucent = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: TRANSLUCENT_VERT,
    fragmentShader: TRANSLUCENT_FRAG,
    uniforms: {
      ...shared,
      ...common,
      tWaterNormal: { value: waterNormal },
    },
    side: FrontSide,
    depthWrite: true,
  });
  return {
    opaque: gbuf(false),
    cutout: gbuf(true),
    translucent,
    shadowOpaque: shadow(false),
    shadowCutout: shadow(true),
    common,
    waterNormal,
  };
}
