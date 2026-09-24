// Isometric block icons rendered from the procedural albedo textures.
import { RenderType, Tint } from '../engine/voxel/BlockRegistry.js';

const GRASS = [112, 148, 70];
const FOLIAGE = [88, 130, 52];

function faceCanvas(tex, size, tint, mode, sub) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const src = tex.albedo;
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    let r = src[o], g = src[o + 1], b = src[o + 2];
    const a = src[o + 3];
    if (tint && (mode === 1 || (mode === 2 && a > 20))) {
      const m = mode === 2 ? a / 255 : 1;
      r = r * (1 - m) + r * tint[0] / 255 * m;
      g = g * (1 - m) + g * tint[1] / 255 * m;
      b = b * (1 - m) + b * tint[2] / 255 * m;
    }
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b;
    img.data[o + 3] = mode === 2 || mode === 0 ? 255 : a;
  }
  ctx.putImageData(img, 0, 0);
  if (sub) {
    const s2 = document.createElement('canvas');
    s2.width = size; s2.height = size;
    s2.getContext('2d').drawImage(c, sub[0] * size, sub[1] * size, sub[2] * size, sub[3] * size, 0, 0, size, size);
    return s2;
  }
  return c;
}

/**
 * @param {import('../engine/voxel/VoxelWorld.js').VoxelWorld} world
 * @param {number} id
 * @param {number} px icon size in pixels
 */
export function makeBlockIcon(world, id, px = 64) {
  const reg = world.registry;
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const size = world.textureSize;
  const layerTex = (face) => world.textureData.get(reg.textureNames[reg.faceLayer[id * 6 + face]]);
  const rt = reg.renderType[id];
  const tintType = reg.tint[id];
  const tint = tintType === Tint.FOLIAGE ? FOLIAGE : tintType ? GRASS : null;
  if (rt === RenderType.CROSS || rt === RenderType.TORCH) {
    const tex = layerTex(2);
    const sub = rt === RenderType.TORCH ? [5 / 16, 0.3, 6 / 16, 0.7] : null;
    const fc = faceCanvas(tex, size, tint, tintType === Tint.MASKED_GRASS ? 2 : tint ? 1 : 3, sub);
    ctx.drawImage(fc, px * 0.08, px * 0.08, px * 0.84, px * 0.84);
    return canvas;
  }
  const mode = tintType === Tint.MASKED_GRASS ? 2 : tint ? 1 : (rt === RenderType.CUTOUT || rt === RenderType.GLASS ? 3 : 0);
  const top = faceCanvas(layerTex(2), size, tint, tintType === Tint.MASKED_GRASS ? 1 : mode, null);
  const side = faceCanvas(layerTex(4), size, tint, mode, null);
  const s = px / size;
  const W = px * 0.44, Hh = px * 0.22, cx = px / 2, top0 = px * 0.06;
  const draw = (img, a, b, c, d, e, f, shade) => {
    ctx.save();
    ctx.setTransform(a * s / px, b * s / px, c * s / px, d * s / px, e, f);
    ctx.drawImage(img, 0, 0);
    if (shade < 1) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.restore();
  };
  const h = px * 0.44;
  // top rhombus
  draw(top, W, Hh, -W, Hh, cx, top0, 1);
  // left face
  draw(side, W, Hh, 0, h, cx - W, top0 + Hh, 0.78);
  // right face
  draw(side, W, -Hh, 0, h, cx, top0 + 2 * Hh, 0.6);
  return canvas;
}
