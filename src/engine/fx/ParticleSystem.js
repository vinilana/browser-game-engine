import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, RawShaderMaterial, GLSL3,
  NormalBlending, Vector3, Sphere,
} from 'three';
import { COMMON } from '../render/shaders/common.js';
import { ATMOSPHERE_CORE, ATMOSPHERE_LOOKUP } from '../render/shaders/atmosphere.js';
import { ENV_LOOKUP } from '../render/shaders/sky.js';

const VERT = /* glsl */ `
precision highp float;
in vec2 corner;
in vec3 iPos;       // camera-relative position
in vec4 iSize;      // size, rotation, stretch, type
in vec4 iColor;     // rgb tint, alpha
in vec4 iTex;       // layer (-1 = none), u0, v0, uv size
in vec4 iLight;     // sky, block, emissive, -
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 uViewRotOnly;
out vec2 vUv;
out vec2 vCorner;
out vec4 vColor;
out vec4 vTex;
out vec4 vLight;
out float vViewZ;
void main() {
  float s = iSize.x;
  float r = iSize.y;
  vec2 c = corner;
  float cr = cos(r), sr = sin(r);
  c = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr);
  vec4 vp = uViewRotOnly * vec4(iPos, 1.0);
  vp.xy += c * s;
  gl_Position = projectionMatrix * vp;
  vViewZ = -vp.z;
  vCorner = corner;
  vUv = iTex.yz + (corner * 0.5 + 0.5) * iTex.w;
  vColor = iColor;
  vTex = iTex;
  vLight = iLight;
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
${COMMON}
${ATMOSPHERE_CORE}
${ATMOSPHERE_LOOKUP}
${ENV_LOOKUP}
uniform sampler2DArray tAlbedoArr;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform vec3 uBlockLightColor;
uniform float uBlockLightIntensity;
in vec2 vUv;
in vec2 vCorner;
in vec4 vColor;
in vec4 vTex;
in vec4 vLight;
in float vViewZ;
layout(location = 0) out vec4 fragColor;
void main() {
  vec4 base = vec4(vColor.rgb, vColor.a);
  if (vTex.x >= 0.0) {
    vec4 t = texture(tAlbedoArr, vec3(vUv, vTex.x));
    if (t.a < 0.5) discard;
    base.rgb *= t.rgb;
  } else {
    // soft round sprite
    float d = length(vCorner);
    base.a *= smoothstep(1.0, 0.2, d);
    if (base.a < 0.004) discard;
  }
  float sky = vLight.x, blk = vLight.y;
  vec3 lightCol = directLightColor();
  vec3 amb = shIrradiance(vec3(0.0, 1.0, 0.0)) * pow(sky, 2.2);
  vec3 lit = base.rgb * (amb + lightCol * max(uLightDir.y, 0.0) * 0.35 * smoothstep(0.8, 1.0, sky)
             + uBlockLightColor * uBlockLightIntensity * exp2((blk * 15.0 - 15.0) * 0.46) * step(0.01, blk));
  lit += base.rgb * vLight.z;
  // soft particles
  float sceneDist = texture(tSceneDepth, gl_FragCoord.xy / uResolution).x;
  float fade = vTex.x >= 0.0 ? 1.0 : saturate((sceneDist - vViewZ) * 2.0);
  fragColor = vec4(lit, base.a * fade);
}
`;

/**
 * CPU-simulated, GPU-instanced particles rendered in the forward pass.
 * Supports textured debris (sampling the block texture array) and soft
 * emissive/smoke sprites.
 */
