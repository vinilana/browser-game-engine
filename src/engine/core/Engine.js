import { WebGLRenderer, PerspectiveCamera, NoToneMapping, LinearSRGBColorSpace } from 'three';
import { EventEmitter } from './EventEmitter.js';
import { Input } from './Input.js';
import { Settings } from './Settings.js';
import { RenderPipeline } from '../render/RenderPipeline.js';

/**
 * Aether Engine core: owns the WebGL2 renderer, the deferred render pipeline,
 * input, settings and the main loop. Game code registers systems with
 * `engine.addSystem({ update(dt, engine) {...} })`.
 */
export class Engine extends EventEmitter {
  /**
   * @param {{ canvas: HTMLCanvasElement, settings?: Settings, maxPixelRatio?: number }} opts
   */
  constructor(opts) {
    super();
    this.canvas = opts.canvas;
    this.settings = opts.settings || new Settings();
    this.maxPixelRatio = opts.maxPixelRatio ?? 1.5;
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    const gl = this.renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext)) throw new Error('WebGL2 é necessário.');
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) {
      throw new Error('EXT_color_buffer_float não suportado pela GPU/navegador.');
    }
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.sortObjects = true;

    this.camera = new PerspectiveCamera(this.settings.get('fov'), 1, 0.08, 4000);
    this.camera.rotation.order = 'YXZ';
    this.pipeline = new RenderPipeline(this.renderer, this.camera, this.settings);
    this.input = new Input(this.canvas);
    this.systems = [];
    this.running = false;
    this.time = 0;
    this.frame = 0;
    this.fps = 0;
    this.frameTime = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._last = 0;
    this.timeScale = 1;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this.settings.onChange((k) => {
      if (k === 'fov') this.camera.fov = this.settings.get('fov');
      if (k === '*' || ['renderScale', 'shadowMapSize', 'shadowCascades', 'shadowDistance', 'clouds'].includes(k)) {
        this.pipeline.applySettings();
      }
      this.input.sensitivity = 0.0022 * this.settings.get('sensitivity');
    });
    this.input.sensitivity = 0.0022 * this.settings.get('sensitivity');
  }

  get scene() { return this.pipeline.scene; }
  get forwardScene() { return this.pipeline.forwardScene; }
  get atmosphere() { return this.pipeline.atmosphere; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(w, h);
    this.emit('resize', w, h);
  }

  addSystem(system) {
    this.systems.push(system);
    system.init?.(this);
    return system;
  }

  removeSystem(system) {
    const i = this.systems.indexOf(system);
    if (i >= 0) this.systems.splice(i, 1);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this.tick(now);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  tick(now = performance.now()) {
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    this.frameTime = dt;
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    const sdt = dt * this.timeScale;
    this.time += sdt;
    this.frame++;
    this.emit('preUpdate', sdt);
    for (const s of this.systems) s.update?.(sdt, this);
    this.emit('update', sdt);
    this.pipeline.render(dt);
    this.emit('postRender', dt);
    this.input.endFrame();
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.pipeline.dispose();
    this.renderer.dispose();
  }
}
