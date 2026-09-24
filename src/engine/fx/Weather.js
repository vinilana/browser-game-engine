import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, RawShaderMaterial, GLSL3,
  DataTexture, FloatType, RedFormat, NearestFilter, Vector3, Vector2, Sphere, NormalBlending,
} from 'three';
import { COMMON } from '../render/shaders/common.js';
import { ATMOSPHERE_CORE, ATMOSPHERE_LOOKUP } from '../render/shaders/atmosphere.js';
import { ENV_LOOKUP } from '../render/shaders/sky.js';

const RAIN_VERT = /* glsl */ `
precision highp float;
in vec2 corner;
in vec4 iSeed;            // x, z offset in [0,1), phase, speed factor
uniform mat4 projectionMatrix;
uniform mat4 uViewRotOnly;
uniform vec3 uCameraPos;
uniform float uTime;
uniform float uRadius;
uniform float uHeight;
uniform vec2 uWind;
uniform sampler2D tHeight;   // top solid block height around the camera
uniform vec2 uHeightOrigin;  // world xz of texel (0,0)
uniform float uHeightSize;
out vec2 vCorner;
out float vAlpha;
out float vDepth;
void main() {
  float speed = 11.0 * iSeed.w;
  float fall = fract(iSeed.z - uTime * speed / uHeight);
  // world position of the drop (wrapped around the camera)
  vec2 cell = floor(uCameraPos.xz / (uRadius * 2.0));
  vec2 base = (iSeed.xy - 0.5) * uRadius * 2.0;
  vec2 xz = uCameraPos.xz + mod(base - uCameraPos.xz + uRadius, uRadius * 2.0) - uRadius;
  float y = uCameraPos.y - uHeight * 0.35 + fall * uHeight;
  xz += uWind * (1.0 - fall) * 0.25;
  vec3 world = vec3(xz.x, y, xz.y);
  // occlusion by roofs / terrain
  vec2 huv = (world.xz - uHeightOrigin) / uHeightSize;
  float top = texture(tHeight, huv).r;
  vAlpha = (world.y > top) ? 1.0 : 0.0;
  if (huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) vAlpha = 1.0;
  vec3 rel = world - uCameraPos;
  float dist = length(rel);
  vAlpha *= smoothstep(uRadius, uRadius * 0.6, length(rel.xz)) * smoothstep(0.3, 1.5, dist);
  // velocity-aligned streak: expand along the fall direction in view space
  vec3 fallDir = normalize(vec3(uWind.x * 0.08, -1.0, uWind.y * 0.08));
  vec4 vp = uViewRotOnly * vec4(rel, 1.0);
  vec3 vdir = (uViewRotOnly * vec4(fallDir, 0.0)).xyz;
  vec3 side = normalize(cross(vdir, vp.xyz));
  float len = 0.55 * iSeed.w;
  vec3 p = vp.xyz + vdir * corner.y * len + side * corner.x * (0.014 + 0.004 * dist);
  gl_Position = projectionMatrix * vec4(p, 1.0);
  vCorner = corner;
  vDepth = -p.z;
}
`;

const RAIN_FRAG = /* glsl */ `
precision highp float;
${COMMON}
${ATMOSPHERE_CORE}
${ATMOSPHERE_LOOKUP}
${ENV_LOOKUP}
uniform float uIntensity;
uniform float uCameraSkyLight;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
in vec2 vCorner;
in float vAlpha;
in float vDepth;
layout(location = 0) out vec4 fragColor;
void main() {
  if (vAlpha <= 0.0) discard;
  float sceneDist = texture(tSceneDepth, gl_FragCoord.xy / uResolution).x;
  if (vDepth > sceneDist) discard;
  float a = (1.0 - abs(vCorner.x)) * smoothstep(-1.0, -0.2, vCorner.y) * smoothstep(1.0, 0.4, vCorner.y);
  vec3 amb = shIrradiance(vec3(0.0, 1.0, 0.0)) * 1.4 + directLightColor() * 0.05;
  fragColor = vec4(amb * 1.3, a * vAlpha * 0.38 * uIntensity);
}
`;

