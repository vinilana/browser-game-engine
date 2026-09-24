// Sky + volumetric clouds. Rendered at reduced resolution into an RGBA16F target
// (rgb = in-scattered radiance incl. clouds, a = cloud transmittance) and into a
// small equirectangular environment map used for reflections and ambient SH.
import { COMMON } from './common.js';
import { ATMOSPHERE_CORE, ATMOSPHERE_LOOKUP } from './atmosphere.js';

export const CLOUDS = /* glsl */ `
uniform sampler3D tCloudNoise;
uniform float uCloudCoverage;
uniform float uCloudDensity;
uniform vec2 uCloudWind;
uniform float uTime;
const float CLOUD_BOTTOM = 1300.0;
const float CLOUD_TOP = 2700.0;

float remap(float v, float l0, float h0, float l1, float h1) {
  return l1 + (v - l0) * (h1 - l1) / (h0 - l0);
}

float cloudWeather(vec2 xz) {
  vec2 p = (xz + uCloudWind) * 0.00005;
  float w = texture(tCloudNoise, vec3(p, 0.37)).r * 0.6 + texture(tCloudNoise, vec3(p * 2.7 + 0.3, 0.71)).g * 0.4;
  return smoothstep(0.8 - uCloudCoverage * 0.62, 0.98 - uCloudCoverage * 0.5, w);
}

float cloudDensity(vec3 p, float wc, bool detail) {
  float h = (p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM);
  if (h <= 0.0 || h >= 1.0 || wc <= 0.0) return 0.0;
  float top = mix(0.3, 1.0, wc);
  float grad = saturate(remap(h, 0.0, 0.1, 0.0, 1.0)) * saturate(remap(h, top * 0.55, top, 1.0, 0.0));
  vec3 q = (p + vec3(uCloudWind.x, 0.0, uCloudWind.y)) * 0.00028;
  vec4 n = texture(tCloudNoise, q);
  float fbmW = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float base = remap(n.r, -(1.0 - fbmW), 1.0, 0.0, 1.0);
  base = saturate(remap(base * grad, 1.0 - wc * 0.95, 1.0, 0.0, 1.0));
  if (detail && base > 0.0) {
    vec4 d = texture(tCloudNoise, q * 5.3 + vec3(0.0, uTime * 0.0015, 0.0));
    vec4 d2 = texture(tCloudNoise, q * 17.0 + vec3(uTime * 0.002, 0.0, 0.0));
    float df = d.g * 0.5 + d.b * 0.2 + d2.g * 0.2 + d2.b * 0.1;
    float m = mix(df, 1.0 - df, saturate(h * 4.0));
    base = saturate(remap(base, m * 0.6, 1.0, 0.0, 1.0));
  }
  return base;
}

// Cheap, 2D-ish cloud optical depth along the light direction, used for cloud
// shadows on the ground.
float cloudShadowAt(vec3 worldPos, vec3 lightDir) {
  if (lightDir.y < 0.02) return 1.0;
  float mid = mix(CLOUD_BOTTOM, CLOUD_TOP, 0.3);
  vec3 p = worldPos + lightDir * ((mid - worldPos.y) / lightDir.y);
  float wc = cloudWeather(p.xz);
  float d = cloudDensity(p, wc, false);
  return mix(1.0, exp(-d * 6.0), 0.85);
}

vec4 raymarchClouds(vec3 ro, vec3 rd, float dither, int steps, vec3 sunDir, vec3 sunRadiance, vec3 ambTop, vec3 ambBottom) {
  if (rd.y <= 0.0 || uCloudCoverage <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0 = max((CLOUD_BOTTOM - ro.y) / rd.y, 0.0);
  float t1 = (CLOUD_TOP - ro.y) / rd.y;
  t1 = min(t1, t0 + 12000.0);
  if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);
  float stepLen = (t1 - t0) / float(steps);
  float t = t0 + stepLen * dither;
  vec3 L = vec3(0.0);
  float T = 1.0;
  float cosT = dot(rd, sunDir);
  float phase = mix(henyeyGreenstein(cosT, 0.72), henyeyGreenstein(cosT, -0.2), 0.35);
  float sigmaScale = uCloudDensity;
  for (int i = 0; i < 96; i++) {
    if (i >= steps || T < 0.015) break;
    vec3 p = ro + rd * t;
    float wc = cloudWeather(p.xz);
    float d = wc > 0.0 ? cloudDensity(p, wc, true) : 0.0;
    if (d > 0.002) {
      float sigma = d * sigmaScale;
      float ld = 0.0;
      float ls = 55.0;
      vec3 lp = p;
      for (int j = 0; j < 5; j++) {
        lp += sunDir * ls;
        ld += cloudDensity(lp, cloudWeather(lp.xz), false) * ls;
        ls *= 1.7;
      }
      ld *= sigmaScale;
      // multiple-scattering approximation (Wrenninge et al.)
      float ms = 0.0, a = 1.0, b = 1.0, c = 1.0;
      for (int o = 0; o < 3; o++) {
        ms += a * exp(-ld * b) * mix(henyeyGreenstein(cosT, 0.72 * c), henyeyGreenstein(cosT, -0.2 * c), 0.35);
        a *= 0.5; b *= 0.4; c *= 0.5;
      }
      float powder = 1.0 - exp(-sigma * 90.0);
      float h = saturate((p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM));
      vec3 amb = mix(ambBottom, ambTop, h) * (0.6 + 0.4 * h);
      vec3 S = (sunRadiance * ms * mix(0.6, 1.0, powder) * 4.0 * PI + amb) * sigma;
      float Ts = exp(-sigma * stepLen);
      L += T * (S - S * Ts) / max(sigma, 1e-6);
      T *= Ts;
    }
    t += stepLen;
  }
  // aerial perspective fade toward the horizon
  float fade = exp(-t0 * 0.000045);
  L *= fade;
  T = mix(1.0, T, fade);
  return vec4(L, T);
}
`;

