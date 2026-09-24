// Deferred lighting pass: reads the G-buffer and produces HDR radiance.
import { COMMON } from './common.js';
import { ATMOSPHERE_CORE, ATMOSPHERE_LOOKUP } from './atmosphere.js';
import { CLOUDS, ENV_LOOKUP } from './sky.js';
import { SHADOW_SAMPLING } from './shadows.js';

// Material flag bits stored in gLight.a (as 0..255).
export const MAT_FLAGS = {
  FOLIAGE: 1,     // translucent leaves: wrap diffuse + transmission
  PLANT: 2,       // grass / flowers (thin, lit like foliage)
  UNDERWATER: 4,  // surface lies under water -> caustics, sun attenuation
  ENTITY: 8,      // non-voxel object (light values come from uniforms)
  METAL_SHEEN: 16,
};


// Aerial perspective + exponential height fog + fade into the sky at the
// edge of the loaded world. Needs ATMOSPHERE_LOOKUP and the fog uniforms.
export const FOG_CHUNK = /* glsl */ `
uniform float uViewDistance;
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uFogFalloff;
uniform float uCameraSkyLight;
uniform sampler2D tSky;

float heightFog(vec3 camPos, vec3 dir, float dist) {
  float h0 = camPos.y - uFogHeight;
  float a = uFogDensity * exp(-h0 * uFogFalloff);
  float b = dir.y * uFogFalloff;
  float bd = b * dist;
  float integral = abs(bd) > 1e-4 ? a * dist * (1.0 - exp(-bd)) / bd : a * dist;
  return integral;
}

vec3 applyFog(vec3 color, vec3 pRel, float dist, float sky, vec2 screenUv) {
  vec3 dir = pRel / max(dist, 1e-4);
  vec3 fogDir = normalize(vec3(dir.x, max(dir.y, 0.03), dir.z));
  float fogLight = pow(max(sky, uCameraSkyLight), 2.0);
  vec3 fogCol = skyRadiance(fogDir) * fogLight;
  float od = heightFog(uCameraPos, dir, dist) + dist * 0.00022;
  color = mix(color, fogCol, 1.0 - exp(-od));
  float edge = smoothstep(uViewDistance * 0.7, uViewDistance * 0.97, length(pRel.xz));
  if (edge > 0.0) color = mix(color, texture(tSky, screenUv).rgb, edge * fogLight);
  return color;
}
`;

// World-space visibility mask (fog of war). Texture value: 0 = unexplored,
// 0.5 = explored (not visible), 1 = visible. Needs uniforms from the pipeline.
export const WORLD_MASK_CHUNK = /* glsl */ `
uniform sampler2D tWorldMask;
uniform vec4 uWorldMaskBounds;   // minX, minZ, sizeX, sizeZ
uniform float uWorldMaskEnabled;
uniform float uWorldMaskOutside;
vec3 applyWorldMask(vec3 color, vec3 worldPos) {
  if (uWorldMaskEnabled < 0.5) return color;
  vec2 uv = (worldPos.xz - uWorldMaskBounds.xy) / uWorldMaskBounds.zw;
  float m = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? uWorldMaskOutside : texture(tWorldMask, uv).r;
  float explored = smoothstep(0.05, 0.45, m);
  float visible = smoothstep(0.55, 0.95, m);
  float l = luma(color);
  vec3 memory = mix(vec3(l), color, 0.45) * 0.42;
  vec3 shroud = mix(vec3(l), color, 0.2) * 0.06;
  return mix(shroud, mix(memory, color, visible), explored);
}
`;

export const PBR_FUNCTIONS = /* glsl */ `
float D_GGX(float NdotH, float a) {
  float a2 = a * a;
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d + 1e-7);
}
float V_SmithGGXCorrelated(float NdotV, float NdotL, float a) {
  float a2 = a * a;
  float gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
  float gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}
vec3 F_Schlick(vec3 f0, float VdotH) {
  float f = pow(1.0 - VdotH, 5.0);
  return f0 + (1.0 - f0) * f;
}
// Karis' analytic approximation of the split-sum environment BRDF.
vec3 envBRDFApprox(vec3 f0, float roughness, float NdotV) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;
  vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
  return f0 * AB.x + AB.y;
}
`;

