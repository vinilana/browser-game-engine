// Procedural, GPU-animated characters. Every model is one geometry whose
// vertices carry a body-part id; a vertex shader poses the parts (walk, chop,
// mine, build, fight, shoot, die...) per instance, so all units of a type are
// drawn with a single instanced draw call.
import {
  InstancedMesh, InstancedBufferAttribute, ShaderMaterial, GLSL3, Vector3, DynamicDrawUsage, Matrix4, Sphere,
} from 'three';
import { MeshBuilder } from '../../engine/geometry/MeshBuilder.js';
import { COMMON } from '../../engine/render/shaders/common.js';

export const PART = {
  BODY: 0, LEG_L: 1, LEG_R: 2, ARM_L: 3, ARM_R: 4,
  AXE: 5, PICK: 6, HAMMER: 7, BASKET: 8, CARRY_WOOD: 9, CARRY_SACK: 10, CARRY_FOOD: 11,
  HBODY: 12, HLEG_FL: 13, HLEG_FR: 14, HLEG_BL: 15, HLEG_BR: 16, HHEAD: 17,
  SPEAR: 18, CARRY_MEAT: 19,
};
const PART_COUNT = 20;
export const TOOL_BIT = { axe: 1, pick: 2, hammer: 4, basket: 8, wood: 16, sack: 32, food: 64, spear: 128, meat: 256 };
export const ANIM = {
  IDLE: 0, WALK: 1, CHOP: 2, MINE: 3, BUILD: 4, FORAGE: 5, ATTACK: 6, SHOOT: 7, DEAD: 8, CARRY: 9, RUN: 10, THRUST: 11, GRAZE: 12,
  THROW: 13,
};
/** Point of the attack animation (0..1) where the blow lands / the missile leaves the hand. */
export const IMPACT = { [6]: 0.55, [11]: 0.3, [7]: 0.8, [13]: 0.5 };

const TEAM = [1, 0, 1];   // sentinel vertex color replaced by the team color
const SKIN = [0.62, 0.44, 0.34];
const hair = [[0.18, 0.12, 0.08], [0.32, 0.2, 0.1], [0.08, 0.06, 0.05], [0.45, 0.33, 0.18]];

function mb() { return new MeshBuilder({ attributes: { aPart: 1, aMat: 2 } }); }
function S(b, part, color, rough = 0.8, metal = 0) { b.set({ aPart: [part], color, aMat: [rough, metal] }); }

// --------------------------------------------------------------------------
// Humans
// --------------------------------------------------------------------------
function humanBase(b, o) {
  const legC = o.legs, torsoC = o.torso, bootC = [0.13, 0.09, 0.06];
  // legs: pivot at hips (y=0.95)
  for (const [side, part] of [[-1, PART.LEG_L], [1, PART.LEG_R]]) {
    const x = side * 0.1;
    S(b, part, legC, 0.9);
    b.cylinder([x, 0.95, 0], [x, 0.5, 0.01], 0.085, 0.065, 7);
    b.cylinder([x, 0.5, 0.01], [x, 0.12, 0], 0.065, 0.05, 7);
    S(b, part, bootC, 0.7);
    b.box(x, 0.07, 0.04, 0.11, 0.14, 0.24);
  }
  // hips + torso
  S(b, PART.BODY, legC, 0.9);
  b.box(0, 0.98, 0, 0.3, 0.16, 0.2);
  S(b, PART.BODY, torsoC, o.torsoRough ?? 0.9, o.torsoMetal ?? 0);
  b.cylinder([0, 0.95, 0], [0, 1.48, 0], 0.17, 0.2, 8);
  if (o.skirt) b.cylinder([0, 0.72, 0], [0, 1.0, 0], 0.23, 0.17, 8, { caps: false });
  S(b, PART.BODY, [0.22, 0.14, 0.08], 0.6);
  b.cylinder([0, 1.02, 0], [0, 1.08, 0], 0.18, 0.18, 8, { caps: false });
  // neck + head
  S(b, PART.BODY, SKIN, 0.6);
  b.cylinder([0, 1.46, 0], [0, 1.55, 0], 0.05, 0.05, 6);
  b.sphere([0, 1.65, 0.01], [0.1, 0.12, 0.11], 9, 7);
  S(b, PART.BODY, [0.05, 0.04, 0.03], 0.4);
  b.sphere([-0.035, 1.67, 0.1], 0.012, 4, 3); b.sphere([0.035, 1.67, 0.1], 0.012, 4, 3);
  // arms: pivot at shoulders (y=1.44, x=±0.23)
  for (const [side, part] of [[-1, PART.ARM_L], [1, PART.ARM_R]]) {
    const x = side * 0.23;
    S(b, part, o.sleeves ?? torsoC, o.torsoRough ?? 0.9, o.torsoMetal ?? 0);
    b.cylinder([x, 1.44, 0], [x + side * 0.03, 1.12, 0.02], 0.058, 0.05, 6);
    b.cylinder([x + side * 0.03, 1.12, 0.02], [x + side * 0.03, 0.86, 0.05], 0.05, 0.042, 6);
    S(b, part, o.gloves ?? SKIN, 0.6);
    b.sphere([x + side * 0.03, 0.82, 0.06], 0.045, 5, 4);
  }
}

