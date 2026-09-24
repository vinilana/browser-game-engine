// Physically based atmosphere (after S. Hillaire, "A Scalable and Production Ready
// Sky and Atmosphere Rendering Technique", 2020). Distances in megameters.
import { COMMON } from './common.js';

export const ATMOSPHERE_CORE = /* glsl */ `
const float groundRadiusMM = 6.360;
const float atmosphereRadiusMM = 6.460;
const vec3 viewPosAtmo = vec3(0.0, 6.360 + 0.0003, 0.0);
const vec3 groundAlbedo = vec3(0.25, 0.26, 0.22);
const vec3 rayleighScatteringBase = vec3(5.802, 13.558, 33.1);
const float rayleighAbsorptionBase = 0.0;
const float mieScatteringBase = 3.996;
const float mieAbsorptionBase = 4.4;
const vec3 ozoneAbsorptionBase = vec3(0.650, 1.881, 0.085);

float safeacos(float x) { return acos(clamp(x, -1.0, 1.0)); }

float getMiePhase(float cosTheta) {
  const float g = 0.8;
  const float scale = 3.0 / (8.0 * PI);
  float num = (1.0 - g * g) * (1.0 + cosTheta * cosTheta);
  float denom = (2.0 + g * g) * pow((1.0 + g * g - 2.0 * g * cosTheta), 1.5);
  return scale * num / denom;
}

float getRayleighPhase(float cosTheta) {
  const float k = 3.0 / (16.0 * PI);
  return k * (1.0 + cosTheta * cosTheta);
}

void getScatteringValues(vec3 pos, out vec3 rayleighScattering, out float mieScattering, out vec3 extinction) {
  float altitudeKM = (length(pos) - groundRadiusMM) * 1000.0;
  float rayleighDensity = exp(-altitudeKM / 8.0);
  float mieDensity = exp(-altitudeKM / 1.2);
  rayleighScattering = rayleighScatteringBase * rayleighDensity;
  float rayleighAbsorption = rayleighAbsorptionBase * rayleighDensity;
  mieScattering = mieScatteringBase * mieDensity;
  float mieAbsorption = mieAbsorptionBase * mieDensity;
  vec3 ozoneAbsorption = ozoneAbsorptionBase * max(0.0, 1.0 - abs(altitudeKM - 25.0) / 15.0);
  extinction = rayleighScattering + rayleighAbsorption + mieScattering + mieAbsorption + ozoneAbsorption;
}

float rayIntersectSphere(vec3 ro, vec3 rd, float rad) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  if (c > 0.0 && b > 0.0) return -1.0;
  float discr = b * b - c;
  if (discr < 0.0) return -1.0;
  if (discr > b * b) return (-b + sqrt(discr));
  return -b - sqrt(discr);
}

vec3 getValFromTLUT(sampler2D tex, vec3 pos, vec3 sunDir) {
  float height = length(pos);
  vec3 up = pos / height;
  float sunCosZenithAngle = dot(sunDir, up);
  vec2 uv = vec2(clamp(0.5 + 0.5 * sunCosZenithAngle, 0.0, 1.0),
                 clamp((height - groundRadiusMM) / (atmosphereRadiusMM - groundRadiusMM), 0.0, 1.0));
  return texture(tex, uv).rgb;
}
`;

