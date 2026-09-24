// Worker-side entry point for the voxel system. A game creates its own worker
// module that calls `startVoxelWorker` with its block registry, world
// generator factory and texture recipes.
import { exposeWorker, withTransfer } from '../core/WorkerPool.js';
import { computeLight, meshRegion, CHUNK, PAD, PS, SY } from './Mesher.js';
import { synthesize } from './TextureSynth.js';
import { buildFarTile } from '../terrain/farTileBuilder.js';

/**
 * @param {{
 *   registry: import('./BlockRegistry.js').BlockRegistry,
 *   createGenerator: (seed:number, options:any) => { generate(cx:number, cz:number): {blocks:Uint8Array, tints:Uint8Array} },
 *   textureRecipes: Record<string, (ctx:any)=>void>,
 * }} cfg
 */
export function startVoxelWorker(cfg) {
  const { registry } = cfg;
  let generator = null;
  const H = 256;

  exposeWorker({
    init({ seed, options }) {
      generator = cfg.createGenerator(seed, options || {});
      return true;
    },

    generate({ cx, cz }) {
      const { blocks, tints } = generator.generate(cx, cz);
      let maxY = 0;
      const layer = CHUNK * CHUNK;
      for (let y = H - 1; y >= 0; y--) {
        const base = y * layer;
        let any = false;
        for (let k = 0; k < layer; k++) { if (blocks[base + k] !== 0) { any = true; break; } }
        if (any) { maxY = y; break; }
      }
      return withTransfer({ blocks, tints, maxY }, [blocks.buffer, tints.buffer]);
    },

    mesh({ region, H: RH, tints, cx, cz, skipDark, fancyLeaves }) {
      const { sky, blk } = computeLight(registry, region, RH);
      const res = meshRegion(registry, region, sky, blk, RH, tints, { cx, cz, skipDark, fancyLeaves });
      // light of the central column, packed (sky << 4 | block)
      const light = new Uint8Array(CHUNK * CHUNK * RH);
      for (let y = 0; y < RH; y++) {
        for (let z = 0; z < CHUNK; z++) {
          const src = y * SY + (z + PAD) * PS + PAD;
          const dst = (y * CHUNK + z) * CHUNK;
          for (let x = 0; x < CHUNK; x++) light[dst + x] = (sky[src + x] << 4) | blk[src + x];
        }
      }
      const transfer = [light.buffer];
      for (const g of [res.opaque, res.cutout, res.translucent]) {
        transfer.push(g.pos.buffer, g.d0.buffer, g.d1.buffer, g.tint.buffer, g.idx.buffer);
      }
      return withTransfer({ ...res, light, lightH: RH }, transfer);
    },

    farTile(params) {
      if (!generator.farSample) throw new Error('generator has no farSample()');
      const g = buildFarTile((x, z, out) => generator.farSample(x, z, out), params);
      return withTransfer(g, [g.pos.buffer, g.nrm.buffer, g.col.buffer, g.idx.buffer]);
    },

    textures({ names, size }) {
      const out = synthesize(cfg.textureRecipes, names, size);
      const transfer = [];
      for (const t of out) transfer.push(t.albedo.buffer, t.normal.buffer, t.material.buffer);
      return withTransfer(out, transfer);
    },
  });
}