function hand(side) { return [side * 0.26, 0.82, 0.06]; }

function villager(seed) {
  const b = mb();
  const female = seed % 2 === 1;
  humanBase(b, { legs: [0.3, 0.24, 0.16], torso: TEAM, sleeves: [0.72, 0.64, 0.5], skirt: female });
  S(b, PART.BODY, hair[seed % hair.length], 0.8);
  b.sphere([0, 1.7, -0.01], [0.105, 0.09, 0.11], 8, 5);
  if (!female) { S(b, PART.BODY, [0.42, 0.32, 0.2], 0.9); b.cylinder([0, 1.74, 0], [0, 1.78, 0], 0.16, 0.12, 10); b.cylinder([0, 1.78, 0], [0, 1.86, 0], 0.1, 0.09, 8); }
  else { S(b, PART.BODY, [0.85, 0.82, 0.74], 0.9); b.sphere([0, 1.72, -0.02], [0.12, 0.08, 0.12], 8, 5); }
  // apron / belt pouch
  S(b, PART.BODY, [0.6, 0.55, 0.45], 0.9); b.box(0, 0.9, 0.17, 0.26, 0.32, 0.02);
  const [hx, hy, hz] = hand(1);
  // tools held in the right hand (hidden unless the task needs them)
  S(b, PART.AXE, [0.42, 0.3, 0.18], 0.7); b.cylinder([hx, hy - 0.12, hz], [hx, hy + 0.55, hz + 0.02], 0.02, 0.02, 5);
  S(b, PART.AXE, [0.55, 0.56, 0.58], 0.35, 1); b.box(hx, hy + 0.5, hz + 0.1, 0.03, 0.14, 0.18);
  S(b, PART.PICK, [0.42, 0.3, 0.18], 0.7); b.cylinder([hx, hy - 0.12, hz], [hx, hy + 0.6, hz], 0.02, 0.02, 5);
  S(b, PART.PICK, [0.45, 0.46, 0.48], 0.35, 1); b.cylinder([hx, hy + 0.56, hz - 0.25], [hx, hy + 0.56, hz + 0.25], 0.025, 0.012, 5);
  S(b, PART.HAMMER, [0.42, 0.3, 0.18], 0.7); b.cylinder([hx, hy - 0.08, hz], [hx, hy + 0.35, hz], 0.018, 0.018, 5);
  S(b, PART.HAMMER, [0.4, 0.4, 0.42], 0.4, 1); b.box(hx, hy + 0.34, hz, 0.06, 0.06, 0.16);
  S(b, PART.BASKET, [0.62, 0.48, 0.28], 0.95); b.cylinder([-0.3, 0.84, 0.12], [-0.3, 1.02, 0.12], 0.13, 0.16, 9);
  // hunting spear
  S(b, PART.SPEAR, [0.46, 0.34, 0.2], 0.7); b.cylinder([hx, hy - 0.55, hz - 0.02], [hx, hy + 1.2, hz + 0.05], 0.018, 0.016, 5);
  S(b, PART.SPEAR, [0.6, 0.61, 0.63], 0.3, 1); b.cone([hx, hy + 1.2, hz + 0.05], [hx, hy + 1.42, hz + 0.06], 0.035, 5);
  // carried loads (on the shoulder / back)
  S(b, PART.CARRY_WOOD, [0.36, 0.26, 0.17], 0.9);
  for (const dz of [-0.07, 0.07]) b.cylinder([-0.55, 1.55, dz], [0.55, 1.6, dz], 0.075, 0.075, 6);
  b.cylinder([-0.5, 1.68, 0], [0.5, 1.72, 0], 0.07, 0.07, 6);
  S(b, PART.CARRY_SACK, [0.55, 0.47, 0.34], 0.95); b.sphere([0.08, 1.52, -0.2], [0.17, 0.2, 0.14], 8, 6);
  S(b, PART.CARRY_FOOD, [0.62, 0.48, 0.28], 0.95); b.cylinder([-0.3, 0.84, 0.12], [-0.3, 1.02, 0.12], 0.13, 0.16, 9);
  S(b, PART.CARRY_FOOD, [0.5, 0.05, 0.06], 0.4); b.sphere([-0.3, 1.03, 0.12], [0.12, 0.05, 0.12], 7, 4);
  // haunch of meat over the shoulder
  S(b, PART.CARRY_MEAT, [0.5, 0.17, 0.13], 0.55); b.sphere([0.2, 1.52, -0.08], [0.13, 0.11, 0.24], 8, 6);
  S(b, PART.CARRY_MEAT, [0.88, 0.84, 0.74], 0.6); b.cylinder([0.2, 1.53, 0.14], [0.2, 1.55, 0.3], 0.03, 0.025, 5);
  return b;
}

