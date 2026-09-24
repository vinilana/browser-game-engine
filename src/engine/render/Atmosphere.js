import {
  WebGLRenderTarget, HalfFloatType, LinearFilter, ClampToEdgeWrapping, RepeatWrapping, Vector3, Vector2,
  Data3DTexture, RGBAFormat, UnsignedByteType, LinearMipmapLinearFilter, NearestFilter, Matrix4,
} from 'three';
import { FullscreenPass } from './FullscreenPass.js';
import { TRANSMITTANCE_FRAG, MULTISCATTER_FRAG, SKYVIEW_FRAG } from './shaders/atmosphere.js';
import { SKY_FRAG, SH_FRAG } from './shaders/sky.js';

function lutTarget(w, h, wrapS = ClampToEdgeWrapping) {
  const rt = new WebGLRenderTarget(w, h, {
    type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  rt.texture.wrapS = wrapS;
  rt.texture.wrapT = ClampToEdgeWrapping;
  return rt;
}

/**
 * Sky, sun/moon, clouds and time of day. Owns the atmosphere LUTs, the sky
 * render target, the environment map and its SH irradiance projection.
 */
export class Atmosphere {
  constructor() {
    this.timeOfDay = 0.32;          // 0 = midnight, 0.25 = sunrise, 0.5 = noon
    this.dayLength = 1200;          // seconds per full day
    this.timeScale = 1;
    this.paused = false;
    this.sunTilt = 0.42;
    this.sunIntensity = 20;
    this.moonIntensity = 0.24;
    this.cloudCoverage = 0.5;
    this.cloudDensity = 0.04;
    this.wind = new Vector2(9, 3.5);
    this.rain = 0;                  // 0..1 (weather)
    this.cloudsEnabled = true;
    this.haze = 1;

    this.sunDir = new Vector3();
    this.moonDir = new Vector3();
    this.lightDir = new Vector3();
    this.lightIsMoon = false;

    this.transmittanceRT = lutTarget(256, 64);
    this.multiScatterRT = lutTarget(32, 32);
    this.skyViewRT = lutTarget(192, 108, RepeatWrapping);
    this.envRT = new WebGLRenderTarget(128, 64, {
      type: HalfFloatType, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
      depthBuffer: false, generateMipmaps: true,
    });
    this.envRT.texture.wrapS = RepeatWrapping;
    this.shRT = new WebGLRenderTarget(9, 1, {
      type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false,
    });
    this.skyRT = null;

    // Placeholder cloud noise until the worker delivers the real volume.
    const tiny = new Data3DTexture(new Uint8Array(4 * 8).fill(0), 2, 2, 2);
    tiny.needsUpdate = true;
    this.cloudNoise = tiny;

    this.uniforms = {
      tTransmittance: { value: this.transmittanceRT.texture },
      tMultiScatter: { value: this.multiScatterRT.texture },
      tSkyView: { value: this.skyViewRT.texture },
      tEnv: { value: this.envRT.texture },
      tSH: { value: this.shRT.texture },
      tCloudNoise: { value: tiny },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uLightDir: { value: this.lightDir },
      uSunIntensity: { value: this.sunIntensity },
      uMoonIntensity: { value: this.moonIntensity },
      uLightIsMoon: { value: 0 },
      uCloudCoverage: { value: this.cloudCoverage },
      uCloudDensity: { value: this.cloudDensity },
      uCloudWind: { value: new Vector2() },
      uTime: { value: 0 },
      uHaze: { value: 1 },
    };

    this.transmittancePass = new FullscreenPass({ fragmentShader: TRANSMITTANCE_FRAG });
    this.multiScatterPass = new FullscreenPass({
      fragmentShader: MULTISCATTER_FRAG,
      uniforms: { tTransmittance: this.uniforms.tTransmittance },
    });
    this.skyViewPass = new FullscreenPass({
      fragmentShader: SKYVIEW_FRAG,
      uniforms: {
        tTransmittance: this.uniforms.tTransmittance,
        tMultiScatter: this.uniforms.tMultiScatter,
        uSunDir: this.uniforms.uSunDir,
        uSunIntensity: this.uniforms.uSunIntensity,
        uMoonIntensity: this.uniforms.uMoonIntensity,
        uHaze: this.uniforms.uHaze,
      },
    });
    const skyUniforms = {
      ...this.uniforms,
      uInvViewProj: { value: new Matrix4() },
      uCameraPos: { value: new Vector3() },
      uFrame: { value: 0 },
      uMode: { value: 0 },
      uSteps: { value: 40 },
      uResolution: { value: new Vector2() },
    };
    this.skyPass = new FullscreenPass({ fragmentShader: SKY_FRAG, uniforms: skyUniforms });
    this.envPass = new FullscreenPass({
      fragmentShader: SKY_FRAG,
      uniforms: { ...skyUniforms, uMode: { value: 1 }, uSteps: { value: 20 }, uFrame: { value: 0 } },
    });
    this.shPass = new FullscreenPass({ fragmentShader: SH_FRAG, uniforms: { tEnv: this.uniforms.tEnv } });
    this.staticReady = false;
    this.cloudSteps = 40;
    this._loadCloudNoise();
  }

  _loadCloudNoise() {
    try {
      const w = new Worker(new URL('./cloudNoise.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const { size, data } = e.data;
        const tex = new Data3DTexture(data, size, size, size);
        tex.format = RGBAFormat;
        tex.type = UnsignedByteType;
        tex.minFilter = LinearFilter;
        tex.magFilter = LinearFilter;
        tex.wrapS = tex.wrapT = tex.wrapR = RepeatWrapping;
        tex.unpackAlignment = 1;
        tex.needsUpdate = true;
        this.cloudNoise = tex;
        this.uniforms.tCloudNoise.value = tex;
        w.terminate();
        this.onCloudsReady?.();
      };
      w.postMessage({ size: 64 });
    } catch (err) {
      console.warn('Cloud noise worker failed', err);
    }
  }

  /** Hours in [0, 24). */
  get hours() { return (this.timeOfDay * 24) % 24; }
  set hours(h) { this.timeOfDay = (((h / 24) % 1) + 1) % 1; }

  update(dt) {
    if (!this.paused) this.timeOfDay = (this.timeOfDay + (dt * this.timeScale) / this.dayLength) % 1;
    const a = (this.timeOfDay - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(a), Math.sin(a) * Math.cos(this.sunTilt), Math.sin(a) * Math.sin(this.sunTilt)).normalize();
    this.moonDir.copy(this.sunDir).negate();
    this.lightIsMoon = this.sunDir.y < -0.035;
    this.lightDir.copy(this.lightIsMoon ? this.moonDir : this.sunDir);
    // keep shadows from going fully horizontal
    if (this.lightDir.y < 0.06) {
      this.lightDir.y = 0.06;
      this.lightDir.normalize();
    }

    const u = this.uniforms;
    u.uTime.value += dt;
    u.uCloudWind.value.addScaledVector(this.wind, dt);
    const rain = this.rain;
    u.uCloudCoverage.value = this.cloudsEnabled ? this.cloudCoverage + (0.92 - this.cloudCoverage) * rain : 0;
    u.uCloudDensity.value = this.cloudDensity * (1 + rain * 1.5);
    u.uHaze.value = this.haze * (1 + rain * 5);
    u.uSunIntensity.value = this.sunIntensity * (1 - rain * 0.55);
    u.uMoonIntensity.value = this.moonIntensity * (1 - rain * 0.6);
    u.uLightIsMoon.value = this.lightIsMoon ? 1 : 0;
  }

  /** 0 at night, 1 at day (smooth). */
  get daylight() {
    return Math.min(1, Math.max(0, (this.sunDir.y + 0.08) / 0.25));
  }

  ensureSkyTarget(width, height) {
    if (this.skyRT && this.skyRT.width === width && this.skyRT.height === height) return;
    this.skyRT?.dispose();
    this.skyRT = new WebGLRenderTarget(width, height, {
      type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false,
    });
  }

  /**
   * @param {import('three').WebGLRenderer} renderer
   * @param {Matrix4} invViewProjRot inverse of (projection * view rotation)
   * @param {Vector3} cameraPos
   * @param {number} frame
   */
  render(renderer, invViewProjRot, cameraPos, frame) {
    if (!this.staticReady) {
      this.transmittancePass.render(renderer, this.transmittanceRT);
      this.multiScatterPass.render(renderer, this.multiScatterRT);
      this.staticReady = true;
    }
    this.skyViewPass.render(renderer, this.skyViewRT);

    const su = this.skyPass.uniforms;
    su.uInvViewProj.value.copy(invViewProjRot);
    su.uCameraPos.value.copy(cameraPos);
    su.uFrame.value = frame;
    su.uSteps.value = this.cloudSteps;
    su.uResolution.value.set(this.skyRT.width, this.skyRT.height);
    this.skyPass.render(renderer, this.skyRT);

    const eu = this.envPass.uniforms;
    eu.uFrame.value = frame;
    this.envPass.render(renderer, this.envRT);
    this.shPass.render(renderer, this.shRT);
  }

  dispose() {
    for (const rt of [this.transmittanceRT, this.multiScatterRT, this.skyViewRT, this.envRT, this.shRT, this.skyRT]) rt?.dispose();
  }
}