export const TRANSMITTANCE_FRAG = /* glsl */ `
precision highp float;
${COMMON}
${ATMOSPHERE_CORE}
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
const float sunTransmittanceSteps = 40.0;

vec3 getSunTransmittance(vec3 pos, vec3 sunDir) {
  if (rayIntersectSphere(pos, sunDir, groundRadiusMM) > 0.0) return vec3(0.0);
  float atmoDist = rayIntersectSphere(pos, sunDir, atmosphereRadiusMM);
  float t = 0.0;
  vec3 transmittance = vec3(1.0);
  for (float i = 0.0; i < sunTransmittanceSteps; i += 1.0) {
    float newT = ((i + 0.3) / sunTransmittanceSteps) * atmoDist;
    float dt = newT - t;
    t = newT;
    vec3 newPos = pos + t * sunDir;
    vec3 rs, ext; float ms;
    getScatteringValues(newPos, rs, ms, ext);
    transmittance *= exp(-dt * ext);
  }
  return transmittance;
}

void main() {
  float sunCosTheta = 2.0 * vUv.x - 1.0;
  float sunTheta = safeacos(sunCosTheta);
  float height = mix(groundRadiusMM, atmosphereRadiusMM, vUv.y);
  vec3 pos = vec3(0.0, height, 0.0);
  vec3 sunDir = normalize(vec3(0.0, sunCosTheta, -sin(sunTheta)));
  fragColor = vec4(getSunTransmittance(pos, sunDir), 1.0);
}
`;

export const MULTISCATTER_FRAG = /* glsl */ `
precision highp float;
${COMMON}
${ATMOSPHERE_CORE}
uniform sampler2D tTransmittance;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
const float mulScattSteps = 20.0;
const int sqrtSamples = 8;

vec3 getSphericalDir(float theta, float phi) {
  float cosPhi = cos(phi), sinPhi = sin(phi), cosTheta = cos(theta), sinTheta = sin(theta);
  return vec3(sinPhi * sinTheta, cosPhi, sinPhi * cosTheta);
}

void getMulScattValues(vec3 pos, vec3 sunDir, out vec3 lumTotal, out vec3 fms) {
  lumTotal = vec3(0.0);
  fms = vec3(0.0);
  float invSamples = 1.0 / float(sqrtSamples * sqrtSamples);
  for (int i = 0; i < sqrtSamples; i++) {
    for (int j = 0; j < sqrtSamples; j++) {
      float theta = PI * (float(i) + 0.5) / float(sqrtSamples);
      float phi = safeacos(1.0 - 2.0 * (float(j) + 0.5) / float(sqrtSamples));
      vec3 rayDir = getSphericalDir(theta, phi);
      float atmoDist = rayIntersectSphere(pos, rayDir, atmosphereRadiusMM);
      float groundDist = rayIntersectSphere(pos, rayDir, groundRadiusMM);
      float tMax = atmoDist;
      if (groundDist > 0.0) tMax = groundDist;
      float cosTheta = dot(rayDir, sunDir);
      float miePhaseValue = getMiePhase(cosTheta);
      float rayleighPhaseValue = getRayleighPhase(-cosTheta);
      vec3 lum = vec3(0.0), lumFactor = vec3(0.0), transmittance = vec3(1.0);
      float t = 0.0;
      for (float stepI = 0.0; stepI < mulScattSteps; stepI += 1.0) {
        float newT = ((stepI + 0.3) / mulScattSteps) * tMax;
        float dt = newT - t;
        t = newT;
        vec3 newPos = pos + t * rayDir;
        vec3 rs, ext; float ms;
        getScatteringValues(newPos, rs, ms, ext);
        vec3 sampleTransmittance = exp(-dt * ext);
        vec3 scatteringNoPhase = rs + ms;
        vec3 scatteringF = (scatteringNoPhase - scatteringNoPhase * sampleTransmittance) / ext;
        lumFactor += transmittance * scatteringF;
        vec3 sunTransmittance = getValFromTLUT(tTransmittance, newPos, sunDir);
        vec3 inScattering = (rs * rayleighPhaseValue + ms * miePhaseValue) * sunTransmittance;
        vec3 scatteringIntegral = (inScattering - inScattering * sampleTransmittance) / ext;
        lum += scatteringIntegral * transmittance;
        transmittance *= sampleTransmittance;
      }
      if (groundDist > 0.0) {
        vec3 hitPos = pos + groundDist * rayDir;
        if (dot(pos, sunDir) > 0.0) {
          hitPos = normalize(hitPos) * groundRadiusMM;
          lum += transmittance * groundAlbedo * getValFromTLUT(tTransmittance, hitPos, sunDir);
        }
      }
      fms += lumFactor * invSamples;
      lumTotal += lum * invSamples;
    }
  }
}

void main() {
  float sunCosTheta = 2.0 * vUv.x - 1.0;
  float sunTheta = safeacos(sunCosTheta);
  float height = mix(groundRadiusMM, atmosphereRadiusMM, vUv.y);
  vec3 pos = vec3(0.0, height, 0.0);
  vec3 sunDir = normalize(vec3(0.0, sunCosTheta, -sin(sunTheta)));
  vec3 lum, f_ms;
  getMulScattValues(pos, sunDir, lum, f_ms);
  vec3 psi = lum / (1.0 - f_ms);
  fragColor = vec4(psi, 1.0);
}
`;