function militia() {
  const b = mb();
  const mail = [0.42, 0.43, 0.45];
  humanBase(b, { legs: [0.28, 0.24, 0.2], torso: mail, torsoRough: 0.45, torsoMetal: 0.85, sleeves: mail, gloves: [0.25, 0.18, 0.12] });
  S(b, PART.BODY, TEAM, 0.9); b.box(0, 1.1, 0.02, 0.34, 0.55, 0.36);          // tabard
  S(b, PART.BODY, [0.5, 0.51, 0.53], 0.35, 1); b.sphere([0, 1.7, 0], [0.12, 0.11, 0.125], 9, 6);   // helmet
  b.box(0, 1.68, 0.12, 0.02, 0.12, 0.03);
  const [hx, hy, hz] = hand(1);
  S(b, PART.ARM_R, [0.72, 0.73, 0.76], 0.25, 1); b.box(hx, hy + 0.45, hz + 0.02, 0.05, 0.8, 0.012);   // sword
  S(b, PART.ARM_R, [0.3, 0.22, 0.14], 0.6); b.box(hx, hy + 0.02, hz + 0.02, 0.18, 0.04, 0.04);
  // round shield on the left arm
  S(b, PART.ARM_L, TEAM, 0.8); b.cylinder([-0.33, 1.05, 0.08], [-0.37, 1.05, 0.08], 0.3, 0.3, 14);
  S(b, PART.ARM_L, [0.55, 0.55, 0.56], 0.35, 1); b.sphere([-0.38, 1.05, 0.08], [0.02, 0.07, 0.07], 6, 4);
  return b;
}

function spearman() {
  const b = mb();
  const gamb = [0.55, 0.47, 0.34];
  humanBase(b, { legs: [0.3, 0.26, 0.2], torso: gamb, sleeves: gamb });
  S(b, PART.BODY, TEAM, 0.9); b.box(0, 1.2, 0.02, 0.36, 0.36, 0.38);
  S(b, PART.BODY, [0.48, 0.49, 0.5], 0.35, 1); b.cylinder([0, 1.72, 0], [0, 1.83, 0], 0.13, 0.06, 10); b.cylinder([0, 1.7, 0], [0, 1.72, 0], 0.2, 0.2, 12, { caps: true });
  const [hx, hy, hz] = hand(1);
  S(b, PART.ARM_R, [0.45, 0.33, 0.2], 0.7); b.cylinder([hx, hy - 0.9, hz], [hx, hy + 2.1, hz + 0.05], 0.025, 0.022, 5);
  S(b, PART.ARM_R, [0.7, 0.71, 0.74], 0.25, 1); b.cone([hx, hy + 2.1, hz + 0.05], [hx, hy + 2.4, hz + 0.06], 0.045, 5);
  S(b, PART.ARM_L, TEAM, 0.8); b.box(-0.33, 1.05, 0.08, 0.04, 0.5, 0.36);
  return b;
}

