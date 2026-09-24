import {
  WebGLRenderTarget, HalfFloatType, FloatType, UnsignedByteType, NearestFilter, LinearFilter, DepthTexture,
  RGBAFormat, RedFormat, RGFormat, Matrix4, Vector2, Vector3, Scene, ShaderMaterial, GLSL3,
  LinearMipmapLinearFilter, Color, PerspectiveCamera, Vector4, DataTexture,
} from 'three';
import { FullscreenPass } from './FullscreenPass.js';
import { createDefaultShadowMaterial, setGBufferTimeUniform } from './materials/GBufferMaterial.js';
import { Atmosphere } from './Atmosphere.js';
import { ShadowCascades } from './ShadowCascades.js';
import { LIGHTING_FRAG } from './shaders/lighting.js';
import {
  SSAO_FRAG, SSAO_BLUR_FRAG, COPY_FRAG, DEPTH_COPY_FRAG, VOLUMETRIC_FRAG, TAA_FRAG, BLOOM_DOWN_FRAG, BLOOM_UP_FRAG,
  LUMINANCE_FRAG, ADAPT_FRAG, FINAL_FRAG,
} from './shaders/post.js';

const HALTON = [];
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
for (let i = 1; i <= 16; i++) HALTON.push([halton(i, 2) - 0.5, halton(i, 3) - 0.5]);

function rt(w, h, opts = {}) {
  return new WebGLRenderTarget(w, h, {
    type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false, ...opts,
  });
}

/**
 * Deferred HDR rendering pipeline:
 *   shadows -> atmosphere/sky -> G-buffer -> SSAO -> lighting -> forward (water, glass, fx)
 *   -> volumetric light -> TAA -> bloom -> auto exposure -> tonemap/grade.
 *
 * Objects in `scene` must use G-buffer materials (3 MRT outputs). Objects in
 * `forwardScene` are shaded forward into the HDR buffer and may sample
 * `tSceneColor` / `tSceneDepth` (copies of the lit opaque scene).
 */
export class RenderPipeline {
  constructor(renderer, camera, settings) {
    this.renderer = renderer;
    this.camera = camera;
    this.settings = settings;
    this.scene = new Scene();
    this.forwardScene = new Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.forwardScene.matrixWorldAutoUpdate = false;
    // First-person overlay (hands / held items): rendered after TAA, composited before tonemapping.
    this.overlayScene = new Scene();
    this.overlayCamera = new PerspectiveCamera(70, 1, 0.01, 20);
    this.shadowCasters = new Set();
    this.frame = 0;
    this.time = 0;
    this.width = 1;
    this.height = 1;
    this.historyIndex = 0;
    this.resetHistory = true;
    this.cameraSkyLight = 1;
    this.underwater = false;
    this.waterSurfaceY = 62;
    this.heldLight = 0;
    this.farDistance = 0;
    this.stats = { drawCalls: 0, triangles: 0 };

    this.atmosphere = new Atmosphere();
    this._applyCloudSettings();
    this.shadows = new ShadowCascades({
      tileSize: settings.get('shadowMapSize'), cascades: settings.get('shadowCascades'), distance: settings.get('shadowDistance'),
    });

    this.projNoJitter = new Matrix4();
    this.prevViewProj = new Matrix4();
    this.camRot = new Matrix4();
    this.viewRot = new Matrix4();
    this.jitter = new Vector2();
    this.prevCamPos = new Vector3();
    this._invVPRot = new Matrix4();
    this._tmpM4 = new Matrix4();

    this.params = {
      fogDensity: 0.0016, fogHeight: 64, fogFalloff: 0.035,
      volumetricDensity: 0.0035, bloomStrength: 0.045, sharpen: 0.55,
      vignette: 0.55, saturation: 1.06, contrast: 1.04, grain: 0.012, tonemap: 0,
      exposureKey: 0.14, minExposure: 0.02, maxExposure: 4.2, exposureBias: 1,
      blockLightColor: new Color(1.0, 0.56, 0.26), blockLightIntensity: 7.0,
      emissiveStrength: 5.0, ambientBoost: 1.25, caveAmbient: 0.0035,
      waterFogColor: new Color(0.01, 0.045, 0.06),
    };

    // Uniforms shared by every material (terrain, water, entities...).
    this.shared = {
      ...this.atmosphere.uniforms,
      ...this.shadows.uniforms,
      uFrame: { value: 0 },
      uCameraPos: { value: new Vector3() },
      uResolution: { value: new Vector2(1, 1) },
      tSceneColor: { value: null },
      tSceneDepth: { value: null },
      uProjInv: { value: new Matrix4() },
      uCamRot: { value: this.camRot },
      uViewDistance: { value: 160 },
      uFogDensity: { value: this.params.fogDensity },
      uFogHeight: { value: this.params.fogHeight },
      uFogFalloff: { value: this.params.fogFalloff },
      uCameraSkyLight: { value: 1 },
      uUnderwater: { value: 0 },
      uWetness: { value: 0 },
      uBlockLightColor: { value: this.params.blockLightColor },
      uBlockLightIntensity: { value: this.params.blockLightIntensity },
      uFlicker: { value: 1 },
      uWaterSurfaceY: { value: 62 },
      uHeldLight: { value: 0 },
      tSky: { value: null },
      tWorldMask: { value: null },
      uWorldMaskBounds: { value: new Vector4(0, 0, 1, 1) },
      uWorldMaskEnabled: { value: 0 },
      uWorldMaskOutside: { value: 0.5 },
    };

    this._createPasses();
    const white = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
    this.shared.tWorldMask.value = white;
    this.shadowDepthMaterial = createDefaultShadowMaterial();
    setGBufferTimeUniform(this.shared.uTime);
  }