export const LIGHTING_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
${COMMON}
${ATMOSPHERE_CORE}
${ATMOSPHERE_LOOKUP}
${CLOUDS}
${ENV_LOOKUP}
${SHADOW_SAMPLING}
${PBR_FUNCTIONS}

uniform sampler2D tAlbedo;
uniform sampler2D tNormal;
uniform sampler2D tLight;
uniform sampler2D tDepthCopy;   // r = distance, g = raw depth
uniform sampler2D tSSAO;
uniform mat4 uProjInv;
uniform mat4 uCamRot;          // camera world rotation (view -> world directions)
uniform vec3 uCameraPos;
uniform float uFrame;
${FOG_CHUNK}
${WORLD_MASK_CHUNK}
uniform vec3 uBlockLightColor;
uniform float uBlockLightIntensity;
uniform float uFlicker;
uniform float uHeldLight;      // 0..1 hand-held light level
uniform float uWetness;        // rain wetness 0..1
uniform float uSSAOEnabled;
uniform float uCaveAmbient;
uniform float uEmissiveStrength;
uniform float uAmbientBoost;
uniform int uShadowTaps;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

vec3 sunDisk(vec3 dir) {
  float c = dot(dir, uSunDir);
  const float cosR = 0.99995;  // ~0.57 deg radius (slightly larger than real)
  float disk = smoothstep(cosR - 0.00002, cosR + 0.00001, c);
  // limb darkening
  float mu = sqrt(max(0.0, 1.0 - sq((1.0 - c) / (1.0 - cosR + 1e-6))));
  float limb = pow(max(mu, 0.0), 0.5) * 0.7 + 0.3;
  vec3 T = sunTransmittanceAt(uSunDir);
  return T * uSunIntensity * disk * limb * 900.0;
}

vec3 moonDisk(vec3 dir) {
  float c = dot(dir, uMoonDir);
  const float cosR = 0.99990;
  if (c < cosR - 0.0001) return vec3(0.0);
  float disk = smoothstep(cosR - 0.00003, cosR + 0.00001, c);
  // crater-ish albedo from a projected position on the disk
  vec3 up = abs(uMoonDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tx = normalize(cross(up, uMoonDir));
  vec3 ty = cross(uMoonDir, tx);
  vec2 q = vec2(dot(dir, tx), dot(dir, ty)) / sqrt(1.0 - cosR * cosR);
  float n = 0.0;
  n += 0.5 * hash12(floor(q * 6.0 + 3.0));
  n += 0.25 * hash12(floor(q * 14.0 + 7.0));
  float maria = smoothstep(0.35, 0.8, 0.6 * (sin(q.x * 3.1 + 1.3) * cos(q.y * 2.3 - 0.4)) + 0.5 * n);
  float albedo = mix(0.95, 0.55, maria);
  vec3 T = sunTransmittanceAt(uMoonDir);
  return T * vec3(0.9, 0.93, 1.0) * disk * albedo * max(uSunIntensity * 0.0006, uMoonIntensity * 50.0);
}

vec3 starField(vec3 dir) {
  // slowly rotating celestial sphere
  float a = uTime * 0.002;
  float ca = cos(a), sa = sin(a);
  vec3 d = vec3(dir.x, ca * dir.y - sa * dir.z, sa * dir.y + ca * dir.z);
  vec3 col = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float density = layer == 0 ? 90.0 : 170.0;
    vec3 p = d * density;
    vec3 cell = floor(p);
    vec3 f = fract(p);
    float h = hash13(cell + float(layer) * 17.0);
    float thr = layer == 0 ? 0.972 : 0.955;
    if (h > thr) {
      vec3 c = hash33(cell) * 0.5 + 0.25;
      float dist = length(f - c);
      float mag = pow((h - thr) / (1.0 - thr), 3.0);
      float tw = 0.7 + 0.3 * sin(uTime * (1.5 + 5.0 * h) + h * 400.0);
      vec3 tint = mix(vec3(1.0, 0.82, 0.68), vec3(0.72, 0.82, 1.0), hash12(cell.xy));
      float r = layer == 0 ? 0.2 : 0.16;
      col += tint * mag * tw * smoothstep(r, 0.0, dist) * (layer == 0 ? 0.9 : 0.35);
    }
  }
  // milky way band
  vec3 bandN = normalize(vec3(0.3, 0.2, 1.0));
  float band = exp(-sq(dot(d, bandN) * 3.2));
  float mw = band * (0.45 + 0.55 * hash13(floor(d * 60.0))) * (0.6 + 0.4 * hash13(floor(d * 13.0)));
  col += vec3(0.75, 0.82, 1.0) * mw * 0.006;
  float night = saturate(-uSunDir.y * 6.0 - 0.1);
  return col * night * saturate(dir.y * 4.0 + 0.2);
}

