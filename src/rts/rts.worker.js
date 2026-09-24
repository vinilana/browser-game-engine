// Worker for "Reinos": texture synthesis and distant scenery tiles.
import { exposeWorker, withTransfer } from '../engine/core/WorkerPool.js';
import { synthesize } from '../engine/voxel/TextureSynth.js';
import { buildFarTile } from '../engine/terrain/farTileBuilder.js';
import { RTS_RECIPES } from './textures.js';
import { MapGenerator } from './mapgen.js';

let gen = null;
exposeWorker({
  init({ seed }) { gen = new MapGenerator(seed); return true; },
  textures({ names, size }) {
    const out = synthesize(RTS_RECIPES, names, size);
    const transfer = [];
    for (const t of out) transfer.push(t.albedo.buffer, t.normal.buffer, t.material.buffer);
    return withTransfer(out, transfer);
  },
  farTile(params) {
    const g = buildFarTile((x, z, o) => gen.farSample(x, z, o), params);
    return withTransfer(g, [g.pos.buffer, g.nrm.buffer, g.col.buffer, g.idx.buffer]);
  },
  generateMap() {
    const m = gen.generate();
    return withTransfer(m, [m.heights.buffer, m.splat.buffer]);
  },
});