function archer() {
  const b = mb();
  const leather = [0.4, 0.28, 0.17];
  humanBase(b, { legs: [0.32, 0.28, 0.2], torso: leather, sleeves: [0.5, 0.44, 0.34] });
  S(b, PART.BODY, TEAM, 0.9);
  b.sphere([0, 1.68, -0.02], [0.13, 0.14, 0.14], 9, 6);   // hood
  b.cone([0, 1.62, -0.12], [0, 1.4, -0.22], 0.12, 7);
  b.box(0, 1.12, 0.1, 0.3, 0.4, 0.05);
  S(b, PART.BODY, [0.35, 0.24, 0.14], 0.8); b.cylinder([0.12, 1.1, -0.18], [0.18, 1.62, -0.2], 0.06, 0.06, 7);   // quiver
  S(b, PART.BODY, [0.8, 0.8, 0.75], 0.8); for (let k = 0; k < 4; k++) b.box(0.16 + k * 0.012, 1.66, -0.2, 0.01, 0.12, 0.03);
  // longbow in the left hand
  const [lx, ly, lz] = hand(-1);
  S(b, PART.ARM_L, [0.38, 0.25, 0.13], 0.6);
  const pts = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8 - 0.5; pts.push([lx, ly + t * 1.5, lz + 0.12 + Math.cos(t * Math.PI) * 0.18]); }
  for (let k = 0; k < 8; k++) b.cylinder(pts[k], pts[k + 1], 0.018, 0.018, 4, { caps: false });
  S(b, PART.ARM_L, [0.85, 0.83, 0.76], 0.8); b.cylinder(pts[0], pts[8], 0.005, 0.005, 3, { caps: false });
  return b;
}

// --------------------------------------------------------------------------
// Horses and riders
// --------------------------------------------------------------------------
function horse(b, coat, { armor = null } = {}) {
  const dark = coat.map((c) => c * 0.45);
  S(b, PART.HBODY, coat, 0.6);
  b.sphere([0, 1.28, 0], [0.34, 0.38, 0.85], 12, 8);
  b.cylinder([0, 1.3, -0.72], [0, 1.2, -0.95], 0.2, 0.08, 6);          // tail root
  S(b, PART.HBODY, dark, 0.7); b.cylinder([0, 1.2, -0.95], [0, 0.72, -1.05], 0.08, 0.03, 6);   // tail
  // legs (pivots at shoulders / hips)
  const legs = [[PART.HLEG_FL, -0.18, 0.55], [PART.HLEG_FR, 0.18, 0.55], [PART.HLEG_BL, -0.18, -0.55], [PART.HLEG_BR, 0.18, -0.55]];
  for (const [part, x, z] of legs) {
    S(b, part, coat, 0.6);
    b.cylinder([x, 1.15, z], [x, 0.62, z + 0.02], 0.1, 0.06, 7);
    b.cylinder([x, 0.62, z + 0.02], [x, 0.12, z], 0.045, 0.04, 6);
    S(b, part, [0.1, 0.08, 0.06], 0.4); b.cylinder([x, 0.12, z], [x, 0.0, z + 0.02], 0.055, 0.06, 6);
  }
  // neck + head
  S(b, PART.HHEAD, coat, 0.6);
  b.cylinder([0, 1.45, 0.6], [0, 1.95, 0.95], 0.2, 0.13, 8);
  b.cylinder([0, 1.98, 0.95], [0, 1.72, 1.35], 0.12, 0.08, 8);
  S(b, PART.HHEAD, dark, 0.8); b.box(0, 1.85, 0.8, 0.05, 0.35, 0.35);    // mane
  if (armor) {
    S(b, PART.HBODY, armor, 0.85);
    b.cylinder([0, 1.2, 0.85], [0, 1.2, -0.85], 0.48, 0.48, 12, { caps: false });
    b.cylinder([0, 0.8, 0.85], [0, 0.8, -0.85], 0.46, 0.46, 12, { caps: false });
  }
  // saddle
  S(b, PART.HBODY, [0.3, 0.18, 0.1], 0.6); b.box(0, 1.62, 0.05, 0.42, 0.1, 0.5);
}

function rider(b, o) {
  // seated human: pelvis at y=1.66, legs fixed around the horse (part HBODY)
  const y0 = 0.72;
  b.push().translate(0, y0, 0);
  S(b, PART.HBODY, o.legs, 0.9);
  for (const side of [-1, 1]) {
    b.cylinder([side * 0.12, 0.95, 0], [side * 0.3, 0.72, 0.18], 0.08, 0.065, 6);
    b.cylinder([side * 0.3, 0.72, 0.18], [side * 0.32, 0.35, 0.1], 0.065, 0.05, 6);
    S(b, PART.HBODY, [0.13, 0.09, 0.06], 0.7); b.box(side * 0.32, 0.3, 0.15, 0.1, 0.12, 0.22);
    S(b, PART.HBODY, o.legs, 0.9);
  }
  S(b, PART.BODY, o.torso, o.torsoRough ?? 0.9, o.torsoMetal ?? 0);
  b.cylinder([0, 0.95, 0], [0, 1.48, 0], 0.17, 0.2, 8);
  S(b, PART.BODY, SKIN, 0.6); b.sphere([0, 1.65, 0.01], [0.1, 0.12, 0.11], 9, 7);
  for (const [side, part] of [[-1, PART.ARM_L], [1, PART.ARM_R]]) {
    const x = side * 0.23;
    S(b, part, o.sleeves ?? o.torso, o.torsoRough ?? 0.9, o.torsoMetal ?? 0);
    b.cylinder([x, 1.44, 0], [x + side * 0.03, 1.12, 0.12], 0.058, 0.05, 6);
    b.cylinder([x + side * 0.03, 1.12, 0.12], [x + side * 0.03, 0.95, 0.35], 0.05, 0.042, 6);
    S(b, part, SKIN, 0.6); b.sphere([x + side * 0.03, 0.93, 0.38], 0.045, 5, 4);
  }
  b.pop();
}

