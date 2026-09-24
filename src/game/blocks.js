// Block palette of the VoxelCraft demo.
import { BlockRegistry, RenderType as R, Tint, Waving } from '../engine/voxel/BlockRegistry.js';
import { TEXTURE_NAMES } from './textures.js';

const FOLIAGE = 1, PLANT = 2;

/** @type {import('../engine/voxel/BlockRegistry.js').BlockDef[]} */
export const BLOCK_DEFS = [
  { name: 'air', label: 'Ar', render: R.NONE, solid: false, lightOpacity: 0 },
  { name: 'stone', label: 'Pedra', textures: 'stone', sound: 'stone', hardness: 1.5 },
  { name: 'grass_block', label: 'Grama', textures: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, tint: Tint.MASKED_GRASS, sound: 'grass', hardness: 0.6 },
  { name: 'dirt', label: 'Terra', textures: 'dirt', sound: 'gravel', hardness: 0.5 },
  { name: 'cobblestone', label: 'Pedregulho', textures: 'cobblestone', sound: 'stone', hardness: 2 },
  { name: 'oak_planks', label: 'Tábuas de Carvalho', textures: 'oak_planks', sound: 'wood', hardness: 2 },
  { name: 'bedrock', label: 'Rocha-mãe', textures: 'bedrock', sound: 'stone', hardness: -1, creative: false },
  { name: 'sand', label: 'Areia', textures: 'sand', sound: 'sand', hardness: 0.5 },
  { name: 'gravel', label: 'Cascalho', textures: 'gravel', sound: 'gravel', hardness: 0.6 },
  { name: 'oak_log', label: 'Tronco de Carvalho', textures: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' }, sound: 'wood', hardness: 2 },
  { name: 'oak_leaves', label: 'Folhas de Carvalho', render: R.CUTOUT, textures: 'oak_leaves', tint: Tint.FOLIAGE, waving: Waving.LEAVES, lightOpacity: 1, matFlags: FOLIAGE, sound: 'grass', hardness: 0.2 },
  { name: 'birch_log', label: 'Tronco de Bétula', textures: { top: 'birch_log_top', bottom: 'birch_log_top', side: 'birch_log' }, sound: 'wood', hardness: 2 },
  { name: 'birch_leaves', label: 'Folhas de Bétula', render: R.CUTOUT, textures: 'birch_leaves', waving: Waving.LEAVES, lightOpacity: 1, matFlags: FOLIAGE, sound: 'grass', hardness: 0.2 },
  { name: 'spruce_log', label: 'Tronco de Pinheiro', textures: { top: 'spruce_log_top', bottom: 'spruce_log_top', side: 'spruce_log' }, sound: 'wood', hardness: 2 },
  { name: 'spruce_leaves', label: 'Folhas de Pinheiro', render: R.CUTOUT, textures: 'spruce_leaves', waving: Waving.LEAVES, lightOpacity: 1, matFlags: FOLIAGE, sound: 'grass', hardness: 0.2 },
  { name: 'glass', label: 'Vidro', render: R.GLASS, textures: 'glass', lightOpacity: 0, sound: 'glass', hardness: 0.3 },
  { name: 'water', label: 'Água', render: R.LIQUID, textures: 'water', liquid: true, solid: false, lightOpacity: 1, sound: 'water' },
  { name: 'sandstone', label: 'Arenito', textures: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' }, sound: 'stone', hardness: 0.8 },
  { name: 'snow_block', label: 'Neve', textures: 'snow', sound: 'snow', hardness: 0.2 },
  { name: 'snowy_grass', label: 'Grama com Neve', textures: { top: 'snow', side: 'grass_snow_side', bottom: 'dirt' }, sound: 'snow', hardness: 0.6 },
  { name: 'ice', label: 'Gelo', textures: 'ice', sound: 'glass', hardness: 0.5 },
  { name: 'clay', label: 'Argila', textures: 'clay', sound: 'gravel', hardness: 0.6 },
  { name: 'coal_ore', label: 'Minério de Carvão', textures: 'coal_ore', sound: 'stone', hardness: 3 },
  { name: 'iron_ore', label: 'Minério de Ferro', textures: 'iron_ore', sound: 'stone', hardness: 3 },
  { name: 'gold_ore', label: 'Minério de Ouro', textures: 'gold_ore', sound: 'stone', hardness: 3 },
  { name: 'diamond_ore', label: 'Minério de Diamante', textures: 'diamond_ore', sound: 'stone', hardness: 3 },
  { name: 'bricks', label: 'Tijolos', textures: 'bricks', sound: 'stone', hardness: 2 },
  { name: 'mossy_cobblestone', label: 'Pedregulho Musgoso', textures: 'mossy_cobblestone', sound: 'stone', hardness: 2 },
  { name: 'stone_bricks', label: 'Tijolos de Pedra', textures: 'stone_bricks', sound: 'stone', hardness: 1.5 },
  { name: 'torch', label: 'Tocha', render: R.TORCH, textures: 'torch', solid: false, emission: 14, lightOpacity: 0, sound: 'wood', hardness: 0 },
  { name: 'glowstone', label: 'Pedra Luminosa', textures: 'glowstone', emission: 15, sound: 'glass', hardness: 0.3 },
  { name: 'lava', label: 'Lava', render: R.OPAQUE, textures: 'lava', liquid: true, solid: false, emission: 15, lightOpacity: 15, opaque: true, sound: 'lava' },
  { name: 'tall_grass', label: 'Grama Alta', render: R.CROSS, textures: 'tall_grass', tint: Tint.GRASS, waving: Waving.PLANT, matFlags: PLANT, replaceable: true, sound: 'grass', hardness: 0 },
  { name: 'fern', label: 'Samambaia', render: R.CROSS, textures: 'fern', tint: Tint.GRASS, waving: Waving.PLANT, matFlags: PLANT, replaceable: true, sound: 'grass', hardness: 0 },
  { name: 'dandelion', label: 'Dente-de-leão', render: R.CROSS, textures: 'dandelion', waving: Waving.PLANT, matFlags: PLANT, sound: 'grass', hardness: 0 },
  { name: 'poppy', label: 'Papoula', render: R.CROSS, textures: 'poppy', waving: Waving.PLANT, matFlags: PLANT, sound: 'grass', hardness: 0 },
  { name: 'cornflower', label: 'Centáurea', render: R.CROSS, textures: 'cornflower', waving: Waving.PLANT, matFlags: PLANT, sound: 'grass', hardness: 0 },
  { name: 'dead_bush', label: 'Arbusto Seco', render: R.CROSS, textures: 'dead_bush', waving: Waving.PLANT, matFlags: PLANT, replaceable: true, sound: 'grass', hardness: 0 },
  { name: 'sugar_cane', label: 'Cana-de-açúcar', render: R.CROSS, textures: 'sugar_cane', waving: Waving.PLANT_TALL, matFlags: PLANT, sound: 'grass', hardness: 0 },
  { name: 'cactus', label: 'Cacto', render: R.CACTUS, textures: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' }, opaque: false, lightOpacity: 0, sound: 'wool', hardness: 0.4 },
  { name: 'pumpkin', label: 'Abóbora', textures: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' }, sound: 'wood', hardness: 1 },
  { name: 'iron_block', label: 'Bloco de Ferro', textures: 'iron_block', sound: 'metal', hardness: 5 },
  { name: 'gold_block', label: 'Bloco de Ouro', textures: 'gold_block', sound: 'metal', hardness: 3 },
  { name: 'diamond_block', label: 'Bloco de Diamante', textures: 'diamond_block', sound: 'metal', hardness: 5 },
  { name: 'obsidian', label: 'Obsidiana', textures: 'obsidian', sound: 'stone', hardness: 50 },
  { name: 'white_wool', label: 'Lã Branca', textures: 'white_wool', sound: 'wool', hardness: 0.8 },
  { name: 'granite', label: 'Granito', textures: 'granite', sound: 'stone', hardness: 1.5 },
  { name: 'andesite', label: 'Andesito', textures: 'andesite', sound: 'stone', hardness: 1.5 },
  { name: 'diorite', label: 'Diorito', textures: 'diorite', sound: 'stone', hardness: 1.5 },
  { name: 'birch_planks', label: 'Tábuas de Bétula', textures: 'birch_planks', sound: 'wood', hardness: 2 },
  { name: 'spruce_planks', label: 'Tábuas de Pinheiro', textures: 'spruce_planks', sound: 'wood', hardness: 2 },
  { name: 'bookshelf', label: 'Estante', textures: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' }, sound: 'wood', hardness: 1.5 },
  { name: 'coarse_dirt', label: 'Terra Grossa', textures: 'coarse_dirt', sound: 'gravel', hardness: 0.5 },
  { name: 'moss_block', label: 'Bloco de Musgo', textures: 'moss_block', sound: 'grass', hardness: 0.1 },
  { name: 'podzol', label: 'Podzol', textures: { top: 'podzol_top', side: 'dirt', bottom: 'dirt' }, sound: 'gravel', hardness: 0.5 },
  { name: 'red_sand', label: 'Areia Vermelha', textures: 'red_sand', sound: 'sand', hardness: 0.5 },
  { name: 'emerald_ore', label: 'Minério de Esmeralda', textures: 'emerald_ore', sound: 'stone', hardness: 3 },
  { name: 'copper_block', label: 'Bloco de Cobre', textures: 'copper_block', sound: 'metal', hardness: 3 },
  { name: 'allium', label: 'Alho-ornamental', render: R.CROSS, textures: 'allium', waving: Waving.PLANT, matFlags: PLANT, sound: 'grass', hardness: 0 },
  { name: 'crafting_table', label: 'Bancada', textures: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'oak_planks' }, sound: 'wood', hardness: 2.5 },
];

// Flowing water levels (1..7) and falling water (8, not a source).
for (let l = 1; l <= 8; l++) {
  BLOCK_DEFS.push({ name: `water_flow_${l}`, label: 'Água corrente', render: R.LIQUID, textures: 'water', liquid: true, level: l, solid: false, lightOpacity: 1, sound: 'water', creative: false, flowing: true });
}

export const registry = new BlockRegistry(BLOCK_DEFS, TEXTURE_NAMES);

/** Block ids by name for convenient use in game code. */
export const B = Object.fromEntries(BLOCK_DEFS.map((d, i) => [d.name, i]));
