import {
  OrthographicCamera, WebGLRenderTarget, DepthTexture, FloatType, LessEqualCompare, LinearFilter,
  RedFormat, UnsignedByteType, Matrix4, Vector3, Vector4, NearestFilter,
} from 'three';

const _bias = new Matrix4().set(
  0.5, 0, 0, 0.5,
  0, 0.5, 0, 0.5,
  0, 0, 0.5, 0.5,
  0, 0, 0, 1,
);
const _tmpM = new Matrix4();
const _tmpM2 = new Matrix4();
const _fwd = new Vector3();
const _center = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _worldUp = new Vector3();

/**
 * Stable cascaded shadow maps packed into a single depth atlas (2x2 tiles).
 * Each cascade uses a bounding sphere of its frustum slice (rotation invariant)
 * and snaps its center to the texel grid to avoid shimmering.
 */
export class ShadowCascades {
  constructor(options = {}) {
    this.uniforms = {
      tShadow: { value: null },
      uShadowMatrix: { value: [new Matrix4(), new Matrix4(), new Matrix4(), new Matrix4()] },
      uShadowTile: { value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()] },
      uShadowSplits: { value: new Vector4() },
      uShadowTexel: { value: new Vector4() },
      uShadowDepthBias: { value: new Vector4() },
      uShadowCascades: { value: 4 },
      uShadowAtlasTexel: { value: 1 / 4096 },
      uShadowSoftness: { value: 0.06 },
    };
    this.extraDepth = 160;
    this.start = 0;          // distance where the first cascade begins (RTS cameras look from far)
    this.pv = [new Matrix4(), new Matrix4(), new Matrix4(), new Matrix4()];
    this.lambda = 0.78;
    this.frame = 0;
    this.configure(options);
  }

  configure({ tileSize = 2048, cascades = 4, distance = 180 } = {}) {
    this.dispose();
    this.tileSize = tileSize;
    this.count = Math.max(1, Math.min(4, cascades));
    this.distance = distance;
    this.tilesX = this.count > 1 ? 2 : 1;
    this.tilesY = this.count > 2 ? 2 : 1;
    const w = tileSize * this.tilesX, h = tileSize * this.tilesY;
    this.rt = new WebGLRenderTarget(w, h, {
      format: RedFormat, type: UnsignedByteType, depthBuffer: true, stencilBuffer: false,
      minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false,
    });
    const dt = new DepthTexture(w, h, FloatType);
    dt.compareFunction = LessEqualCompare;
    dt.minFilter = LinearFilter;
    dt.magFilter = LinearFilter;
    this.rt.depthTexture = dt;
    this.rt.scissorTest = true;
    this.cameras = [];
    this.splits = [];
    for (let i = 0; i < this.count; i++) {
      const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
      cam.layers.set(1);
      cam.matrixAutoUpdate = true;
      this.cameras.push(cam);
      const tx = i % this.tilesX, ty = Math.floor(i / this.tilesX);
      this.uniforms.uShadowTile.value[i].set(1 / this.tilesX, 1 / this.tilesY, tx / this.tilesX, ty / this.tilesY);
    }
    this.uniforms.tShadow.value = dt;
    this.uniforms.uShadowCascades.value = this.count;
    this.uniforms.uShadowAtlasTexel.value = 1 / w;
    this.dirty = true;
  }

  /**
   * @param {import('three').PerspectiveCamera} camera
   * @param {Vector3} lightDir  direction TOWARD the light
   */
  update(camera, lightDir) {
    const n = this.count;
    const near = Math.max(camera.near, 0.05, this.start);
    const far = this.distance;
    const tv = Math.tan((camera.fov * Math.PI) / 360);
    const th = tv * camera.aspect;
    const s = th * th + tv * tv;
    camera.getWorldDirection(_fwd);
    const camPos = camera.position;

    _worldUp.set(0, 1, 0);
    if (Math.abs(lightDir.y) > 0.995) _worldUp.set(0, 0, 1);
    // basis identical to Object3D.lookAt for a camera looking along -lightDir... we look along lightDir reversed:
    // camera -Z points toward the scene (i.e. along -lightDir), so camera +Z = lightDir.
    _right.crossVectors(_worldUp, lightDir).normalize();
    _up.crossVectors(lightDir, _right).normalize();

    let prevSplit = near;
    for (let i = 0; i < n; i++) {
      const p = (i + 1) / n;
      const logS = near * Math.pow(far / near, p);
      const uniS = near + (far - near) * p;
      const split = i === n - 1 ? far : this.lambda * logS + (1 - this.lambda) * uniS;
      const sn = i === 0 ? this.start : prevSplit;
      const sf = split;
      this.splits[i] = sf;
      // bounding sphere of the slice [sn, sf]
      let zc = ((sf + sn) * (1 + s)) / 2;
      let radius;
      if (zc >= sf) { zc = sf; radius = sf * Math.sqrt(s); }
      else radius = Math.sqrt((sf - zc) * (sf - zc) + sf * sf * s);
      radius = Math.ceil(radius * 8) / 8 + 0.5;
      _center.copy(camPos).addScaledVector(_fwd, zc);

      const texel = (2 * radius) / this.tileSize;
      // snap the center to the texel grid in light space
      const cx = Math.round(_center.dot(_right) / texel) * texel;
      const cy = Math.round(_center.dot(_up) / texel) * texel;
      const cz = _center.dot(lightDir);
      _center.set(0, 0, 0).addScaledVector(_right, cx).addScaledVector(_up, cy).addScaledVector(lightDir, cz);

      const cam = this.cameras[i];
      const back = radius + this.extraDepth;
      cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
      cam.near = 0; cam.far = back + radius;
      cam.position.copy(_center).addScaledVector(lightDir, back);
      cam.up.copy(_worldUp);
      cam.lookAt(_center);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);

      cam.userData.texel = texel;
      prevSplit = sf;
    }
    for (let i = n; i < 4; i++) this.uniforms.uShadowSplits.value.setComponent(i, 0);
    for (let i = 0; i < n; i++) this.uniforms.uShadowSplits.value.setComponent(i, this.splits[i]);
  }

  /**
   * Renders every cascade. Far cascades are refreshed less often.
   * @param {import('three').WebGLRenderer} renderer
   * @param {import('three').Scene} scene
   * @param {Set<import('three').Mesh>} casters
   * @param {import('three').Material} defaultMaterial
   * @param {Vector3} camPos current camera world position
   */
  render(renderer, scene, casters, defaultMaterial, camPos) {
    this.frame++;
    for (const m of casters) {
      m.userData.mainMaterial = m.material;
      m.material = m.userData.shadowMaterial || defaultMaterial;
    }
    const sortWas = renderer.sortObjects;
    renderer.sortObjects = false; // depth-only: ordering doesn't matter, skip the sort
    const ts = this.tileSize;
    for (let i = 0; i < this.count; i++) {
      // far cascades are refreshed less often (they are texel-snapped, so stable):
      // cascade 2 every 2nd frame, cascade 3 every 3rd frame (staggered)
      if (!this.dirty && ((i === 2 && (this.frame & 1)) || (i === 3 && this.frame % 3 !== 1))) continue;
      const tx = i % this.tilesX, ty = Math.floor(i / this.tilesX);
      this.rt.viewport.set(tx * ts, ty * ts, ts, ts);
      this.rt.scissor.set(tx * ts, ty * ts, ts, ts);
      renderer.setRenderTarget(this.rt);
      renderer.clear(false, true, false);
      const cam = this.cameras[i];
      renderer.render(scene, cam);
      this.pv[i].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this.uniforms.uShadowTexel.value.setComponent(i, cam.userData.texel);
      this.uniforms.uShadowDepthBias.value.setComponent(i, (cam.userData.texel * 0.6) / (cam.far - cam.near));
    }
    this.dirty = false;
    renderer.sortObjects = sortWas;
    // camera-relative world position -> [0,1]^3 of each cascade
    _tmpM2.makeTranslation(camPos.x, camPos.y, camPos.z);
    for (let i = 0; i < this.count; i++) {
      this.uniforms.uShadowMatrix.value[i].multiplyMatrices(_bias, this.pv[i]).multiply(_tmpM2);
    }
    for (const m of casters) m.material = m.userData.mainMaterial;
    this.rt.viewport.set(0, 0, this.rt.width, this.rt.height);
    this.rt.scissor.set(0, 0, this.rt.width, this.rt.height);
  }

  dispose() {
    if (this.rt) {
      this.rt.depthTexture?.dispose();
      this.rt.dispose();
      this.rt = null;
    }
  }
}