function scout() {
  const b = mb();
  horse(b, [0.36, 0.22, 0.12]);
  rider(b, { legs: [0.3, 0.26, 0.2], torso: [0.42, 0.3, 0.18], sleeves: [0.42, 0.3, 0.18] });
  S(b, PART.BODY, TEAM, 0.9);
  b.push().translate(0, 0.72, 0);
  b.cylinder([0, 1.46, -0.05], [0, 0.95, -0.3], 0.18, 0.3, 8, { caps: false });   // cloak
  b.pop();
  S(b, PART.ARM_R, [0.45, 0.33, 0.2], 0.7); b.cylinder([0.26, 1.2, 0.35], [0.26, 2.9, 0.6], 0.02, 0.018, 5);
  S(b, PART.ARM_R, [0.7, 0.71, 0.74], 0.3, 1); b.cone([0.26, 2.9, 0.6], [0.26, 3.1, 0.63], 0.035, 5);
  return b;
}

function knight() {
  const b = mb();
  horse(b, [0.12, 0.1, 0.09], { armor: TEAM });
  const plate = [0.6, 0.61, 0.64];
  rider(b, { legs: plate, torso: plate, torsoRough: 0.3, torsoMetal: 1, sleeves: plate });
  b.push().translate(0, 0.72, 0);
  S(b, PART.BODY, [0.62, 0.63, 0.66], 0.25, 1); b.cylinder([0, 1.58, 0], [0, 1.82, 0], 0.13, 0.13, 10); b.sphere([0, 1.82, 0], [0.13, 0.05, 0.13], 8, 4);
  S(b, PART.BODY, TEAM, 0.9); b.box(0, 1.25, 0.02, 0.36, 0.5, 0.38);
  b.pop();
  S(b, PART.ARM_R, [0.75, 0.76, 0.78], 0.25, 1); b.box(0.26, 2.1, 0.45, 0.05, 0.9, 0.012);
  S(b, PART.ARM_L, TEAM, 0.7); b.box(-0.36, 1.8, 0.3, 0.05, 0.6, 0.45);
  return b;
}

// --------------------------------------------------------------------------
// Animals
// --------------------------------------------------------------------------
function sheep() {
  const b = mb();
  const wool = [0.86, 0.84, 0.78];
  S(b, PART.HBODY, wool, 1.0);
  b.sphere([0, 0.62, 0], [0.3, 0.3, 0.48], 10, 7, { noise: (x, y, z) => Math.sin(x * 11) * Math.sin(y * 13) * Math.sin(z * 9) * 0.06 });
  for (const [part, x, z] of [[PART.HLEG_FL, -0.13, 0.28], [PART.HLEG_FR, 0.13, 0.28], [PART.HLEG_BL, -0.13, -0.28], [PART.HLEG_BR, 0.13, -0.28]]) {
    S(b, part, [0.12, 0.1, 0.09], 0.7);
    b.cylinder([x, 0.5, z], [x, 0.02, z], 0.04, 0.035, 5);
  }
  S(b, PART.HHEAD, [0.15, 0.12, 0.1], 0.7);
  b.sphere([0, 0.82, 0.5], [0.1, 0.12, 0.16], 8, 6);
  b.box(-0.12, 0.84, 0.47, 0.12, 0.04, 0.06); b.box(0.12, 0.84, 0.47, 0.12, 0.04, 0.06);
  // collar in the owner's colour (grey rope while wild)
  S(b, PART.HHEAD, TEAM, 0.8); b.cylinder([0, 0.72, 0.38], [0, 0.76, 0.43], 0.11, 0.1, 10, { caps: false });
  return b;
}