export const SKY_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
${COMMON}
${ATMOSPHERE_CORE}
${ATMOSPHERE_LOOKUP}
${CLOUDS}
uniform mat4 uInvViewProj;   // camera-relative (rotation only) inverse view-projection
uniform vec3 uCameraPos;
uniform float uFrame;
uniform int uMode;           // 0 = screen, 1 = equirect environment
uniform int uSteps;
uniform vec2 uResolution;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  vec3 dir;
  if (uMode == 0) {
    vec4 p = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    dir = normalize(p.xyz / p.w);
  } else {
    float az = vUv.x * 2.0 * PI;
    float el = (vUv.y - 0.5) * PI;
    dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  }
  // below the horizon we see (hazy) distant land/sea: use the horizon radiance
  vec3 skyDir = dir.y < 0.0 ? normalize(vec3(dir.x, 0.0, dir.z) + vec3(0.0, 0.002, 0.0)) : dir;
  vec3 sky = skyRadiance(skyDir) * (dir.y < 0.0 ? mix(1.0, 0.7, saturate(-dir.y * 3.0)) : 1.0);
  vec3 lightCol = directLightColor();
  vec3 ambTop = skyRadiance(vec3(0.0, 1.0, 0.0)) * 3.5;
  vec3 ambBottom = ambTop * 0.35 + lightCol * max(uLightDir.y, 0.0) * 0.06;
  // Clouds are lit by the transmittance at cloud altitude (brighter/whiter than at ground).
  vec3 cloudLight = lightCol * 1.15;
  float dither = ignT(gl_FragCoord.xy, uFrame);
  vec4 clouds = raymarchClouds(uCameraPos, dir, dither, uSteps, uLightDir, cloudLight, ambTop, ambBottom);
  vec3 col = sky * clouds.a + clouds.rgb;
  if (uMode == 1 && dir.y < 0.0) {
    // ground below the horizon in the environment map
    vec3 E = lightCol * max(uLightDir.y, 0.0) + ambTop * PI * 0.25;
    col = mix(col, groundAlbedo * E / PI, saturate(-dir.y * 12.0));
  }
  fragColor = vec4(col, clouds.a);
}
`;

// Projects the equirect environment into 9 L2 spherical-harmonic coefficients
// (irradiance, cosine-convolved) — output is a 9x1 texture.
export const SH_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform sampler2D tEnv;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float shBasis(int i, vec3 d) {
  if (i == 0) return 0.282095;
  if (i == 1) return 0.488603 * d.y;
  if (i == 2) return 0.488603 * d.z;
  if (i == 3) return 0.488603 * d.x;
  if (i == 4) return 1.092548 * d.x * d.y;
  if (i == 5) return 1.092548 * d.y * d.z;
  if (i == 6) return 0.315392 * (3.0 * d.z * d.z - 1.0);
  if (i == 7) return 1.092548 * d.x * d.z;
  return 0.546274 * (d.x * d.x - d.y * d.y);
}

void main() {
  int idx = int(gl_FragCoord.x);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  const int NX = 32, NY = 16;
  for (int y = 0; y < NY; y++) {
    float v = (float(y) + 0.5) / float(NY);
    float el = (v - 0.5) * PI;
    float w = cos(el);
    for (int x = 0; x < NX; x++) {
      float u = (float(x) + 0.5) / float(NX);
      float az = u * 2.0 * PI;
      vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
      vec3 L = textureLod(tEnv, vec2(u, v), 2.0).rgb;
      acc += L * shBasis(idx, d) * w;
      wsum += w;
    }
  }
  acc *= 4.0 * PI / wsum;
  // cosine lobe convolution (irradiance): A0 = pi, A1 = 2pi/3, A2 = pi/4
  float band = idx == 0 ? PI : (idx < 4 ? 2.0 * PI / 3.0 : PI / 4.0);
  fragColor = vec4(acc * band, 1.0);
}
`;

