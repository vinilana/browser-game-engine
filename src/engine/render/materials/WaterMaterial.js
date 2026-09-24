import { RawShaderMaterial, GLSL3, FrontSide, Vector3, Color } from 'three';
import { COMMON } from '../shaders/common.js';
import { ATMOSPHERE_CORE, ATMOSPHERE_LOOKUP } from '../shaders/atmosphere.js';
import { CLOUDS, ENV_LOOKUP } from '../shaders/sky.js';
import { SHADOW_SAMPLING } from '../shaders/shadows.js';
import { FOG_CHUNK, PBR_FUNCTIONS, WORLD_MASK_CHUNK } from '../shaders/lighting.js';
import { createWaterNormalTexture } from '../../voxel/VoxelMaterials.js';

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec3 vViewPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
${COMMON}
${ATMOSPHERE_CORE}
${ATMOSPHERE_LOOKUP}
${CLOUDS}
${ENV_LOOKUP}
${SHADOW_SAMPLING}
${PBR_FUNCTIONS}
uniform vec3 uCameraPos;
uniform mat4 uCamRot;
uniform mat4 projectionMatrix;
uniform float uFrame;
${FOG_CHUNK}
${WORLD_MASK_CHUNK}
uniform sampler2D tSceneColor;
uniform sampler2D tSceneDepth;
uniform sampler2D tWaterNormal;
uniform vec2 uResolution;
uniform float uUnderwater;
uniform float uWetness;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uAbsorption;
uniform float uWaveScale;
uniform float uFoam;
in vec3 vWorld;
in vec3 vViewPos;
layout(location = 0) out vec4 fragColor;

float slickAt(vec2 p) {
  float a = texture(tCloudNoise, vec3(p * 0.0035 + uTime * 0.0012, 0.23)).r;
  float b = texture(tCloudNoise, vec3(p * 0.011 - uTime * 0.002, 0.61)).g;
  return saturate(a * 0.7 + b * 0.5 - 0.1);
}

vec3 waterNormal(vec2 p, float dist, float slick) {
  float t = uTime;
  p *= uWaveScale;
  vec3 n0 = texture(tWaterNormal, p * 0.018 + vec2(t * 0.004, -t * 0.003)).xyz * 2.0 - 1.0;
  vec3 n1 = texture(tWaterNormal, p * 0.055 + vec2(t * 0.011, t * 0.007)).xyz * 2.0 - 1.0;
  vec3 n2 = texture(tWaterNormal, p * 0.13 + vec2(-t * 0.017, t * 0.021)).xyz * 2.0 - 1.0;
  vec3 n3 = texture(tWaterNormal, p * 0.31 + vec2(t * 0.031, -t * 0.026)).xyz * 2.0 - 1.0;
  vec2 d = n0.xy * 0.85 + n1.xy * 0.6 + n2.xy * 0.35 + n3.xy * 0.2 * (1.0 - saturate(dist / 80.0));
  float strength = mix(0.6, 1.4, slick) * (1.0 + uWetness * 0.6);
  return normalize(vec3(d.x * strength, 1.0, d.y * strength));
}

vec3 viewToScreen(vec3 v) {
  vec4 c = projectionMatrix * vec4(v, 1.0);
  return vec3(c.xy / c.w * 0.5 + 0.5, c.w);
}