// Sky-view LUT: radiance for every view direction (relative to the sun azimuth),
// including moon light scattering. Intensities are baked in.
export const SKYVIEW_FRAG = /* glsl */ `
precision highp float;
${COMMON}
${ATMOSPHERE_CORE}
uniform sampler2D tTransmittance;
uniform sampler2D tMultiScatter;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform float uMoonIntensity;
uniform float uHaze;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
const float numScatteringSteps = 30.0;

vec3 getValFromMultiScattLUT(vec3 pos, vec3 sunDir) {
  float height = length(pos);
  vec3 up = pos / height;
  float sunCosZenithAngle = dot(sunDir, up);
  vec2 uv = vec2(clamp(0.5 + 0.5 * sunCosZenithAngle, 0.0, 1.0),
                 clamp((height - groundRadiusMM) / (atmosphereRadiusMM - groundRadiusMM), 0.0, 1.0));
  return texture(tMultiScatter, uv).rgb;
}

vec3 raymarchScattering(vec3 pos, vec3 rayDir, vec3 sunDir, float tMax) {
  float cosTheta = dot(rayDir, sunDir);
  float miePhaseValue = getMiePhase(cosTheta);
  float rayleighPhaseValue = getRayleighPhase(-cosTheta);
  vec3 lum = vec3(0.0);
  vec3 transmittance = vec3(1.0);
  float t = 0.0;
  for (float i = 0.0; i < numScatteringSteps; i += 1.0) {
    float newT = ((i + 0.3) / numScatteringSteps) * tMax;
    float dt = newT - t;
    t = newT;
    vec3 newPos = pos + t * rayDir;
    vec3 rs, ext; float ms;
    getScatteringValues(newPos, rs, ms, ext);
    ms *= uHaze;
    vec3 sampleTransmittance = exp(-dt * ext);
    vec3 sunTransmittance = getValFromTLUT(tTransmittance, newPos, sunDir);
    vec3 psiMS = getValFromMultiScattLUT(newPos, sunDir);
    vec3 rayleighInScattering = rs * (rayleighPhaseValue * sunTransmittance + psiMS);
    vec3 mieInScattering = ms * (miePhaseValue * sunTransmittance + psiMS);
    vec3 inScattering = rayleighInScattering + mieInScattering;
    vec3 scatteringIntegral = (inScattering - inScattering * sampleTransmittance) / ext;
    lum += scatteringIntegral * transmittance;
    transmittance *= sampleTransmittance;
  }
  return lum;
}

void main() {
  float azimuthAngle = (vUv.x - 0.5) * 2.0 * PI;
  float adjV;
  if (vUv.y < 0.5) {
    float coord = 1.0 - 2.0 * vUv.y;
    adjV = -coord * coord;
  } else {
    float coord = vUv.y * 2.0 - 1.0;
    adjV = coord * coord;
  }
  float height = length(viewPosAtmo);
  vec3 up = viewPosAtmo / height;
  float horizonAngle = safeacos(sqrt(height * height - groundRadiusMM * groundRadiusMM) / height) - 0.5 * PI;
  float altitudeAngle = adjV * 0.5 * PI - horizonAngle;
  float cosAltitude = cos(altitudeAngle);
  vec3 rayDir = vec3(cosAltitude * sin(azimuthAngle), sin(altitudeAngle), -cosAltitude * cos(azimuthAngle));

  float sunAltitude = (0.5 * PI) - acos(clamp(dot(uSunDir, up), -1.0, 1.0));
  vec3 sunDir = vec3(0.0, sin(sunAltitude), -cos(sunAltitude));

  float atmoDist = rayIntersectSphere(viewPosAtmo, rayDir, atmosphereRadiusMM);
  float groundDist = rayIntersectSphere(viewPosAtmo, rayDir, groundRadiusMM);
  float tMax = (groundDist < 0.0) ? atmoDist : groundDist;

  vec3 lum = raymarchScattering(viewPosAtmo, rayDir, sunDir, tMax) * uSunIntensity;
  if (uMoonIntensity > 0.0) {
    lum += raymarchScattering(viewPosAtmo, rayDir, -sunDir, tMax) * uMoonIntensity * vec3(0.85, 0.9, 1.0);
  }
  // faint airglow / light pollution so moonless nights are not pitch black
  lum += vec3(0.00035, 0.0005, 0.0009) * (1.0 - 0.5 * max(rayDir.y, 0.0));
  fragColor = vec4(lum, 1.0);
}
`;

