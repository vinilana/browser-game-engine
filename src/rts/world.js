// Terrain, water, distant scenery and the navigation grid of a "Reinos" map.
import { Mesh, PlaneGeometry } from 'three';
import { Heightfield } from '../engine/terrain/Heightfield.js';
import { TerrainRenderer } from '../engine/terrain/TerrainRenderer.js';
import { FarTerrain } from '../engine/terrain/FarTerrain.js';
import { createWaterMaterial } from '../engine/render/materials/WaterMaterial.js';
import { GridPathfinder } from '../engine/ai/Pathfinder.js';
import { TERRAIN_SCALES } from './textures.js';
import { LAYER } from './mapgen.js';
import { MAP_SIZE, GRID, WATER_LEVEL } from './config.js';

export class World {
  constructor(game, map, assets) {
    this.game = game;
    const pipeline = game.engine.pipeline;
    this.map = map;
    this.size = map.size;
    this.hf = new Heightfield({ size: map.size, cellSize: 1, heights: map.heights });
    this.terrain = new TerrainRenderer({
      pipeline, heightfield: this.hf, layers: assets.terrain, layerScales: TERRAIN_SCALES,
      splat: map.splat, waterLevel: WATER_LEVEL, rockLayer: LAYER.ROCK, chunkCells: 32,
    });
    // water plane (lakes); terrain hides it elsewhere
    const wgeo = new PlaneGeometry(MAP_SIZE + 60, MAP_SIZE + 60, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    wgeo.translate(MAP_SIZE / 2, WATER_LEVEL, MAP_SIZE / 2);
    this.water = new Mesh(wgeo, createWaterMaterial(pipeline, { foam: 0.7 }));
    this.water.frustumCulled = false;
    pipeline.forwardScene.add(this.water);
    // scenery beyond the borders
    this.far = new FarTerrain({
      pipeline, pool: game.pool, radius: 900, tileSize: 256, lods: [[160, 128], [420, 64], [Infinity, 24]],
      exclude: { minX: 0.5, minZ: 0.5, maxX: MAP_SIZE - 0.5, maxZ: MAP_SIZE - 0.5 },
    });
    // navigation grid
    const cells = MAP_SIZE / GRID;
    this.path = new GridPathfinder({ width: cells, height: cells, cellSize: GRID });
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const x = (i + 0.5) * GRID, z = (j + 0.5) * GRID;
        const h = this.hf.heightAt(x, z);
        const slope = this.hf.slopeAt(x, z);
        if (h < WATER_LEVEL + 0.25 || slope > 1.1 || i === 0 || j === 0 || i === cells - 1 || j === cells - 1) {
          this.path.static[j * cells + i] = 1;
        }
      }
    }
  }

  heightAt(x, z) { return this.hf.heightAt(x, z); }

  update(focus) { this.far.update(focus); }

  inside(x, z, margin = 2) { return x > margin && z > margin && x < MAP_SIZE - margin && z < MAP_SIZE - margin; }

  /** Flattens + paints a building site and refreshes the terrain meshes. */
  prepareSite(x, z, size, layer = LAYER.PATH) {
    const half = size / 2;
    const r = this.hf.flatten(x, z, half + 0.5, half + 0.5, 3.5);
    this.terrain.paintRect(x, z, half, half, layer, 2);
    this.terrain.updateRegion(r.minX - 1, r.minZ - 1, r.maxX + 1, r.maxZ + 1);
    return r.height;
  }

  /** True when a square footprint is buildable (dry, gentle, unblocked). */
  canBuild(x, z, size, { ignoreBlocked = false } = {}) {
    const half = size / 2;
    if (x - half < 3 || z - half < 3 || x + half > MAP_SIZE - 3 || z + half > MAP_SIZE - 3) return false;
    let minH = 1e9, maxH = -1e9;
    for (let dz = -half; dz <= half; dz += 1) {
      for (let dx = -half; dx <= half; dx += 1) {
        const h = this.hf.heightAt(x + dx, z + dz);
        minH = Math.min(minH, h); maxH = Math.max(maxH, h);
      }
    }
    if (minH < WATER_LEVEL + 0.4 || maxH - minH > Math.max(2.2, size * 0.28)) return false;
    if (ignoreBlocked) return true;
    const p = this.path;
    const i0 = Math.floor((x - half) / GRID), i1 = Math.floor((x + half - 0.01) / GRID);
    const j0 = Math.floor((z - half) / GRID), j1 = Math.floor((z + half - 0.01) / GRID);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!p.isFree(i, j)) return false;
    return true;
  }
}
