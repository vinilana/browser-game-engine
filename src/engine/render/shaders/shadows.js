// Cascaded shadow map sampling (hardware PCF + rotated Poisson disk).

export const SHADOW_SAMPLING = /* glsl */ `
uniform highp sampler2DShadow tShadow;
uniform mat4 uShadowMatrix[4];   // camera-relative world -> cascade local [0,1]^3
uniform vec4 uShadowTile[4];     // xy = scale, zw = offset inside the atlas
uniform vec4 uShadowSplits;      // far view distance of each cascade
uniform vec4 uShadowTexel;       // world size of one texel per cascade
uniform vec4 uShadowDepthBias;   // depth bias per cascade (light clip units)
uniform int uShadowCascades;
uniform float uShadowAtlasTexel; // 1 / atlas size
uniform float uShadowSoftness;   // penumbra radius in world units

const vec2 POISSON12[12] = vec2[](
  vec2(-0.326212, -0.40581), vec2(-0.840144, -0.07358), vec2(-0.695914, 0.457137),
  vec2(-0.203345, 0.620716), vec2(0.96234, -0.194983), vec2(0.473434, -0.480026),
  vec2(0.519456, 0.767022), vec2(0.185461, -0.893124), vec2(0.507431, 0.064425),
  vec2(0.89642, 0.412458), vec2(-0.32194, -0.932615), vec2(-0.791559, -0.59771)
);

float shadowCascade(int c, vec3 pRel, vec3 N, float NdotL, float dither, int taps) {
  float texel = uShadowTexel[c];
  // normal offset grows at grazing angles
  float offs = texel * (1.2 + 1.8 * (1.0 - NdotL));
  vec4 sc = uShadowMatrix[c] * vec4(pRel + N * offs, 1.0);
  vec3 s = sc.xyz;
  if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0) return -1.0;
  vec4 tile = uShadowTile[c];
  float radiusTexels = clamp(uShadowSoftness / texel, 1.0, 5.0);
  vec2 radius = radiusTexels * uShadowAtlasTexel * vec2(1.0) ;
  vec2 lo = tile.zw + uShadowAtlasTexel * 1.5;
  vec2 hi = tile.zw + tile.xy - uShadowAtlasTexel * 1.5;
  vec2 uv = s.xy * tile.xy + tile.zw;
  float z = s.z - uShadowDepthBias[c];
  float a = dither * 6.2831853;
  float ca = cos(a), sa = sin(a);
  mat2 rot = mat2(ca, sa, -sa, ca);
  float sum = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= taps) break;
    vec2 o = rot * POISSON12[i] * radius;
    sum += texture(tShadow, vec3(clamp(uv + o, lo, hi), z));
  }
  return sum / float(taps);
}

// Returns (visibility, coverage). coverage fades to 0 at the end of the last
// cascade so callers can blend toward a fallback (e.g. skylight-based).
vec2 sampleShadow(vec3 pRel, vec3 N, float NdotL, float viewDist, float dither, int taps) {
  for (int c = 0; c < 4; c++) {
    if (c >= uShadowCascades) break;
    float far = uShadowSplits[c];
    if (viewDist < far) {
      float s = shadowCascade(c, pRel, N, NdotL, dither, taps);
      if (s < 0.0) continue;
      float blendStart = far * 0.85;
      float cover = 1.0;
      if (c + 1 < uShadowCascades) {
        if (viewDist > blendStart) {
          float s2 = shadowCascade(c + 1, pRel, N, NdotL, dither, max(taps / 2, 4));
          if (s2 >= 0.0) s = mix(s, s2, smoothstep(blendStart, far, viewDist));
        }
      } else {
        cover = 1.0 - smoothstep(blendStart, far, viewDist);
      }
      return vec2(s, cover);
    }
  }
  return vec2(1.0, 0.0);
}

// Cheap single-tap lookup (volumetrics).
float sampleShadowFast(vec3 pRel, float viewDist) {
  for (int c = 0; c < 4; c++) {
    if (c >= uShadowCascades) break;
    if (viewDist < uShadowSplits[c]) {
      vec4 sc = uShadowMatrix[c] * vec4(pRel, 1.0);
      if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) continue;
      vec4 tile = uShadowTile[c];
      return texture(tShadow, vec3(sc.xy * tile.xy + tile.zw, sc.z - uShadowDepthBias[c]));
    }
  }
  return 1.0;
}
`;
