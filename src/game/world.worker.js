// VoxelCraft world worker: terrain generation, lighting, meshing and
// procedural texture synthesis run here.
import { startVoxelWorker } from '../engine/voxel/workerRuntime.js';
import { registry } from './blocks.js';
import { createGenerator } from './worldgen.js';
import { TEXTURE_RECIPES } from './textures.js';

startVoxelWorker({ registry, createGenerator, textureRecipes: TEXTURE_RECIPES });
