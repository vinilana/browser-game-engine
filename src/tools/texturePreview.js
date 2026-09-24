// Renders every procedural texture layer for quick visual inspection.
import { synthesize } from '../engine/voxel/TextureSynth.js';
import { TEXTURE_RECIPES, TEXTURE_NAMES } from '../game/textures.js';

const params = new URLSearchParams(location.search);
const size = Number(params.get('size') || 128);
const filter = params.get('only');
const scale = Number(params.get('scale') || 1);
const names = filter ? TEXTURE_NAMES.filter((n) => filter.split(',').includes(n)) : TEXTURE_NAMES;
const grid = document.getElementById('grid');

function toCanvas(data, fn) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.style.width = c.style.height = size * scale + 'px';
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) fn(data, i, img.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

const t0 = performance.now();
const out = synthesize(TEXTURE_RECIPES, names, size);
console.log('synth ms', performance.now() - t0);
const L = [0.45, 0.75, 0.5];
const ll = Math.hypot(...L);
for (const t of out) {
  const box = document.createElement('div');
  box.className = 't';
  const row = document.createElement('div');
  row.className = 'row';
  // simple lit preview: albedo * (0.35 + 0.65 * N.L) with alpha over grey
  row.appendChild(toCanvas(t, (d, i, o) => {
    const nx = d.normal[i * 4] / 127.5 - 1, ny = d.normal[i * 4 + 1] / 127.5 - 1, nz = d.normal[i * 4 + 2] / 127.5 - 1;
    const ndl = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / ll);
    const ao = d.material[i * 4 + 2] / 255;
    const a = d.albedo[i * 4 + 3] / 255;
    const lit = (0.3 * ao + 0.8 * ndl) ;
    for (let k = 0; k < 3; k++) {
      const c = d.albedo[i * 4 + k] * lit;
      o[i * 4 + k] = c * a + 90 * (1 - a);
    }
    o[i * 4 + 3] = 255;
  }));
  row.appendChild(toCanvas(t, (d, i, o) => { for (let k = 0; k < 4; k++) o[i * 4 + k] = d.albedo[i * 4 + k]; if (d.albedo[i*4+3] < 128) { o[i*4]=o[i*4+1]=o[i*4+2]=60; o[i*4+3]=255; } }));
  row.appendChild(toCanvas(t, (d, i, o) => { for (let k = 0; k < 3; k++) o[i * 4 + k] = d.normal[i * 4 + k]; o[i * 4 + 3] = 255; }));
  row.appendChild(toCanvas(t, (d, i, o) => { o[i * 4] = d.material[i * 4]; o[i * 4 + 1] = d.material[i * 4 + 1]; o[i * 4 + 2] = d.material[i * 4 + 2]; o[i * 4 + 3] = 255; }));
  box.appendChild(row);
  const label = document.createElement('div');
  label.textContent = t.name;
  box.appendChild(label);
  grid.appendChild(box);
}
window.worldReady = true;