/**
 * Rain rendered as GPU-animated streaks around the camera, occluded by a
 * heightmap of the terrain so it doesn't fall under roofs.
 */
export class Weather {
  constructor(pipeline, world, { drops = 6000, radius = 22, height = 26 } = {}) {
    this.pipeline = pipeline;
    this.world = world;
    this.radius = radius;
    this.height = height;
    this.intensity = 0;
    this.target = 0;
    this.lightning = 0;
    this._lightningTimer = 8;

    const geo = new InstancedBufferGeometry();
    geo.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(drops * 4);
    for (let i = 0; i < drops; i++) {
      seeds[i * 4] = Math.random(); seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random(); seeds[i * 4 + 3] = 0.8 + Math.random() * 0.4;
    }
    geo.setAttribute('iSeed', new InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = drops;
    geo.boundingSphere = new Sphere(new Vector3(), 1e9);
    this.maxDrops = drops;

    this.hSize = 64;
    this.hData = new Float32Array(this.hSize * this.hSize).fill(-1000);
    this.hTex = new DataTexture(this.hData, this.hSize, this.hSize, RedFormat, FloatType);
    this.hTex.minFilter = this.hTex.magFilter = NearestFilter;
    this.hTex.needsUpdate = true;
    this.hOrigin = new Vector2();
    this._lastHeightCenter = new Vector2(1e9, 1e9);

    const S = pipeline.shared;
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: {
        ...S,
        uViewRotOnly: { value: pipeline.viewRot },
        uRadius: { value: radius },
        uHeight: { value: height },
        uWind: { value: new Vector2(1.5, 0.6) },
        tHeight: { value: this.hTex },
        uHeightOrigin: { value: this.hOrigin },
        uHeightSize: { value: this.hSize },
        uIntensity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    pipeline.forwardScene.add(this.mesh);
  }

  _updateHeightmap(cam) {
    const cx = Math.floor(cam.x), cz = Math.floor(cam.z);
    if (Math.abs(cx - this._lastHeightCenter.x) < 4 && Math.abs(cz - this._lastHeightCenter.y) < 4 && !this._dirty) return;
    this._lastHeightCenter.set(cx, cz);
    this._dirty = false;
    const n = this.hSize;
    const ox = cx - n / 2, oz = cz - n / 2;
    this.hOrigin.set(ox, oz);
    const reg = this.world.registry;
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const wx = ox + x, wz = oz + z;
        let top = -1000;
        const c = this.world.getColumn(Math.floor(wx / 32), Math.floor(wz / 32));
        if (c && c.blocks) {
          const lx = wx - c.cx * 32, lz = wz - c.cz * 32;
          for (let y = c.maxY; y >= 0; y--) {
            const id = c.blocks[(y * 32 + lz) * 32 + lx];
            if (id !== 0 && (reg.solid[id] || reg.liquid[id] || reg.renderType[id] === 2)) { top = y + 1; break; }
          }
        }
        this.hData[z * n + x] = top;
      }
    }
    this.hTex.needsUpdate = true;
  }

  markDirty() { this._dirty = true; }

  update(dt, cameraPos) {
    this.intensity += (this.target - this.intensity) * Math.min(1, dt * 0.25);
    const vis = this.intensity > 0.01;
    this.mesh.visible = vis;
    this.material.uniforms.uIntensity.value = this.intensity;
    this.geometry = this.mesh.geometry;
    this.mesh.geometry.instanceCount = Math.floor(this.maxDrops * Math.min(1, this.intensity * 1.2));
    this.pipeline.atmosphere.rain = this.intensity;
    if (vis) this._updateHeightmap(cameraPos);
    // lightning in heavy storms
    this.lightning = Math.max(0, this.lightning - dt * 4);
    if (this.intensity > 0.75) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightningTimer = 6 + Math.random() * 18;
        this.lightning = 1;
        this.onLightning?.();
      }
    }
  }
}