function deer() {
  const b = mb();
  const coat = [0.46, 0.3, 0.17];
  S(b, PART.HBODY, coat, 0.7);
  b.sphere([0, 1.0, 0], [0.24, 0.28, 0.6], 10, 7);
  S(b, PART.HBODY, [0.85, 0.8, 0.7], 0.8); b.sphere([0, 1.02, -0.55], [0.1, 0.1, 0.06], 6, 4);
  for (const [part, x, z] of [[PART.HLEG_FL, -0.11, 0.42], [PART.HLEG_FR, 0.11, 0.42], [PART.HLEG_BL, -0.11, -0.42], [PART.HLEG_BR, 0.11, -0.42]]) {
    S(b, part, coat, 0.7);
    b.cylinder([x, 0.95, z], [x, 0.5, z], 0.05, 0.03, 5);
    b.cylinder([x, 0.5, z], [x, 0.02, z], 0.025, 0.022, 5);
  }
  S(b, PART.HHEAD, coat, 0.7);
  b.cylinder([0, 1.1, 0.45], [0, 1.5, 0.62], 0.1, 0.07, 7);
  b.sphere([0, 1.55, 0.72], [0.08, 0.08, 0.14], 7, 5);
  S(b, PART.HHEAD, [0.36, 0.3, 0.22], 0.6);
  for (const s of [-1, 1]) {
    b.cylinder([s * 0.04, 1.62, 0.66], [s * 0.18, 1.95, 0.6], 0.015, 0.01, 4);
    b.cylinder([s * 0.13, 1.82, 0.62], [s * 0.2, 1.9, 0.75], 0.01, 0.008, 4);
  }
  return b;
}

const BUILDERS = { villager: (s) => villager(s), villager_f: () => villager(1), swordsman: militia, spearman, archer, scout, knight, sheep, deer };

/** Pivot points of every part (model space). */
function pivotsFor(model) {
  const p = new Array(PART_COUNT).fill(0).map(() => [0, 0, 0]);
  p[PART.BODY] = [0, 0.95, 0];
  p[PART.LEG_L] = [-0.1, 0.95, 0]; p[PART.LEG_R] = [0.1, 0.95, 0];
  p[PART.ARM_L] = [-0.23, 1.44, 0]; p[PART.ARM_R] = [0.23, 1.44, 0];
  if (model === 'scout' || model === 'knight') {
    p[PART.BODY] = [0, 1.67, 0];
    p[PART.ARM_L] = [-0.23, 2.16, 0]; p[PART.ARM_R] = [0.23, 2.16, 0];
    p[PART.HLEG_FL] = [-0.18, 1.15, 0.55]; p[PART.HLEG_FR] = [0.18, 1.15, 0.55];
    p[PART.HLEG_BL] = [-0.18, 1.15, -0.55]; p[PART.HLEG_BR] = [0.18, 1.15, -0.55];
    p[PART.HHEAD] = [0, 1.5, 0.6];
  }
  if (model === 'sheep') {
    p[PART.HLEG_FL] = [-0.13, 0.5, 0.28]; p[PART.HLEG_FR] = [0.13, 0.5, 0.28];
    p[PART.HLEG_BL] = [-0.13, 0.5, -0.28]; p[PART.HLEG_BR] = [0.13, 0.5, -0.28];
    p[PART.HHEAD] = [0, 0.75, 0.38];
  }
  if (model === 'deer') {
    p[PART.HLEG_FL] = [-0.11, 0.95, 0.42]; p[PART.HLEG_FR] = [0.11, 0.95, 0.42];
    p[PART.HLEG_BL] = [-0.11, 0.95, -0.42]; p[PART.HLEG_BR] = [0.11, 0.95, -0.42];
    p[PART.HHEAD] = [0, 1.1, 0.45];
  }
  // tools / loads follow their parent parts
  for (const t of [PART.AXE, PART.PICK, PART.HAMMER, PART.SPEAR]) p[t] = p[PART.ARM_R];
  for (const t of [PART.BASKET, PART.CARRY_WOOD, PART.CARRY_SACK, PART.CARRY_FOOD, PART.CARRY_MEAT]) p[t] = p[PART.BODY];
  return p.map((q) => new Vector3(...q));
}

