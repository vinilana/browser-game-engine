// First-person arm + held block, drawn in the pipeline's overlay pass.
import {
  Group, Mesh, BoxGeometry, PlaneGeometry, BufferAttribute, RawShaderMaterial, GLSL3, DoubleSide, Vector3, Matrix3,
} from 'three';
import { COMMON } from '../engine/render/shaders/common.js';
import { ATMOSPHERE_CORE, ATMOSPHERE_LOOKUP } from '../engine/render/shaders/atmosphere.js';
import { ENV_LOOKUP } from '../engine/render/shaders/sky.js';
import { RenderType, Tint } from '../engine/voxel/BlockRegistry.js';

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
in float layer;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec2 vUv;
out float vLayer;
out vec3 vNormalV;
void main() {
  vUv = uv;
  vLayer = layer;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
uniform mat4 uCamRot;
uniform vec3 uColor;
uniform vec3 uTint;
uniform float uTintMode;
uniform float uSky;
uniform float uBlock;
uniform float uSunVis;
uniform float uEmissive;
uniform vec3 uBlockLightColor;
uniform float uBlockLightIntensity;
uniform float uHeldLight;
in vec2 vUv;
in float vLayer;
in vec3 vNormalV;
layout(location = 0) out vec4 fragColor;
void main() {
  vec3 albedo = uColor;
  float emit = uEmissive;
  if (vLayer >= 0.0) {
    vec4 t = texture(tAlbedoArr, vec3(vUv, vLayer));
    if (t.a < 0.5 && uTintMode != 2.0) discard;
    albedo = t.rgb;
    if (uTintMode == 1.0) albedo *= uTint;
    else if (uTintMode == 2.0) albedo *= mix(vec3(1.0), uTint, t.a);
  }
  vec3 N = normalize((uCamRot * vec4(normalize(vNormalV), 0.0)).xyz);
  vec3 L = uLightDir;
  vec3 amb = shIrradiance(N) * pow(uSky, 2.2);
  vec3 direct = directLightColor() * max(dot(N, L), 0.0) / PI * uSunVis;
  float bl = uBlock * 15.0;
  float blockF = bl > 0.01 ? exp2((bl - 15.0) * 0.46) : 0.0;
  vec3 blk = uBlockLightColor * uBlockLightIntensity * max(blockF, uHeldLight * 0.8);
  vec3 col = albedo * (amb + direct + blk) + albedo * emit * 5.0;
  fragColor = vec4(col, 1.0);
}
`;

export class Hand {
  constructor(game) {
    this.game = game;
    const pipe = game.engine.pipeline;
    this.group = new Group();
    pipe.overlayScene.add(this.group);
    this.uniforms = {
      ...pipe.shared,
      tAlbedoArr: { value: game.world.textures.albedo },
      uColor: { value: new Vector3(0.78, 0.58, 0.45) },
      uTint: { value: new Vector3(0.36, 0.5, 0.2) },
      uTintMode: { value: 0 },
      uSky: { value: 1 },
      uBlock: { value: 0 },
      uSunVis: { value: 1 },
      uEmissive: { value: 0 },
    };
    this.armMat = new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...this.uniforms, uColor: { value: new Vector3(0.62, 0.43, 0.32) } } });
    this.itemMat = new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: DoubleSide });
    const armGeo = new BoxGeometry(0.16, 0.16, 0.62);
    armGeo.setAttribute('layer', new BufferAttribute(new Float32Array(armGeo.attributes.position.count).fill(-1), 1));
    this.arm = new Mesh(armGeo, this.armMat);
    this.arm.frustumCulled = false;
    this.group.add(this.arm);
    this.item = null;
    this.itemId = -1;
    this.swing = 0;
    this.equip = 1;
    this.sunVis = 1;
    this._sunTimer = 0;
    this._geoCache = new Map();
  }

  _geometry(id) {
    if (this._geoCache.has(id)) return this._geoCache.get(id);
    const reg = this.game.registry;
    const rt = reg.renderType[id];
    let geo;
    if (rt === RenderType.CROSS || rt === RenderType.TORCH) {
      geo = new PlaneGeometry(1, 1);
      const layer = reg.faceLayer[id * 6 + 2];
      geo.setAttribute('layer', new BufferAttribute(new Float32Array(4).fill(layer), 1));
      const uv = geo.attributes.uv;
      if (rt === RenderType.TORCH) {
        for (let i = 0; i < 4; i++) uv.setXY(i, 5 / 16 + uv.getX(i) * 6 / 16, 0.34 + (1 - uv.getY(i)) * 0.66);
        geo.scale(0.6, 1, 1);
      } else {
        for (let i = 0; i < 4; i++) uv.setY(i, 1 - uv.getY(i));
      }
    } else {
      geo = new BoxGeometry(1, 1, 1);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      const layers = new Float32Array(24);
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) layers[f * 4 + k] = reg.faceLayer[id * 6 + f];
      geo.setAttribute('layer', new BufferAttribute(layers, 1));
    }
    this._geoCache.set(id, geo);
    return geo;
  }

  onAction() { this.swing = 1; }

  update(dt) {
    const g = this.game;
    const reg = g.registry;
    const cam = g.engine.camera;
    const oc = g.engine.pipeline.overlayCamera;
    oc.fov = 70;
    oc.updateProjectionMatrix();
    const id = g.ui.selectedBlock() || 0;
    if (id !== this.itemId) {
      this.equip = 0;
      this.itemId = id;
      if (this.item) { this.group.remove(this.item); this.item = null; }
      if (id) {
        this.item = new Mesh(this._geometry(id), this.itemMat);
        this.item.frustumCulled = false;
        this.group.add(this.item);
        const t = reg.tint[id];
        this.uniforms.uTintMode.value = t === Tint.MASKED_GRASS ? 2 : t ? 1 : 0;
        this.uniforms.uEmissive.value = reg.emission[id] > 0 ? 0.6 : 0;
      }
    }
    this.group.visible = g.started && !g.ui.blocking && document.getElementById('hud') && !document.getElementById('hud').classList.contains('hidden');
    this.equip = Math.min(1, this.equip + dt * 5);
    this.swing = Math.max(0, this.swing - dt * 4.5);

    // light at the eye
    const p = cam.position;
    const l = g.world.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    this.uniforms.uSky.value += ((l >> 4) / 15 - this.uniforms.uSky.value) * Math.min(1, dt * 4);
    this.uniforms.uBlock.value += ((l & 15) / 15 - this.uniforms.uBlock.value) * Math.min(1, dt * 4);
    this._sunTimer -= dt;
    if (this._sunTimer <= 0) {
      this._sunTimer = 0.15;
      const L = g.engine.atmosphere.lightDir;
      const hit = g.world.raycast(p, L, 96, (bid) => reg.opaque[bid] || reg.renderType[bid] === RenderType.CUTOUT);
      this.sunVis = hit ? 0 : 1;
    }
    this.uniforms.uSunVis.value += (this.sunVis - this.uniforms.uSunVis.value) * Math.min(1, dt * 6);

    // pose (view space)
    const pl = g.player;
    const bobX = Math.cos(pl.bob) * 0.035 * pl.bobAmount;
    const bobY = -Math.abs(Math.sin(pl.bob)) * 0.045 * pl.bobAmount;
    const s = Math.sin(this.swing * Math.PI);
    const drop = (1 - this.equip) * 0.5;
    const ox = 0.42 + bobX - s * 0.18, oy = -0.42 + bobY - drop + s * 0.12, oz = -0.72 - s * 0.2;
    this.arm.position.set(ox + 0.07, oy - 0.2, oz + 0.28);
    this.arm.rotation.set(0.35 - s * 0.9, 0.18, 0.05);
    if (this.item) {
      const rt = reg.renderType[id];
      const flat = rt === RenderType.CROSS || rt === RenderType.TORCH;
      const sc = flat ? 0.32 : 0.28;
      this.item.scale.setScalar(sc);
      this.item.position.set(ox - 0.04, oy + 0.02, oz - 0.02);
      this.item.rotation.set(-0.15 - s * 1.0, flat ? -0.4 : 0.75, flat ? 0.1 : 0.05 - s * 0.3);
      this.arm.visible = false;
    } else {
      this.arm.visible = true;
    }
  }
}
