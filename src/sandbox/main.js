// Minimal Aether Engine example: a non-voxel open-world scene using the same
// deferred pipeline (physical sky, volumetric clouds, CSM shadows, SSAO, TAA...).
import { PlaneGeometry, SphereGeometry, BoxGeometry, CylinderGeometry, ConeGeometry, Mesh, Color, Vector3, BufferAttribute } from 'three';
import { Engine } from '../engine/core/Engine.js';
import { GBufferMaterial } from '../engine/render/materials/GBufferMaterial.js';
import { Simplex } from '../engine/math/noise.js';
import { mulberry32 } from '../engine/math/rng.js';

const engine = new Engine({ canvas: document.getElementById('c') });
const { pipeline, camera, input } = engine;
engine.atmosphere.hours = 16.5;
pipeline.farDistance = 900;
// fog is authored relative to a "sea level": this terrain sits around y = 0
pipeline.params.fogHeight = -5;
pipeline.params.fogDensity = 0.0012;

// --- terrain ---------------------------------------------------------------
const noise = new Simplex(7);
const height = (x, z) => noise.fbm2(x * 0.004, z * 0.004, 5) * 38 + noise.ridged2(x * 0.0015, z * 0.0015, 3) * 60 - 20;
const size = 1600, seg = 320;
const geo = new PlaneGeometry(size, size, seg, seg);
geo.rotateX(-Math.PI / 2);
const pos = geo.attributes.position;
const colors = new Float32Array(pos.count * 3);
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i), z = pos.getZ(i);
  pos.setY(i, height(x, z));
}
geo.computeVertexNormals();
const nrm = geo.attributes.normal;
for (let i = 0; i < pos.count; i++) {
  const slope = 1 - nrm.getY(i);
  const y = pos.getY(i);
  const grass = new Color(0.09, 0.16, 0.04), rock = new Color(0.22, 0.21, 0.2), snow = new Color(0.85, 0.87, 0.9), sand = new Color(0.55, 0.48, 0.33);
  let c = grass.clone().lerp(rock, Math.min(1, Math.max(0, (slope - 0.12) * 5)));
  if (y > 45) c.lerp(snow, Math.min(1, (y - 45) / 10) * (1 - slope * 2));
  if (y < 2) c.lerp(sand, Math.min(1, (2 - y) / 3));
  colors.set([c.r, c.g, c.b], i * 3);
}
geo.setAttribute('color', new BufferAttribute(colors, 3));
const terrain = new Mesh(geo, new GBufferMaterial({ vertexColors: true, roughness: 0.9 }));
pipeline.scene.add(terrain);
pipeline.addShadowCaster(terrain);

// --- material showcase -----------------------------------------------------
const spawn = new Vector3(0, height(0, 0) + 2, 0);
const mats = [
  new GBufferMaterial({ color: new Color(1.0, 0.77, 0.34), metalness: 1, roughness: 0.2 }),
  new GBufferMaterial({ color: new Color(0.95, 0.95, 0.95), metalness: 1, roughness: 0.05 }),
  new GBufferMaterial({ color: new Color(0.6, 0.05, 0.04), roughness: 0.35 }),
  new GBufferMaterial({ color: new Color(0.04, 0.2, 0.6), roughness: 0.6 }),
  new GBufferMaterial({ color: new Color(1.0, 0.6, 0.2), emissive: 4, roughness: 0.5 }),
];
mats.forEach((m, i) => {
  const s = new Mesh(new SphereGeometry(1.2, 48, 32), m);
  const x = (i - 2) * 3.2, z = -12;
  s.position.set(x, Math.max(height(x - 1, z), height(x + 1, z), height(x, z)) + 1.3, z);
  pipeline.scene.add(s);
  pipeline.addShadowCaster(s);
});

// --- forest of low-poly trees ----------------------------------------------
const rnd = mulberry32(3);
const trunkMat = new GBufferMaterial({ color: new Color(0.1, 0.06, 0.035), roughness: 0.95 });
const leafMat = new GBufferMaterial({ color: new Color(0.03, 0.09, 0.025), roughness: 0.8 });
const trunkGeo = new CylinderGeometry(0.25, 0.35, 4, 7);
const coneGeo = new ConeGeometry(2.2, 6, 9);
for (let i = 0; i < 900; i++) {
  const x = (rnd() - 0.5) * 900, z = (rnd() - 0.5) * 900;
  const y = height(x, z);
  if (y < 3 || y > 40 || Math.hypot(x, z) < 20) continue;
  const s = 0.7 + rnd() * 0.8;
  const t = new Mesh(trunkGeo, trunkMat);
  t.position.set(x, y + 2 * s, z);
  t.scale.setScalar(s);
  const c = new Mesh(coneGeo, leafMat);
  c.position.set(x, y + 6 * s, z);
  c.scale.setScalar(s);
  pipeline.scene.add(t, c);
  pipeline.addShadowCaster(t);
  pipeline.addShadowCaster(c);
}
// a stone "monolith"
const mono = new Mesh(new BoxGeometry(2, 9, 1), new GBufferMaterial({ color: new Color(0.12, 0.12, 0.13), roughness: 0.4 }));
mono.position.set(8, height(8, -4) + 4.4, -4);
mono.rotation.y = 0.4;
pipeline.scene.add(mono);
pipeline.addShadowCaster(mono);

// --- free camera -------------------------------------------------------------
camera.position.copy(spawn).add(new Vector3(-9, 4, 6));
let yaw = -0.55, pitch = -0.2;
engine.canvas.addEventListener('click', () => input.lock());
const v = new Vector3();
engine.addSystem({
  update(dt) {
    if (input.locked) {
      yaw -= input.mouseDX * input.sensitivity;
      pitch = Math.max(-1.5, Math.min(1.5, pitch - input.mouseDY * input.sensitivity));
    }
    const sp = (input.isDown('ControlLeft') ? 60 : 15) * dt;
    const f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const r = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const u = (input.isDown('Space') ? 1 : 0) - (input.isDown('ShiftLeft') ? 1 : 0);
    v.set(-Math.sin(yaw) * f + Math.cos(yaw) * r, u, -Math.cos(yaw) * f - Math.sin(yaw) * r).multiplyScalar(sp);
    camera.position.add(v);
    camera.position.y = Math.max(camera.position.y, height(camera.position.x, camera.position.z) + 1.7);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    for (const [k, h] of [['Digit1', 7], ['Digit2', 12], ['Digit3', 18.2], ['Digit4', 23]]) if (input.wasPressed(k)) engine.atmosphere.hours = h;
    if (input.wasPressed('KeyR')) engine.atmosphere.rain = engine.atmosphere.rain > 0 ? 0 : 0.8;
    pipeline.cameraSkyLight = 1;
  },
});
engine.start();
window.engine = engine;
window.worldReady = true;