// GLSL helpers to evaluate irradiance from the SH texture and sample the env map.
export const ENV_LOOKUP = /* glsl */ `
uniform sampler2D tSH;
uniform sampler2D tEnv;
vec3 shIrradiance(vec3 n) {
  vec3 c0 = texelFetch(tSH, ivec2(0, 0), 0).rgb;
  vec3 c1 = texelFetch(tSH, ivec2(1, 0), 0).rgb;
  vec3 c2 = texelFetch(tSH, ivec2(2, 0), 0).rgb;
  vec3 c3 = texelFetch(tSH, ivec2(3, 0), 0).rgb;
  vec3 c4 = texelFetch(tSH, ivec2(4, 0), 0).rgb;
  vec3 c5 = texelFetch(tSH, ivec2(5, 0), 0).rgb;
  vec3 c6 = texelFetch(tSH, ivec2(6, 0), 0).rgb;
  vec3 c7 = texelFetch(tSH, ivec2(7, 0), 0).rgb;
  vec3 c8 = texelFetch(tSH, ivec2(8, 0), 0).rgb;
  vec3 r = c0 * 0.282095
    + c1 * 0.488603 * n.y + c2 * 0.488603 * n.z + c3 * 0.488603 * n.x
    + c4 * 1.092548 * n.x * n.y + c5 * 1.092548 * n.y * n.z
    + c6 * 0.315392 * (3.0 * n.z * n.z - 1.0)
    + c7 * 1.092548 * n.x * n.z + c8 * 0.546274 * (n.x * n.x - n.y * n.y);
  return max(r, vec3(0.0)) / PI;
}
vec2 dirToEquirect(vec3 d) {
  float az = atan(d.z, d.x);
  if (az < 0.0) az += 2.0 * PI;
  return vec2(az / (2.0 * PI), asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
}
vec3 envRadiance(vec3 d, float roughness) {
  float lod = roughness * 5.0;
  return textureLod(tEnv, dirToEquirect(d), lod).rgb;
}
`;
