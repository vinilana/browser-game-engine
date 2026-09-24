// Post-processing shaders: SSAO, volumetric light, TAA, bloom, exposure, final.
import { COMMON } from './common.js';
import { ATMOSPHERE_CORE, ATMOSPHERE_LOOKUP } from './atmosphere.js';
import { CLOUDS } from './sky.js';
import { SHADOW_SAMPLING } from './shadows.js';

// ---------------------------------------------------------------------------
export const SSAO_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform mat4 uViewRot;     // world -> view rotation
uniform float uFrame;
uniform float uRadius;
uniform float uIntensity;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

vec3 viewPosAt(vec2 uv, float d) {
  vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
float viewZAt(vec2 uv) {
  float d = textureLod(tDepth, uv, 0.0).r;
  vec4 p = uProjInv * vec4(0.0, 0.0, d * 2.0 - 1.0, 1.0);
  return p.z / p.w;
}

void main() {
  float d = textureLod(tDepth, vUv, 0.0).r;
  if (d >= 1.0) { fragColor = vec4(1.0); return; }
  vec3 P = viewPosAt(vUv, d);
  vec3 N = normalize((uViewRot * vec4(decodeNormal(textureLod(tNormal, vUv, 0.0).xy), 0.0)).xyz);
  float noise = ignT(gl_FragCoord.xy, uFrame);
  float ang = noise * 6.2831853;
  vec3 rv = vec3(cos(ang), sin(ang), 0.0);
  vec3 T = normalize(rv - N * dot(rv, N));
  if (any(isnan(T))) T = normalize(cross(N, vec3(0.0, 1.0, 0.1)));
  vec3 B = cross(N, T);
  float radius = uRadius * mix(1.0, 3.0, saturate(-P.z / 120.0));
  const int SAMPLES = 12;
  float occ = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = (float(i) + fract(noise * 7.13)) / float(SAMPLES);
    float r = sqrt(fi);
    float a = float(i) * 2.39996323 + ang;
    vec3 h = vec3(r * cos(a), r * sin(a), sqrt(max(0.0, 1.0 - fi)));
    float scale = mix(0.15, 1.0, fi * fi);
    vec3 s = P + (T * h.x + B * h.y + N * h.z) * radius * scale;
    vec4 c = uProj * vec4(s, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    float sz = viewZAt(uv);
    float range = smoothstep(0.0, 1.0, radius / abs(P.z - sz));
    occ += (sz >= s.z + 0.03 ? 1.0 : 0.0) * range;
  }
  float ao = 1.0 - occ / float(SAMPLES) * uIntensity;
  fragColor = vec4(saturate(ao), 0.0, 0.0, 1.0);
}
`;

export const SSAO_BLUR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform vec2 uTexel;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
float viewZAt(vec2 uv) {
  float d = textureLod(tDepth, uv, 0.0).r;
  vec4 p = uProjInv * vec4(0.0, 0.0, d * 2.0 - 1.0, 1.0);
  return p.z / p.w;
}
void main() {
  float z0 = viewZAt(vUv);
  float sum = 0.0, wsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * uTexel;
      float z = viewZAt(uv);
      float w = exp(-abs(z - z0) / max(abs(z0) * 0.03, 0.05)) * (1.0 - 0.1 * float(abs(x) + abs(y)));
      sum += texture(tAO, uv).r * w;
      wsum += w;
    }
  }
  fragColor = vec4(sum / max(wsum, 1e-4), 0.0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Copy of the depth buffer: r = linear view distance, g = raw depth. Lets the
// lighting pass and forward shaders read depth while the depth texture stays
// attached to the HDR framebuffer.
export const DEPTH_COPY_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
in vec2 vUv;
layout(location = 0) out vec4 outDepth;
void main() {
  float d = texture(tDepth, vUv).r;
  vec4 p = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  float dist = d >= 1.0 ? 1e6 : length(p.xyz / p.w);
  outDepth = vec4(dist, d, 0.0, 1.0);
}
`;

// Copy of the lit HDR color (sampled by water/glass for refraction and SSR).
export const COPY_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  outColor = texture(tColor, vUv);
}
`;

// ---------------------------------------------------------------------------
export const VOLUMETRIC_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
${COMMON}
${ATMOSPHERE_CORE}
${ATMOSPHERE_LOOKUP}
${CLOUDS}
${SHADOW_SAMPLING}
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uCamRot;
uniform vec3 uCameraPos;
uniform float uFrame;
uniform int uSteps;
uniform float uMaxDist;
uniform float uDensity;
uniform float uFogHeight;
uniform float uFogFalloff;
uniform float uCameraSkyLight;
uniform float uUnderwater;
uniform float uRain;
uniform float uWaterSurfaceY;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  float d = textureLod(tDepth, vUv, 0.0).r;
  vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 viewPos = vp.xyz / vp.w;
  vec3 dirV = normalize(viewPos);
  vec3 dir = normalize((uCamRot * vec4(dirV, 0.0)).xyz);
  float dist = d >= 1.0 ? uMaxDist : min(length(viewPos), uMaxDist);
  float dither = ignT(gl_FragCoord.xy, uFrame);
  vec3 lightCol = directLightColor();
  float cosT = dot(dir, uLightDir);
  float stepLen = dist / float(uSteps);
  vec3 scatter = vec3(0.0);
  float T = 1.0;
  vec3 ambient = skyRadiance(vec3(0.0, 1.0, 0.0)) * PI * 0.5 * uCameraSkyLight * uCameraSkyLight;

  if (uUnderwater > 0.5) {
    float phase = mix(henyeyGreenstein(cosT, 0.6), 1.0 / (4.0 * PI), 0.4);
    vec3 sigmaA = vec3(0.35, 0.09, 0.06);
    float sigmaS = 0.05;
    vec3 Tw = vec3(1.0);
    for (int i = 0; i < 32; i++) {
      if (i >= uSteps) break;
      float t = (float(i) + dither) * stepLen;
      vec3 p = dir * t;
      float vis = sampleShadowFast(p, t);
      vec3 depthAbs = exp(-sigmaA * max(0.0, uWaterSurfaceY - (uCameraPos.y + p.y)) * 0.6);
      vec3 s = sigmaS * (lightCol * vis * phase * depthAbs + ambient * 0.08);
      vec3 Ts = exp(-(sigmaA + sigmaS) * stepLen);
      scatter += Tw * s * (1.0 - Ts) / (sigmaA + sigmaS);
      Tw *= Ts;
    }
    fragColor = vec4(scatter, 1.0);
    return;
  }

  float phase = mix(henyeyGreenstein(cosT, 0.78), henyeyGreenstein(cosT, 0.0), 0.55);
  bool lit = dot(lightCol, lightCol) > 1e-8;
  for (int i = 0; i < 48; i++) {
    if (i >= uSteps) break;
    float t = (float(i) + dither) * stepLen;
    vec3 p = dir * t;
    float wy = uCameraPos.y + p.y;
    float dens = uDensity * (exp(-max(wy - uFogHeight, -20.0) * uFogFalloff) * (1.0 + uRain * 3.0));
    float vis = lit ? sampleShadowFast(p, t) : 0.0;
    vec3 s = dens * (lightCol * vis * phase + ambient * (1.0 / (4.0 * PI)));
    float Ts = exp(-dens * stepLen);
    scatter += T * s * stepLen;
    T *= Ts;
  }
  fragColor = vec4(scatter, T);
}
`;