vec4 traceSSR(vec3 originV, vec3 dirV, float dither) {
  if (dirV.z > 0.3) return vec4(0.0);
  float stepLen = 0.8;
  vec3 p = originV + dirV * stepLen * dither;
  vec3 prev = originV;
  for (int i = 0; i < 40; i++) {
    prev = p;
    p += dirV * stepLen;
    stepLen *= 1.1;
    vec3 s = viewToScreen(p);
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z <= 0.0) return vec4(0.0);
    float sceneDist = texture(tSceneDepth, s.xy).x;
    float rayDist = length(p);
    if (rayDist > sceneDist && rayDist - sceneDist < stepLen * 2.5 + 0.5) {
      vec3 a = prev, b = p;
      for (int k = 0; k < 5; k++) {
        vec3 m = (a + b) * 0.5;
        if (length(m) > texture(tSceneDepth, viewToScreen(m).xy).x) b = m; else a = m;
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
  float dither = ignT(gl_FragCoord.xy, uFrame);
  vec3 lightCol = directLightColor();
  vec3 L = uLightDir;
  float slick = slickAt(vWorld.xz);
  vec3 N = waterNormal(vWorld.xz, dist, slick);
  bool fromBelow = dot(V, vec3(0.0, 1.0, 0.0)) < 0.0;
  if (fromBelow) N = -N;

  float shadowVis = 1.0;
  if (dot(lightCol, lightCol) > 0.0) {
    vec2 sh = sampleShadow(pRel, vec3(0.0, 1.0, 0.0), 1.0, dist, dither, 6);
    shadowVis = mix(1.0, sh.x, sh.y) * cloudShadowAt(vWorld, L);
  }

  float sceneDist = texture(tSceneDepth, suv).x;
  float thickness = max(sceneDist - dist, 0.0);
  vec2 offs = N.xz * 0.05 * saturate(thickness * 0.3) / (1.0 + dist * 0.02);
  vec2 ruv = suv + offs;
  float rDist = texture(tSceneDepth, ruv).x;
  if (rDist < dist) { ruv = suv; rDist = sceneDist; }
  thickness = max(rDist - dist, 0.0);
  vec3 refr = texture(tSceneColor, ruv).rgb;
  vec3 absorb = exp(-uAbsorption * min(thickness, 300.0));
  vec3 inscatterLight = shIrradiance(vec3(0.0, 1.0, 0.0)) * 0.9 + lightCol * shadowVis * max(L.y, 0.0) * 0.1;
  float deep = saturate(thickness / 12.0);
  vec3 waterCol = mix(uShallowColor, uDeepColor, deep);
  vec3 under = refr * absorb + waterCol * inscatterLight * (1.0 - absorb);

  vec3 color;
  if (fromBelow || uUnderwater > 0.5) {
    float cosI = abs(dot(N, V));
    color = mix(refr, waterCol * inscatterLight * 0.6, smoothstep(0.62, 0.48, cosI));
  } else {
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    float rough = mix(0.02, 0.16, saturate(dist / 250.0)) + slick * 0.05;
    vec3 envR = envRadiance(R, rough);
    vec3 Rv = normalize((transpose(uCamRot) * vec4(R, 0.0)).xyz);
    vec4 ssr = traceSSR(vViewPos, Rv, dither);
    vec3 refl = mix(envR, ssr.rgb, ssr.a);
    float NdotV = saturate(dot(N, V));
    float F = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
    color = mix(under, refl, F);
    vec3 H = normalize(L + V);
    float NdotL = saturate(dot(N, L));
    float a = mix(0.03, 0.09, slick) + saturate(dist / 400.0) * 0.08;
    color += D_GGX(saturate(dot(N, H)), a * a) * V_SmithGGXCorrelated(NdotV, NdotL, a * a) * F_Schlick(vec3(0.02), saturate(dot(V, H))) * lightCol * NdotL * shadowVis;
    // shoreline foam
    float foamN = texture(tCloudNoise, vec3(vWorld.xz * 0.25 + uTime * 0.015, uTime * 0.01)).g;
    float foam = smoothstep(0.9, 0.05, thickness) * smoothstep(0.45, 0.8, foamN + 0.25 * sin(uTime * 1.3 - thickness * 6.0));
    vec3 foamLit = shIrradiance(vec3(0.0, 1.0, 0.0)) + lightCol * shadowVis * max(L.y, 0.0) / PI;
    color = mix(color, foamLit * 0.75, foam * uFoam);
  }
  color = applyFog(color, pRel, dist, 1.0, suv);
  color = applyWorldMask(color, vWorld);
  fragColor = vec4(max(color, 0.0), 1.0);
}
`;

/**
 * Forward-shaded water surface for heightfield worlds (lakes, rivers, sea).
 * Put the mesh in `pipeline.forwardScene`.
 */
export function createWaterMaterial(pipeline, {
  shallowColor = new Color(0.016, 0.05, 0.045), deepColor = new Color(0.004, 0.018, 0.03),
  absorption = new Vector3(0.42, 0.13, 0.1), waveScale = 1, foam = 0.6,
} = {}) {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      ...pipeline.shared,
      tWaterNormal: { value: createWaterNormalTexture(256) },
      uShallowColor: { value: shallowColor },
      uDeepColor: { value: deepColor },
      uAbsorption: { value: absorption },
      uWaveScale: { value: waveScale },
      uFoam: { value: foam },
    },
    side: FrontSide,
    depthWrite: true,
  });
}
