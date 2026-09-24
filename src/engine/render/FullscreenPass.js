import {
  BufferGeometry, Float32BufferAttribute, Mesh, OrthographicCamera, ShaderMaterial, GLSL3,
} from 'three';
import { FULLSCREEN_VERT } from './shaders/common.js';

const _camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
let _geometry = null;

function fullscreenGeometry() {
  if (_geometry) return _geometry;
  _geometry = new BufferGeometry();
  _geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  _geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return _geometry;
}

/**
 * A single-triangle fullscreen pass driven by a GLSL3 fragment shader.
 * The fragment shader must declare its own outputs (layout(location = N) out vec4 ...).
 */
export class FullscreenPass {
  constructor({ fragmentShader, uniforms = {}, defines = {}, blending, transparent = false }) {
    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader,
      uniforms,
      defines,
      depthTest: false,
      depthWrite: false,
      transparent,
    });
    if (blending !== undefined) this.material.blending = blending;
    this.mesh = new Mesh(fullscreenGeometry(), this.material);
    this.mesh.frustumCulled = false;
  }

  get uniforms() { return this.material.uniforms; }

  /**
   * Renders into `target` (null = canvas). Uses the target's own viewport/scissor.
   * @param {import('three').WebGLRenderer} renderer
   * @param {import('three').WebGLRenderTarget|null} target
   */
  render(renderer, target) {
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, _camera);
  }

  dispose() {
    this.material.dispose();
  }
}