// ---------------------------------------------------------------------------
export const TAA_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform sampler2D tVolumetric;
uniform float uVolumetricEnabled;
uniform mat4 uProjInv;
uniform mat4 uCamRot;
uniform mat4 uPrevViewProj;   // previous frame, camera-relative to CURRENT camera position
uniform vec2 uTexel;
uniform float uReset;
uniform float uFeedback;
uniform float uUnderwater;
uniform vec3 uWaterFogColor;
uniform float uTaaEnabled;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

vec3 RGBToYCoCg(vec3 c) {
  return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25)));
}
vec3 YCoCgToRGB(vec3 c) {
  return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

vec3 fetchCurrent(vec2 uv) {
  vec3 c = texture(tCurrent, uv).rgb;
  if (uVolumetricEnabled > 0.5) {
    vec4 v = texture(tVolumetric, uv);
    c = c * v.a + v.rgb;
  }
  return c;
}

vec3 tonemapWeight(vec3 c) { return c / (1.0 + luma(c)); }
vec3 untonemapWeight(vec3 c) { return c / max(1.0 - luma(c), 1e-4); }

vec3 sampleHistoryCatmullRom(vec2 uv) {
  vec2 texSize = 1.0 / uTexel;
  vec2 samplePos = uv * texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 offset12 = w2 / w12;
  vec2 texPos0 = (texPos1 - 1.0) * uTexel;
  vec2 texPos3 = (texPos1 + 2.0) * uTexel;
  vec2 texPos12 = (texPos1 + offset12) * uTexel;
  vec3 result = vec3(0.0);
  result += texture(tHistory, vec2(texPos0.x, texPos0.y)).rgb * w0.x * w0.y;
  result += texture(tHistory, vec2(texPos12.x, texPos0.y)).rgb * w12.x * w0.y;
  result += texture(tHistory, vec2(texPos3.x, texPos0.y)).rgb * w3.x * w0.y;
  result += texture(tHistory, vec2(texPos0.x, texPos12.y)).rgb * w0.x * w12.y;
  result += texture(tHistory, vec2(texPos12.x, texPos12.y)).rgb * w12.x * w12.y;
  result += texture(tHistory, vec2(texPos3.x, texPos12.y)).rgb * w3.x * w12.y;
  result += texture(tHistory, vec2(texPos0.x, texPos3.y)).rgb * w0.x * w3.y;
  result += texture(tHistory, vec2(texPos12.x, texPos3.y)).rgb * w12.x * w3.y;
  result += texture(tHistory, vec2(texPos3.x, texPos3.y)).rgb * w3.x * w3.y;
  return max(result, vec3(0.0));
}

void main() {
  vec3 cur = fetchCurrent(vUv);
  float d = texture(tDepth, vUv).r;
  vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 viewPos = vp.xyz / vp.w;
  vec3 pRel = (uCamRot * vec4(viewPos, 0.0)).xyz;
  if (d >= 1.0) pRel = normalize(pRel) * 1.0e5;

  if (uUnderwater > 0.5) {
    float dist = d >= 1.0 ? 200.0 : length(pRel);
    vec3 T = exp(-vec3(0.34, 0.085, 0.06) * dist * 0.75);
    cur = cur * T + uWaterFogColor * (1.0 - T);
  }

  if (uTaaEnabled < 0.5 || uReset > 0.5) { fragColor = vec4(cur, 1.0); return; }

  vec4 pc = uPrevViewProj * vec4(pRel, 1.0);
  vec2 prevUv = pc.xy / pc.w * 0.5 + 0.5;

  // neighborhood statistics in YCoCg (variance clipping)
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  vec3 cmin = vec3(1e9), cmax = vec3(-1e9);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 c = (x == 0 && y == 0) ? cur : fetchCurrent(vUv + vec2(float(x), float(y)) * uTexel);
      if (uUnderwater > 0.5) c = cur;
      c = RGBToYCoCg(tonemapWeight(c));
      m1 += c; m2 += c * c;
      cmin = min(cmin, c); cmax = max(cmax, c);
    }
  }
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
  vec3 bmin = max(cmin, mean - sigma * 1.25);
  vec3 bmax = min(cmax, mean + sigma * 1.25);

  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {
    fragColor = vec4(cur, 1.0);
    return;
  }
  vec3 hist = RGBToYCoCg(tonemapWeight(sampleHistoryCatmullRom(prevUv)));
  // clip toward the box center
  vec3 center = 0.5 * (bmax + bmin);
  vec3 extents = 0.5 * (bmax - bmin) + 1e-5;
  vec3 offs = hist - center;
  vec3 ts = abs(extents / (offs + 1e-7));
  float tt = saturate(min(ts.x, min(ts.y, ts.z)));
  hist = center + offs * tt;

  vec3 curT = RGBToYCoCg(tonemapWeight(cur));
  float motion = length((prevUv - vUv) / uTexel);
  float feedback = mix(uFeedback, 0.75, saturate(motion * 0.05));
  vec3 res = mix(curT, hist, feedback);
  fragColor = vec4(max(untonemapWeight(YCoCgToRGB(res)), 0.0), 1.0);
}
`;

// ---------------------------------------------------------------------------
export const BLOOM_DOWN_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform sampler2D tSrc;
uniform vec2 uTexel;     // source texel size
uniform float uFirst;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
vec3 s(vec2 o) { return texture(tSrc, vUv + o * uTexel).rgb; }
float kw(vec3 c) { return 1.0 / (1.0 + luma(c)); }
void main() {
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 col;
  if (uFirst > 0.5) {
    // Karis average on the first downsample to kill fireflies
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25;
    vec3 g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25;
    vec3 g4 = (j + k + l + m) * 0.25;
    float w0 = kw(g0), w1 = kw(g1), w2 = kw(g2), w3 = kw(g3), w4 = kw(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) /
          (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  fragColor = vec4(min(col, vec3(60000.0)), 1.0);
}
`;