// --------------------------------------------------------------------------
// Material
// --------------------------------------------------------------------------
const VERT = /* glsl */ `
in float aPart;
in vec2 aMat;
in vec4 aState;     // anim state, phase (0..1), part mask, extra (death / attack progress)
in vec3 aTeam;
uniform vec3 uPivots[20];
uniform float uRider;
uniform float uQuad;
out vec3 vColor;
out vec3 vNormalW;
out vec2 vMat;
out vec3 vWorldPos;

mat3 rX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

void main() {
  int part = int(aPart + 0.5);
  int st = int(aState.x + 0.5);
  float ph = aState.y * 6.2831853;
  int mask = int(aState.z + 0.5);
  float ex = aState.w;
  vec3 p = position;
  vec3 n = normal;

  // optional parts (tools / loads)
  if ((part >= 5 && part <= 11) || part >= 18) {
    int bit = part <= 11 ? 1 << (part - 5) : 1 << (part - 11);
    if ((mask & bit) == 0) { p = uPivots[0]; }
  }

  float legA = 0.0, armLA = 0.0, armRA = 0.0, armRZ = 0.0, armLZ = 0.0, bodyA = 0.0, bob = 0.0, headA = 0.0;
  float s1 = sin(ph), c1 = cos(ph);
  bool walking = st == 1 || st == 9 || st == 10;
  if (walking) {
    float amp = st == 10 ? 0.9 : 0.55;
    legA = s1 * amp;
    armLA = -s1 * 0.45;
    armRA = st == 9 ? -0.35 : s1 * 0.45;
    bob = abs(s1) * 0.035;
    bodyA = st == 10 ? 0.12 : 0.04;
  } else if (st == 0) {
    armLA = sin(ph) * 0.04; armRA = -sin(ph) * 0.04; bob = sin(ph) * 0.006;
  } else if (st == 2 || st == 3) {
    // chop / mine: two-handed overhead strike
    float k = fract(aState.y);
    float strike = k < 0.6 ? smoothstep(0.0, 0.6, k) : 1.0 - smoothstep(0.6, 0.75, k);
    armRA = mix(0.2, -2.6, strike);
    armLA = armRA * 0.85;
    armRZ = -0.25; armLZ = 0.35;
    bodyA = mix(0.35, 0.05, strike) * (st == 3 ? 1.3 : 1.0);
  } else if (st == 4) {
    float k = fract(aState.y * 2.0);
    armRA = mix(-1.9, -0.6, smoothstep(0.0, 0.25, k) - smoothstep(0.25, 1.0, k));
    armLA = -0.6; bodyA = 0.35;
  } else if (st == 5) {
    bodyA = 0.75;
    armLA = -0.9 + sin(ph) * 0.35; armRA = -1.0 - sin(ph + 1.5) * 0.35;
  } else if (st == 6) {
    float k = fract(aState.y);
    float swing = k < 0.35 ? smoothstep(0.0, 0.35, k) : 1.0 - smoothstep(0.35, 0.9, k);
    armRA = mix(-2.4, 0.3, 1.0 - swing);
    armRA = mix(0.2, -2.5, swing);
    armRZ = mix(0.1, -0.5, swing);
    armLA = -0.9; bodyA = 0.1 + swing * 0.15;
  } else if (st == 11) {
    float k = fract(aState.y);
    float thrust = k < 0.3 ? smoothstep(0.0, 0.3, k) : 1.0 - smoothstep(0.3, 1.0, k);
    armRA = mix(-0.9, -1.5, thrust); armLA = -1.0; bodyA = 0.15 + thrust * 0.2;
  } else if (st == 7) {
    float k = fract(aState.y);
    armLA = -1.55;
    armRA = -1.5; armRZ = mix(-0.2, 0.9, smoothstep(0.1, 0.7, k) * (1.0 - smoothstep(0.85, 0.95, k)));
  } else if (st == 12) {
    headA = 0.9 + sin(ph * 0.5) * 0.1;
  } else if (st == 13) {
    // javelin throw: lean back with the arm cocked, whip forward, recover
    float k = fract(aState.y);
    float wind = smoothstep(0.0, 0.42, k);
    float rel = smoothstep(0.42, 0.56, k);
    float rec = smoothstep(0.62, 1.0, k);
    armRA = mix(mix(-0.5, -3.0, wind), -1.0, rel);
    armRA = mix(armRA, -0.5, rec);
    armLA = mix(-0.3, -1.3, wind) * (1.0 - 0.6 * rel);
    bodyA = mix(mix(0.05, -0.22, wind), 0.4, rel);
    bodyA = mix(bodyA, 0.08, rec);
    legA = 0.25 * wind * (1.0 - rec);
  }

  // the hunting spear turns in the hand: overhand grip for the throw, point-down grip to stab
  if (part == 18) {
    float spearA = 0.0;
    if (st == 13) { float k = fract(aState.y); spearA = -1.81 * smoothstep(0.0, 0.3, k) * (1.0 - smoothstep(0.88, 1.0, k)); }
    else if (st == 11) spearA = 3.05;
    if (spearA != 0.0) {
      vec3 hp = vec3(0.26, 0.82, 0.06);
      mat3 G = rX(spearA);
      p = hp + G * (p - hp);
      n = G * n;
    }
  }
  vec3 piv = uPivots[part];
  mat3 R = mat3(1.0);
  bool rider = uRider > 0.5;
  if (part == 1) R = rX(-legA);
  else if (part == 2) R = rX(legA);
  else if (part == 3) R = rZ(armLZ) * rX(armLA);
  else if (part == 4 || part == 5 || part == 6 || part == 7 || part == 18) R = rZ(armRZ) * rX(armRA);
  else if (part >= 13 && part <= 16) {
    float lp = (part == 13 || part == 16) ? ph : ph + 3.14159;
    float amp = st == 10 ? 0.75 : (walking ? 0.45 : 0.0);
    R = rX(sin(lp) * amp);
  } else if (part == 17) R = rX(headA + (walking ? sin(ph * 2.0) * 0.05 : 0.0));
  p = piv + R * (p - piv);
  n = R * n;

  // upper body leans around the hips (humans) — legs stay put
  bool upper = part == 0 || (part >= 3 && part <= 11) || part >= 18;
  if (upper && !rider) {
    vec3 hp = uPivots[0];
    mat3 B = rX(bodyA);
    p = hp + B * (p - hp);
    n = B * n;
  }
  p.y += bob;
  // death: fall backwards around the feet
  if (st == 8) {
    // people fall backwards, animals roll onto their side
    mat3 D = uQuad > 0.5 ? rZ(1.5 * ex) : rX(-1.5 * ex);
    p = D * p;
    n = D * n;
    p.y += (uQuad > 0.5 ? 0.27 : 0.12) * ex;
  }
  vec3 c = color;
  if (color.r > 0.99 && color.g < 0.01 && color.b > 0.99) c = aTeam;
  vColor = c;
  vMat = aMat;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${COMMON}
in vec3 vColor;
in vec3 vNormalW;
in vec2 vMat;
in vec3 vWorldPos;
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gLight;
void main() {
#ifdef SHADOW
  gAlbedo = vec4(1.0);
#else
  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  // subtle fabric / grime variation so flat colors don't look plastic
  float g = hash13(floor(vWorldPos * 24.0)) * 0.12 + 0.94;
  gAlbedo = vec4(sqrt(max(vColor * g, 0.0)), 1.0);
  gNormal = vec4(encodeNormal(n), vMat.x, vMat.y);
  gLight = vec4(1.0, 0.0, 0.0, 8.0 / 255.0);
#endif
}
`;