void main() {
  float depth = texture(tDepthCopy, vUv).g;
  vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vpos = uProjInv * clip;
  vec3 viewPos = vpos.xyz / vpos.w;
  vec3 viewDirV = normalize((uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0)).xyz);
  vec3 dirW = normalize((uCamRot * vec4(viewDirV, 0.0)).xyz);

  vec4 skyS = texture(tSky, vUv);
  if (depth >= 1.0) {
    vec3 col = skyS.rgb + (sunDisk(dirW) + moonDisk(dirW) + starField(dirW)) * skyS.a;
    // below-horizon sky seen from high places: darken toward the ground
    fragColor = vec4(col, 1.0);
    return;
  }

  vec3 pRel = (uCamRot * vec4(viewPos, 0.0)).xyz;
  float dist = length(pRel);
  vec3 V = -pRel / max(dist, 1e-4);
  vec3 worldPos = pRel + uCameraPos;

  vec4 gA = texture(tAlbedo, vUv);
  vec4 gN = texture(tNormal, vUv);
  vec4 gL = texture(tLight, vUv);
  vec3 albedo = gA.rgb * gA.rgb;       // stored as sqrt for precision
  float ao = gA.a;
  vec3 N = decodeNormal(gN.xy);
  float roughness = clamp(gN.z, 0.03, 1.0);
  float metal = gN.w;
  float sky = gL.x;
  float block = gL.y;
  float emissive = gL.z;
  int flags = int(gL.w * 255.0 + 0.5);
  bool foliage = (flags & 1) != 0;
  bool plant = (flags & 2) != 0;
  bool underwater = (flags & 4) != 0;

  float dither = ignT(gl_FragCoord.xy, uFrame);

  // --- rain wetness -------------------------------------------------------
  if (uWetness > 0.0) {
    float exposure = smoothstep(0.85, 1.0, sky) * saturate(N.y * 1.5 + 0.2);
    float puddle = smoothstep(0.2, 0.7, texture(tCloudNoise, vec3(worldPos.xz * 0.05, 0.5)).r) * step(0.9, N.y);
    float w = uWetness * exposure;
    albedo *= mix(1.0, 0.62, w);
    roughness = mix(roughness, mix(0.25, 0.05, puddle), w);
    if (puddle * w > 0.5) N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.8));
  }

  float ssao = uSSAOEnabled > 0.5 ? texture(tSSAO, vUv).r : 1.0;
  float NdotV = max(dot(N, V), 1e-4);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 diffColor = albedo * (1.0 - metal);

  // --- direct light (sun or moon) -------------------------------------------
  vec3 L = uLightDir;
  vec3 lightCol = directLightColor();
  float NdotLraw = dot(N, L);
  float NdotL = saturate(NdotLraw);
  float shadow = 1.0;
  float skyGate = smoothstep(0.02, 0.35, sky);
  if (skyGate > 0.0 && dot(lightCol, lightCol) > 0.0) {
    vec2 sh = sampleShadow(pRel, (foliage || plant) ? L : N, (foliage || plant) ? 1.0 : NdotL, dist, dither, uShadowTaps);
    float fallback = smoothstep(0.86, 1.0, sky);
    shadow = mix(fallback, sh.x, sh.y);
    shadow *= cloudShadowAt(worldPos, L);
  } else {
    shadow = 0.0;
  }
  shadow *= skyGate;

  vec3 direct = vec3(0.0);
  if (foliage || plant) {
    float wrap = (NdotLraw + 0.5) / 1.5;
    float trans = pow(saturate(dot(-V, L)), 6.0) * 1.6 + 0.35;
    direct = diffColor / PI * (saturate(wrap) + trans * 0.6) * lightCol * shadow;
    // soft specular sheen on leaves
    vec3 H = normalize(L + V);
    float spec = D_GGX(saturate(dot(N, H)), 0.45 * 0.45) * 0.25;
    direct += spec * lightCol * shadow * NdotL * 0.04;
  } else if (NdotL > 0.0) {
    vec3 H = normalize(L + V);
    float NdotH = saturate(dot(N, H));
    float VdotH = saturate(dot(V, H));
    float a = roughness * roughness;
    vec3 F = F_Schlick(f0, VdotH);
    float D = D_GGX(NdotH, a);
    float Vis = V_SmithGGXCorrelated(NdotV, NdotL, a);
    vec3 spec = D * Vis * F;
    vec3 diff = (1.0 - F) * diffColor / PI;
    direct = (diff + spec) * lightCol * NdotL * shadow;
  }

  if (underwater) {
    float depthEst = (1.0 - sky) * 15.0 + 1.0;
    vec3 absorb = exp(-vec3(0.45, 0.12, 0.08) * depthEst);
    // animated caustics (two layers of distorted cells)
    vec2 cp = worldPos.xz - L.xz / max(L.y, 0.2) * (worldPos.y) * 0.02;
    float t = uTime * 0.6;
    vec2 q = cp * 0.9;
    float c1 = abs(sin(q.x + sin(q.y * 1.3 + t) * 1.2 + t * 0.7) * sin(q.y + sin(q.x * 1.1 - t * 0.8) * 1.2));
    float c2 = abs(sin(q.x * 1.7 - t + sin(q.y * 2.1) * 0.9) * sin(q.y * 1.9 + t * 0.6 + sin(q.x * 1.3)));
    float caustic = pow(1.0 - c1, 6.0) + pow(1.0 - c2, 6.0);
    direct *= absorb * (0.45 + caustic * 1.6);
  }

  // --- ambient (sky) --------------------------------------------------------
  float skyAmb = pow(sky, 2.4);
  vec3 irr = shIrradiance(N) * uAmbientBoost;
  float occl = ao * ssao;
  vec3 ambient = diffColor * irr * skyAmb * occl;
  if (foliage || plant) ambient += diffColor * shIrradiance(-N) * skyAmb * occl * 0.35;
  // specular ambient from the environment map
  vec3 R = reflect(-V, N);
  R.y = max(R.y, -0.1);
  float specOcc = saturate(pow(NdotV + occl, exp2(-16.0 * roughness - 1.0)) - 1.0 + occl);
  vec3 envSpec = envRadiance(R, roughness) * envBRDFApprox(f0, roughness, NdotV) * specOcc * skyAmb;
  // horizon occlusion for bumped normals
  ambient += envSpec * (foliage || plant ? 0.3 : 1.0);
  ambient += diffColor * uCaveAmbient * occl;

  // --- block light (torches, lava, glowstone) -------------------------------
  // light levels decay roughly like an inverse-square falloff
  float bl = block * 15.0;
  float blockFalloff = bl > 0.01 ? exp2((bl - 15.0) * 0.46) * (0.93 + 0.07 * uFlicker) * saturate(bl) : 0.0;
  vec3 blockLight = uBlockLightColor * uBlockLightIntensity * blockFalloff;
  vec3 blockTerm = diffColor * blockLight * mix(occl, 1.0, 0.25);

  // --- hand-held light (point light at the camera) --------------------------
  if (uHeldLight > 0.0) {
    float range = 4.0 + 10.0 * uHeldLight;
    float att = saturate(1.0 - dist / range);
    att *= att;
    float hl = saturate(dot(N, V)) * att * uHeldLight;
    blockTerm += diffColor * uBlockLightColor * uBlockLightIntensity * 0.9 * hl * (0.95 + 0.05 * uFlicker);
  }

  vec3 emit = albedo * emissive * uEmissiveStrength;

  vec3 color = direct + ambient + blockTerm + emit;

  // --- atmosphere: aerial perspective + height fog + world edge fade ----------
  color = applyFog(color, pRel, dist, sky, vUv);
  color = applyWorldMask(color, worldPos);

  fragColor = vec4(max(color, 0.0), 1.0);
}
`;