export const BLOOM_UP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;      // lower mip (upsampled)
uniform sampler2D tBase;     // same-level downsample
uniform vec2 uTexel;         // tSrc texel size
uniform float uRadius;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
void main() {
  vec2 r = uTexel * uRadius;
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += (texture(tSrc, vUv + vec2(-r.x, 0.0)).rgb + texture(tSrc, vUv + vec2(r.x, 0.0)).rgb +
        texture(tSrc, vUv + vec2(0.0, -r.y)).rgb + texture(tSrc, vUv + vec2(0.0, r.y)).rgb) * 2.0;
  c += texture(tSrc, vUv + vec2(-r.x, -r.y)).rgb + texture(tSrc, vUv + vec2(r.x, -r.y)).rgb +
       texture(tSrc, vUv + vec2(-r.x, r.y)).rgb + texture(tSrc, vUv + vec2(r.x, r.y)).rgb;
  c /= 16.0;
  fragColor = vec4(texture(tBase, vUv).rgb + c, 1.0);
}
`;

// ---------------------------------------------------------------------------
export const LUMINANCE_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform sampler2D tSrc;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
void main() {
  vec3 c = texture(tSrc, vUv).rgb;
  // center-weighted metering
  vec2 d = vUv - 0.5;
  float w = mix(1.0, 0.25, saturate(length(d) * 2.0));
  float l = log2(max(luma(c), 1e-5));
  fragColor = vec4(l * w, w, 0.0, 1.0);
}
`;