// Lookup helpers used by every shader that needs sky radiance / sun color.
export const ATMOSPHERE_LOOKUP = /* glsl */ `
uniform sampler2D tTransmittance;
uniform sampler2D tSkyView;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uLightDir;
uniform float uSunIntensity;
uniform float uMoonIntensity;
uniform float uLightIsMoon;

vec3 skyRadiance(vec3 rayDir) {
  float height = length(viewPosAtmo);
  vec3 up = viewPosAtmo / height;
  float horizonAngle = safeacos(sqrt(height * height - groundRadiusMM * groundRadiusMM) / height);
  float altitudeAngle = horizonAngle - acos(clamp(dot(rayDir, up), -1.0, 1.0));
  float azimuthAngle;
  if (abs(altitudeAngle) > (0.5 * PI - 0.0001)) {
    azimuthAngle = 0.0;
  } else {
    vec3 sunH = vec3(uSunDir.x, 0.0, uSunDir.z);
    float sl = length(sunH);
    vec3 forward = sl > 1e-4 ? sunH / sl : vec3(0.0, 0.0, -1.0);
    vec3 right = cross(forward, up);
    vec3 projectedDir = normalize(vec3(rayDir.x, 0.0, rayDir.z) + 1e-6);
    float sinTheta = dot(projectedDir, right);
    float cosTheta = dot(projectedDir, forward);
    azimuthAngle = atan(sinTheta, cosTheta) + PI;
  }
  float v = 0.5 + 0.5 * sign(altitudeAngle) * sqrt(abs(altitudeAngle) * 2.0 / PI);
  vec2 uv = vec2(azimuthAngle / (2.0 * PI), v);
  return texture(tSkyView, uv).rgb;
}

vec3 sunTransmittanceAt(vec3 dir) {
  return getValFromTLUT(tTransmittance, viewPosAtmo, dir);
}

// Radiance (illuminance) of the active directional light (sun or moon).
vec3 directLightColor() {
  vec3 sun = uSunIntensity * sunTransmittanceAt(uSunDir) * smoothstep(-0.03, 0.02, uSunDir.y);
  vec3 moon = uMoonIntensity * vec3(0.72, 0.8, 1.0) * sunTransmittanceAt(uMoonDir) * smoothstep(-0.03, 0.04, uMoonDir.y);
  return uLightIsMoon > 0.5 ? moon : sun;
}
`;