export class ParticleSystem {
  constructor(pipeline, { max = 4096, textureArray = null, world = null } = {}) {
    this.pipeline = pipeline;
    this.max = max;
    this.world = world;
    this.count = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.rotV = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.color = new Float32Array(max * 4);
    this.tex = new Float32Array(max * 4);
    this.emissive = new Float32Array(max);
    this.collide = new Uint8Array(max);
    this.fadeOut = new Uint8Array(max);
    this.grow = new Float32Array(max);

    const geo = new InstancedBufferGeometry();
    geo.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aSize = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aColor = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aTex = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aLight = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    for (const a of [this.aPos, this.aSize, this.aColor, this.aTex, this.aLight]) a.setUsage(35048); // DynamicDraw
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iTex', this.aTex);
    geo.setAttribute('iLight', this.aLight);
    geo.instanceCount = 0;
    geo.boundingSphere = new Sphere(new Vector3(), 1e9);
    this.geometry = geo;

    const S = pipeline.shared;
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...S,
        tAlbedoArr: { value: textureArray },
        uViewRotOnly: { value: pipeline.viewRot },
      },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    pipeline.forwardScene.add(this.mesh);
  }

  setTextureArray(tex) { this.material.uniforms.tAlbedoArr.value = tex; }

  /**
   * @param {object} o
   * @param {Vector3|number[]} o.position
   * @param {number[]} [o.velocity]
   */
  emit(o) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    const p = o.position;
    this.p[i * 3] = p.x ?? p[0]; this.p[i * 3 + 1] = p.y ?? p[1]; this.p[i * 3 + 2] = p.z ?? p[2];
    const v = o.velocity || [0, 0, 0];
    this.v[i * 3] = v[0]; this.v[i * 3 + 1] = v[1]; this.v[i * 3 + 2] = v[2];
    this.life[i] = this.maxLife[i] = o.life ?? 1;
    this.size[i] = o.size ?? 0.1;
    this.rot[i] = o.rotation ?? Math.random() * 6.28;
    this.rotV[i] = o.spin ?? 0;
    this.gravity[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    const c = o.color || [1, 1, 1, 1];
    this.color.set([c[0], c[1], c[2], c[3] ?? 1], i * 4);
    const t = o.tex || [-1, 0, 0, 1];
    this.tex.set(t, i * 4);
    this.emissive[i] = o.emissive ?? 0;
    this.collide[i] = o.collide ? 1 : 0;
    this.fadeOut[i] = o.fade === false ? 0 : 1;
    this.grow[i] = o.grow ?? 0;
    return i;
  }

  _kill(i) {
    const j = --this.count;
    if (i === j) return;
    const copy = (arr, n) => { for (let k = 0; k < n; k++) arr[i * n + k] = arr[j * n + k]; };
    copy(this.p, 3); copy(this.v, 3); copy(this.color, 4); copy(this.tex, 4);
    for (const arr of [this.life, this.maxLife, this.size, this.rot, this.rotV, this.gravity, this.drag, this.emissive, this.collide, this.fadeOut, this.grow]) arr[i] = arr[j];
  }

  update(dt, camPos) {
    const w = this.world;
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._kill(i); continue; }
      const o = i * 3;
      this.v[o + 1] -= this.gravity[i] * dt;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[o] *= d; this.v[o + 1] *= d; this.v[o + 2] *= d;
      let nx = this.p[o] + this.v[o] * dt;
      let ny = this.p[o + 1] + this.v[o + 1] * dt;
      let nz = this.p[o + 2] + this.v[o + 2] * dt;
      if (this.collide[i] && w) {
        const r = this.size[i] * 0.5;
        if (w.registry.solid[w.getBlock(Math.floor(nx), Math.floor(ny - r), Math.floor(nz))]) {
          if (this.v[o + 1] < 0) {
            ny = Math.floor(ny - r) + 1 + r;
            this.v[o + 1] *= -0.25;
            this.v[o] *= 0.6; this.v[o + 2] *= 0.6;
            this.rotV[i] *= 0.5;
          }
        }
        if (w.registry.solid[w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(this.p[o + 2]))]) { nx = this.p[o]; this.v[o] *= -0.3; }
        if (w.registry.solid[w.getBlock(Math.floor(this.p[o]), Math.floor(ny), Math.floor(nz))]) { nz = this.p[o + 2]; this.v[o + 2] *= -0.3; }
      }
      this.p[o] = nx; this.p[o + 1] = ny; this.p[o + 2] = nz;
      this.rot[i] += this.rotV[i] * dt;
    }
    // upload
    const n = this.count;
    const P = this.aPos.array, Sz = this.aSize.array, C = this.aColor.array, T = this.aTex.array, L = this.aLight.array;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      P[o] = this.p[o] - camPos.x; P[o + 1] = this.p[o + 1] - camPos.y; P[o + 2] = this.p[o + 2] - camPos.z;
      const t = this.life[i] / this.maxLife[i];
      const fade = this.fadeOut[i] ? Math.min(1, t * 3) : 1;
      Sz[i * 4] = this.size[i] * (1 + this.grow[i] * (1 - t));
      Sz[i * 4 + 1] = this.rot[i];
      for (let k = 0; k < 4; k++) { C[i * 4 + k] = this.color[i * 4 + k]; T[i * 4 + k] = this.tex[i * 4 + k]; }
      C[i * 4 + 3] *= fade;
      if (this.tex[i * 4] >= 0 && this.fadeOut[i]) Sz[i * 4] *= Math.min(1, t * 4);
      let sky = 1, blk = 0;
      if (w) {
        const l = w.getLight(Math.floor(this.p[o]), Math.floor(this.p[o + 1]), Math.floor(this.p[o + 2]));
        sky = (l >> 4) / 15; blk = (l & 15) / 15;
      }
      L[i * 4] = sky; L[i * 4 + 1] = blk; L[i * 4 + 2] = this.emissive[i]; L[i * 4 + 3] = 0;
    }
    for (const a of [this.aPos, this.aSize, this.aColor, this.aTex, this.aLight]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    this.geometry.instanceCount = n;
  }
}