function unitMaterial(pivots, rider, shadow, quad = false) {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: true,
    defines: shadow ? { SHADOW: '' } : {},
    uniforms: { uPivots: { value: pivots }, uRider: { value: rider ? 1 : 0 }, uQuad: { value: quad ? 1 : 0 } },
    ...(shadow ? { polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 } : {}),
  });
}

/**
 * One instanced mesh per unit model. Call `set(i, matrix, state, phase, mask, extra, teamColor)`.
 */
export class UnitBatch {
  constructor(pipeline, model, capacity = 256) {
    this.model = model;
    this.capacity = capacity;
    const b = BUILDERS[model](7);
    const geo = b.build();
    this.state = new Float32Array(capacity * 4);
    this.team = new Float32Array(capacity * 3);
    this.aState = new InstancedBufferAttribute(this.state, 4).setUsage(DynamicDrawUsage);
    this.aTeam = new InstancedBufferAttribute(this.team, 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('aState', this.aState);
    geo.setAttribute('aTeam', this.aTeam);
    const pivots = pivotsFor(model);
    const rider = model === 'scout' || model === 'knight';
    const quad = model === 'sheep' || model === 'deer';
    this.mesh = new InstancedMesh(geo, unitMaterial(pivots, rider, false, quad), capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    pipeline.scene.add(this.mesh);
    pipeline.addShadowCaster(this.mesh, unitMaterial(pivots, rider, true, quad));
  }

  begin() { this.n = 0; }

  push(matrix, anim, phase, mask, extra, color) {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.mesh.setMatrixAt(i, matrix);
    const o = i * 4;
    this.state[o] = anim; this.state[o + 1] = phase; this.state[o + 2] = mask; this.state[o + 3] = extra;
    this.team[i * 3] = color[0]; this.team[i * 3 + 1] = color[1]; this.team[i * 3 + 2] = color[2];
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aState.needsUpdate = true;
    this.aTeam.needsUpdate = true;
  }
}

export const UNIT_MODELS = Object.keys(BUILDERS);
export { Matrix4, Sphere };