  _createPasses() {
    const S = this.shared;
    this.lightingPass = new FullscreenPass({
      fragmentShader: LIGHTING_FRAG,
      uniforms: {
        ...S,
        tAlbedo: { value: null }, tNormal: { value: null }, tLight: { value: null }, tDepthCopy: { value: null },
        tSSAO: { value: null },
        uSSAOEnabled: { value: 1 }, uCaveAmbient: { value: this.params.caveAmbient },
        uEmissiveStrength: { value: this.params.emissiveStrength }, uAmbientBoost: { value: 1 },
        uShadowTaps: { value: 12 },
      },
    });
    this.ssaoPass = new FullscreenPass({
      fragmentShader: SSAO_FRAG,
      uniforms: {
        tDepth: { value: null }, tNormal: { value: null }, uProj: { value: new Matrix4() }, uProjInv: S.uProjInv,
        uViewRot: { value: this.viewRot }, uFrame: S.uFrame, uRadius: { value: 0.9 }, uIntensity: { value: 1.1 },
      },
    });
    this.ssaoBlurPass = new FullscreenPass({
      fragmentShader: SSAO_BLUR_FRAG,
      uniforms: { tAO: { value: null }, tDepth: { value: null }, uProjInv: S.uProjInv, uTexel: { value: new Vector2() } },
    });
    this.copyPass = new FullscreenPass({
      fragmentShader: COPY_FRAG,
      uniforms: { tColor: { value: null } },
    });
    this.depthCopyPass = new FullscreenPass({
      fragmentShader: DEPTH_COPY_FRAG,
      uniforms: { tDepth: { value: null }, uProjInv: S.uProjInv },
    });
    this.volumetricPass = new FullscreenPass({
      fragmentShader: VOLUMETRIC_FRAG,
      uniforms: {
        ...S, tDepth: { value: null }, uSteps: { value: 16 }, uMaxDist: { value: 160 },
        uDensity: { value: this.params.volumetricDensity }, uRain: { value: 0 },
      },
    });
    this.taaPass = new FullscreenPass({
      fragmentShader: TAA_FRAG,
      uniforms: {
        tCurrent: { value: null }, tHistory: { value: null }, tDepth: { value: null }, tVolumetric: { value: null },
        uVolumetricEnabled: { value: 1 }, uProjInv: S.uProjInv, uCamRot: S.uCamRot,
        uPrevViewProj: { value: new Matrix4() }, uTexel: { value: new Vector2() }, uReset: { value: 1 },
        uFeedback: { value: 0.9 }, uUnderwater: S.uUnderwater, uWaterFogColor: { value: this.params.waterFogColor },
        uTaaEnabled: { value: 1 },
      },
    });
    this.bloomDownPass = new FullscreenPass({
      fragmentShader: BLOOM_DOWN_FRAG, uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() }, uFirst: { value: 0 } },
    });
    this.bloomUpPass = new FullscreenPass({
      fragmentShader: BLOOM_UP_FRAG,
      uniforms: { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new Vector2() }, uRadius: { value: 1 } },
    });
    this.lumPass = new FullscreenPass({ fragmentShader: LUMINANCE_FRAG, uniforms: { tSrc: { value: null } } });
    this.adaptPass = new FullscreenPass({
      fragmentShader: ADAPT_FRAG,
      uniforms: {
        tLum: { value: null }, tPrev: { value: null }, uDt: { value: 0.016 }, uKey: { value: this.params.exposureKey },
        uMinExposure: { value: this.params.minExposure }, uMaxExposure: { value: this.params.maxExposure },
        uSpeedUp: { value: 1.6 }, uSpeedDown: { value: 2.8 }, uReset: { value: 1 }, uLodMax: { value: 7 },
        uExposureBias: { value: 1 },
      },
    });
    this.finalPass = new FullscreenPass({
      fragmentShader: FINAL_FRAG,
      uniforms: {
        tColor: { value: null }, tBloom: { value: null }, tExposure: { value: null }, uSrcTexel: { value: new Vector2() },
        uBloomStrength: { value: this.params.bloomStrength }, uSharpen: { value: this.params.sharpen },
        uVignette: { value: this.params.vignette }, uSaturation: { value: this.params.saturation },
        uContrast: { value: this.params.contrast }, uUnderwater: S.uUnderwater, uTime: this.shared.uTime,
        uFrame: S.uFrame, uGrain: { value: this.params.grain }, uTonemap: { value: 0 }, uFade: { value: 1 },
        tOverlay: { value: null }, uOverlay: { value: 0 },
      },
    });

    this.lumRT = rt(128, 128, { type: HalfFloatType, format: RGFormat, minFilter: LinearMipmapLinearFilter, generateMipmaps: true });
    this.adaptRT = [
      rt(1, 1, { type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter }),
      rt(1, 1, { type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter }),
    ];
    this.adaptIndex = 0;
  }

  /** Canvas pixel size. Internal buffers use renderScale. */
  setSize(width, height) {
    this.canvasWidth = width;
    this.canvasHeight = height;
    const scale = this.settings.get('renderScale');
    const w = Math.max(16, Math.round(width * scale));
    const h = Math.max(16, Math.round(height * scale));
    if (w === this.width && h === this.height && this.gbuffer) return;
    this.width = w;
    this.height = h;
    this._disposeTargets();

    // G-buffer: albedo (RGBA8) / normal+rough+metal (RGBA16F) / light (RGBA8) + depth32F
    this.gbuffer = new WebGLRenderTarget(w, h, {
      count: 3, type: UnsignedByteType, minFilter: NearestFilter, magFilter: NearestFilter,
      depthBuffer: true, stencilBuffer: false,
    });
    this.gbuffer.textures[0].name = 'gAlbedo';
    this.gbuffer.textures[1].name = 'gNormal';
    this.gbuffer.textures[1].type = HalfFloatType;
    this.gbuffer.textures[2].name = 'gLight';
    const depthTex = new DepthTexture(w, h, FloatType);
    depthTex.minFilter = NearestFilter;
    depthTex.magFilter = NearestFilter;
    this.gbuffer.depthTexture = depthTex;

    this.hdrRT = rt(w, h, { minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true });
    this.hdrRT.depthTexture = depthTex;

    this.copyRT = rt(w, h);
    this.depthCopyRT = rt(w, h, { type: FloatType, format: RGFormat, minFilter: NearestFilter, magFilter: NearestFilter });

    const hw = Math.max(8, w >> 1), hh = Math.max(8, h >> 1);
    this.ssaoRT = rt(hw, hh, { type: UnsignedByteType, format: RedFormat });
    this.ssaoBlurRT = rt(hw, hh, { type: UnsignedByteType, format: RedFormat });
    this.volRT = rt(hw, hh);
    this.atmosphere.ensureSkyTarget(hw, hh);

    this.history = [rt(w, h), rt(w, h)];
    this.overlayRT = rt(w, h, { depthBuffer: true });
    this.overlayCamera.aspect = w / h;
    this.overlayCamera.updateProjectionMatrix();
    this.bloomDown = [];
    this.bloomUp = [];
    let bw = hw, bh = hh;
    for (let i = 0; i < 6; i++) {
      this.bloomDown.push(rt(bw, bh));
      this.bloomUp.push(rt(bw, bh));
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }

    this.shared.uResolution.value.set(w, h);
    this.shared.tSceneColor.value = this.copyRT.texture;
    this.shared.tSceneDepth.value = this.depthCopyRT.texture;
    const L = this.lightingPass.uniforms;
    L.tAlbedo.value = this.gbuffer.textures[0];
    L.tNormal.value = this.gbuffer.textures[1];
    L.tLight.value = this.gbuffer.textures[2];
    L.tDepthCopy.value = this.depthCopyRT.texture;
    L.tSSAO.value = this.ssaoBlurRT.texture;
    this.shared.tSky.value = this.atmosphere.skyRT.texture;
    this.ssaoPass.uniforms.tDepth.value = depthTex;
    this.ssaoPass.uniforms.tNormal.value = this.gbuffer.textures[1];
    this.ssaoBlurPass.uniforms.tAO.value = this.ssaoRT.texture;
    this.ssaoBlurPass.uniforms.tDepth.value = depthTex;
    this.ssaoBlurPass.uniforms.uTexel.value.set(1 / hw, 1 / hh);
    this.copyPass.uniforms.tColor.value = this.hdrRT.texture;
    this.depthCopyPass.uniforms.tDepth.value = depthTex;
    this.volumetricPass.uniforms.tDepth.value = depthTex;
    this.taaPass.uniforms.tCurrent.value = this.hdrRT.texture;
    this.taaPass.uniforms.tDepth.value = depthTex;
    this.taaPass.uniforms.tVolumetric.value = this.volRT.texture;
    this.taaPass.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.resetHistory = true;
  }

  _disposeTargets() {
    const list = [this.gbuffer, this.hdrRT, this.copyRT, this.depthCopyRT, this.ssaoRT, this.ssaoBlurRT, this.volRT, this.overlayRT,
      ...(this.history || []), ...(this.bloomDown || []), ...(this.bloomUp || [])];
    for (const t of list) t?.dispose();
    this.gbuffer?.depthTexture?.dispose();
  }

  applySettings() {
    const s = this.settings;
    const size = s.get('shadowMapSize'), casc = s.get('shadowCascades'), dist = s.get('shadowDistance');
    if (size !== this.shadows.tileSize || casc !== this.shadows.count || dist !== this.shadows.distance) {
      this.shadows.configure({ tileSize: size, cascades: casc, distance: dist });
      this.shared.tShadow.value = this.shadows.uniforms.tShadow.value;
    }
    this._applyCloudSettings();
    if (this.canvasWidth) {
      this.width = 0; // force realloc for new render scale
      this.setSize(this.canvasWidth, this.canvasHeight);
    }
    this.resetHistory = true;
  }

  _applyCloudSettings() {
    const c = this.settings.get('clouds');
    this.atmosphere.cloudSteps = c >= 2 ? 44 : c >= 1 ? 26 : 0;
    this.atmosphere.cloudsEnabled = c > 0;
  }

  /**
   * Enables a world-space visibility mask (fog of war) over a rectangle.
   * @param {import('three').Texture|null} texture R channel: 0 unexplored, .5 explored, 1 visible
   */
  setWorldMask(texture, minX, minZ, sizeX, sizeZ, outside = 0.5) {
    const S = this.shared;
    if (!texture) { S.uWorldMaskEnabled.value = 0; return; }
    S.tWorldMask.value = texture;
    S.uWorldMaskBounds.value.set(minX, minZ, sizeX, sizeZ);
    S.uWorldMaskOutside.value = outside;
    S.uWorldMaskEnabled.value = 1;
  }

  addShadowCaster(mesh, shadowMaterial) {
    mesh.layers.enable(1);
    if (!shadowMaterial && mesh.material && !Array.isArray(mesh.material) && mesh.material.getShadowMaterial) {
      shadowMaterial = mesh.material.getShadowMaterial();
    }
    if (shadowMaterial) mesh.userData.shadowMaterial = shadowMaterial;
    this.shadowCasters.add(mesh);
  }

  removeShadowCaster(mesh) {
    this.shadowCasters.delete(mesh);
  }

  /**
   * Renders one frame to the canvas.
   * @param {number} dt seconds
   */
  render(dt) {
    const r = this.renderer;
    const cam = this.camera;
    const s = this.settings;
    const P = this.params;
    this.frame++;
    this.time += dt;
    const S = this.shared;
    S.uFrame.value = this.frame;
    S.uCameraSkyLight.value += (this.cameraSkyLight - S.uCameraSkyLight.value) * Math.min(1, dt * 2);
    S.uUnderwater.value = this.underwater ? 1 : 0;
    S.uWaterSurfaceY.value = this.waterSurfaceY;
    S.uHeldLight.value += (this.heldLight - S.uHeldLight.value) * Math.min(1, dt * 8);
    S.uFlicker.value = 0.85 + 0.15 * (Math.sin(this.time * 11.3) * 0.5 + Math.sin(this.time * 23.7 + 1.3) * 0.3 + Math.sin(this.time * 5.1) * 0.2);
    S.uFogDensity.value = P.fogDensity * (1 + this.atmosphere.rain * 4);
    S.uFogHeight.value = P.fogHeight;
    S.uFogFalloff.value = P.fogFalloff;
    S.uBlockLightIntensity.value = P.blockLightIntensity;
    S.uViewDistance.value = this.farDistance || s.get('viewDistance') * 32;
    this.atmosphere.update(dt);

    // --- camera matrices ---------------------------------------------------
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    this.projNoJitter.copy(cam.projectionMatrix);
    const taa = s.get('taa');
    if (taa) {
      const j = HALTON[this.frame % 8];
      this.jitter.set(j[0], j[1]);
      cam.projectionMatrix.elements[8] += (j[0] * 2) / this.width;
      cam.projectionMatrix.elements[9] += (j[1] * 2) / this.height;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    }
    const camPos = cam.position;
    S.uCameraPos.value.copy(camPos);
    this.camRot.copy(cam.matrixWorld).setPosition(0, 0, 0);
    this.viewRot.copy(this.camRot).invert();
    S.uProjInv.value.copy(cam.projectionMatrixInverse);

    this.scene.updateMatrixWorld();
    this.forwardScene.updateMatrixWorld();

    r.autoClear = false;
    r.info.autoReset = false;
    r.info.reset();

    // --- shadows -------------------------------------------------------------
    this.shadows.update(cam, this.atmosphere.lightDir);
    this.shadows.render(r, this.scene, this.shadowCasters, this.shadowDepthMaterial, camPos);

    // --- atmosphere / sky -----------------------------------------------------
    const invVPRot = this._invVPRot.multiplyMatrices(cam.projectionMatrix, this.viewRot).invert();
    this.atmosphere.render(r, invVPRot, camPos, this.frame);

    // --- G-buffer ---------------------------------------------------------------
    r.setRenderTarget(this.gbuffer);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.scene, cam);

    this.depthCopyPass.render(r, this.depthCopyRT);

    // --- SSAO ----------------------------------------------------------------------
    const ssao = s.get('ssao');
    this.lightingPass.uniforms.uSSAOEnabled.value = ssao ? 1 : 0;
    if (ssao) {
      this.ssaoPass.uniforms.uProj.value.copy(cam.projectionMatrix);
      this.ssaoPass.render(r, this.ssaoRT);
      this.ssaoBlurPass.render(r, this.ssaoBlurRT);
    }

    // --- lighting --------------------------------------------------------------------
    const L = this.lightingPass.uniforms;
    L.uCaveAmbient.value = P.caveAmbient;
    L.uEmissiveStrength.value = P.emissiveStrength;
    L.uAmbientBoost.value = P.ambientBoost;
    L.uShadowTaps.value = s.get('shadowMapSize') >= 2048 ? 12 : 8;
    S.uWetness.value = this.atmosphere.rain;
    this.lightingPass.render(r, this.hdrRT);

    // --- copy for refraction, then forward objects -------------------------------------
    this.copyPass.render(r, this.copyRT);
    r.setRenderTarget(this.hdrRT);
    r.render(this.forwardScene, cam);

    // --- volumetric light ----------------------------------------------------------------
    const vol = s.get('volumetrics');
    if (vol) {
      const V = this.volumetricPass.uniforms;
      V.uSteps.value = this.underwater ? Math.min(24, s.get('volumetricSteps')) : s.get('volumetricSteps');
      V.uMaxDist.value = Math.min(s.get('shadowDistance'), 200);
      V.uDensity.value = P.volumetricDensity;
      V.uRain.value = this.atmosphere.rain;
      this.volumetricPass.render(r, this.volRT);
    }

    // --- TAA resolve (+ volumetric composite + underwater fog) ---------------------------
    const T = this.taaPass.uniforms;
    const prev = this.history[this.historyIndex];
    const next = this.history[1 - this.historyIndex];
    T.tHistory.value = prev.texture;
    T.uVolumetricEnabled.value = vol ? 1 : 0;
    T.uReset.value = this.resetHistory ? 1 : 0;
    T.uTaaEnabled.value = taa ? 1 : 0;
    // previous view-projection expressed relative to the current camera position
    const dx = camPos.x - this.prevCamPos.x, dy = camPos.y - this.prevCamPos.y, dz = camPos.z - this.prevCamPos.z;
    T.uPrevViewProj.value.copy(this.prevViewProj).multiply(this._tmpM4.makeTranslation(dx, dy, dz));
    this.taaPass.render(r, next);
    this.historyIndex = 1 - this.historyIndex;
    this.resetHistory = false;
    // store the (unjittered) camera-relative view-projection for next frame
    this.prevViewProj.multiplyMatrices(this.projNoJitter, this.viewRot);
    this.prevCamPos.copy(camPos);
    const resolved = next;

    // --- first-person overlay ---------------------------------------------------------------
    const hasOverlay = this.overlayScene.children.some((c) => c.visible);
    if (hasOverlay) {
      this.overlayScene.updateMatrixWorld();
      r.setRenderTarget(this.overlayRT);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(this.overlayScene, this.overlayCamera);
    }

    // --- bloom ---------------------------------------------------------------------------------
    let src = resolved.texture, sw = this.width, sh = this.height;
    for (let i = 0; i < this.bloomDown.length; i++) {
      const bd = this.bloomDownPass.uniforms;
      bd.tSrc.value = src;
      bd.uTexel.value.set(1 / sw, 1 / sh);
      bd.uFirst.value = i === 0 ? 1 : 0;
      this.bloomDownPass.render(r, this.bloomDown[i]);
      src = this.bloomDown[i].texture;
      sw = this.bloomDown[i].width; sh = this.bloomDown[i].height;
    }
    let up = this.bloomDown[this.bloomDown.length - 1];
    for (let i = this.bloomDown.length - 2; i >= 0; i--) {
      const bu = this.bloomUpPass.uniforms;
      bu.tSrc.value = up.texture;
      bu.tBase.value = this.bloomDown[i].texture;
      bu.uTexel.value.set(1 / up.width, 1 / up.height);
      this.bloomUpPass.render(r, this.bloomUp[i]);
      up = this.bloomUp[i];
    }

    // --- auto exposure ---------------------------------------------------------------------------
    this.lumPass.uniforms.tSrc.value = this.bloomDown[1].texture;
    this.lumPass.render(r, this.lumRT);
    const A = this.adaptPass.uniforms;
    A.tLum.value = this.lumRT.texture;
    A.tPrev.value = this.adaptRT[this.adaptIndex].texture;
    A.uDt.value = Math.min(dt, 0.1);
    A.uKey.value = P.exposureKey;
    A.uMinExposure.value = P.minExposure;
    A.uMaxExposure.value = P.maxExposure;
    A.uExposureBias.value = P.exposureBias;
    this.adaptPass.render(r, this.adaptRT[1 - this.adaptIndex]);
    A.uReset.value = 0;
    this.adaptIndex = 1 - this.adaptIndex;

    // --- final ---------------------------------------------------------------------------------------
    const F = this.finalPass.uniforms;
    F.tColor.value = resolved.texture;
    F.tBloom.value = this.bloomUp[0].texture;
    F.tExposure.value = this.adaptRT[this.adaptIndex].texture;
    F.uSrcTexel.value.set(1 / this.width, 1 / this.height);
    F.uBloomStrength.value = P.bloomStrength * (s.get('bloom') ? 1 : 0);
    F.uSharpen.value = P.sharpen;
    F.uVignette.value = P.vignette;
    F.uSaturation.value = P.saturation;
    F.uContrast.value = P.contrast;
    F.uGrain.value = P.grain;
    F.uTonemap.value = P.tonemap;
    F.tOverlay.value = this.overlayRT.texture;
    F.uOverlay.value = hasOverlay ? 1 : 0;
    this.finalPass.render(r, null);

    // restore the unjittered projection for gameplay code (raycasts, culling)
    cam.projectionMatrix.copy(this.projNoJitter);
    cam.projectionMatrixInverse.copy(this.projNoJitter).invert();

    this.stats.drawCalls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;
  }

  dispose() {
    this._disposeTargets();
    this.atmosphere.dispose();
    this.shadows.dispose();
  }
}