export const ADAPT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform float uDt;
uniform float uKey;
uniform float uMinExposure;
uniform float uMaxExposure;
uniform float uSpeedUp;
uniform float uSpeedDown;
uniform float uReset;
uniform float uLodMax;
uniform float uExposureBias;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
void main() {
  vec2 lw = textureLod(tLum, vec2(0.5), uLodMax).rg;
  float avgLog = lw.x / max(lw.y, 1e-4);
  float avg = exp2(avgLog);
  float target = clamp(uKey / max(avg, 1e-5), uMinExposure, uMaxExposure) * uExposureBias;
  float prev = texelFetch(tPrev, ivec2(0), 0).r;
  if (uReset > 0.5 || prev <= 0.0 || isnan(prev)) { fragColor = vec4(target, avg, 0.0, 1.0); return; }
  float speed = target > prev ? uSpeedUp : uSpeedDown;
  float e = exp(mix(log(prev), log(target), 1.0 - exp(-uDt * speed)));
  fragColor = vec4(e, avg, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
export const FINAL_FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tExposure;
uniform vec2 uSrcTexel;
uniform float uBloomStrength;
uniform float uSharpen;
uniform float uVignette;
uniform float uSaturation;
uniform float uContrast;
uniform float uUnderwater;
uniform float uTime;
uniform float uFrame;
uniform float uGrain;
uniform int uTonemap;
uniform float uFade;
uniform sampler2D tOverlay;
uniform float uOverlay;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

vec3 acesFitted(vec3 v) {
  const mat3 ACESInputMat = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACESOutputMat = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  v = ACESInputMat * v;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  v = a / b;
  return clamp(ACESOutputMat * v, 0.0, 1.0);
}

// AgX (Troy Sobotka) with a mild "punchy" look.
vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 val) {
  const mat3 agx_mat = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                            0.0784335999999992, 0.878468636469772, 0.0784336,
                            0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 agx_mat_inv = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                                -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                                -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float min_ev = -12.47393, max_ev = 4.026069;
  val = agx_mat * val;
  val = clamp(log2(max(val, 1e-10)), min_ev, max_ev);
  val = (val - min_ev) / (max_ev - min_ev);
  val = agxDefaultContrastApprox(val);
  // punchy look
  float luma = dot(val, vec3(0.2126, 0.7152, 0.0722));
  val = luma + 1.12 * (pow(val, vec3(1.08)) - luma);
  val = agx_mat_inv * val;
  return clamp(pow(max(val, 0.0), vec3(2.2)), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.5) {
    uv += vec2(sin(uv.y * 40.0 + uTime * 2.0), cos(uv.x * 30.0 + uTime * 1.7)) * 0.0012;
  }
  // contrast adaptive sharpening (lite)
  vec3 c = texture(tColor, uv).rgb;
  vec3 n = texture(tColor, uv + vec2(0.0, uSrcTexel.y)).rgb;
  vec3 s = texture(tColor, uv - vec2(0.0, uSrcTexel.y)).rgb;
  vec3 e = texture(tColor, uv + vec2(uSrcTexel.x, 0.0)).rgb;
  vec3 w = texture(tColor, uv - vec2(uSrcTexel.x, 0.0)).rgb;
  vec3 mn = min(c, min(min(n, s), min(e, w)));
  vec3 mx = max(c, max(max(n, s), max(e, w)));
  vec3 amp = sqrt(saturate(min(mn, 2.0 - mx) / max(mx, 1e-4)));
  vec3 wgt = -amp * uSharpen * 0.2;
  vec3 color = (c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt);
  color = max(color, 0.0);

  vec3 bloom = texture(tBloom, uv).rgb;
  color = mix(color, bloom, uBloomStrength);
  if (uOverlay > 0.5) {
    vec4 ov = texture(tOverlay, vUv);
    color = mix(color, ov.rgb, ov.a);
  }

  float exposure = texelFetch(tExposure, ivec2(0), 0).r;
  // scotopic (night) vision: low luminance loses saturation and shifts blue
  float scot = luma(color);
  float night = 1.0 - smoothstep(0.004, 0.06, scot);
  color = mix(color, vec3(0.62, 0.78, 1.0) * scot * 1.1, night * 0.6);
  color *= exposure;

  // pre-tonemap grading: saturation
  float l = luma(color);
  color = max(mix(vec3(l), color, uSaturation), 0.0);

  color = uTonemap == 1 ? agx(color) : acesFitted(color);

  // contrast around mid grey in display space
  vec3 disp = linearToSrgb(color);
  disp = saturate((disp - 0.5) * uContrast + 0.5);

  // vignette
  vec2 dv = vUv - 0.5;
  float vig = 1.0 - dot(dv, dv) * uVignette;
  disp *= vig;

  // film grain + dithering
  float g = hash12(gl_FragCoord.xy + fract(uTime * 13.7) * 1000.0) - 0.5;
  disp += g * uGrain;
  disp += (ign(gl_FragCoord.xy + uFrame) - 0.5) / 255.0;
  disp *= uFade;
  fragColor = vec4(disp, 1.0);
}
`;
