// Game data for "Reinos" — an Age of Empires-like RTS on the Aether Engine.
// Distances in meters (1 AoE tile ~ 2 m), times in seconds.

export const MAP_SIZE = 288;          // playable square (meters)
export const GRID = 2;                // path-finding cell size
export const WATER_LEVEL = 0;
export const GAME_SPEED = 1.6;        // simulation speed multiplier

export const RES = ['food', 'wood', 'gold', 'stone'];
export const RES_LABEL = { food: 'Comida', wood: 'Madeira', gold: 'Ouro', stone: 'Pedra' };

export const TEAMS = [
  { name: 'Você', color: [0.12, 0.32, 0.85], css: '#2f6fe8' },
  { name: 'Inimigo', color: [0.8, 0.12, 0.1], css: '#d9362b' },
  { name: 'Natureza', color: [0.9, 0.9, 0.9], css: '#dddddd' },
];

export const AGES = [
  { name: 'Idade das Trevas' },
  { name: 'Idade Feudal', cost: { food: 500 }, time: 70, requires: 2 },
  { name: 'Idade dos Castelos', cost: { food: 800, gold: 200 }, time: 100, requires: 2 },
];

/**
 * Units. speed m/s, range m (0 = melee ~1.2 m), attack per hit, rate hits/s, los m.
 * bonus: { armorClass: extra damage }
 */
export const UNITS = {
  villager: {
    label: 'Aldeão', model: 'villager', hp: 25, attack: 3, armor: 0, pierceArmor: 0, range: 0, rate: 0.5, speed: 1.6,
    los: 16, cost: { food: 50 }, time: 25, pop: 1, radius: 0.35, classes: ['infantry', 'villager'],
    desc: 'Coleta recursos e constrói.',
  },
  militia: {
    label: 'Milícia', model: 'swordsman', hp: 45, attack: 5, armor: 0, pierceArmor: 1, range: 0, rate: 0.5, speed: 1.8,
    los: 16, cost: { food: 60, gold: 20 }, time: 21, pop: 1, radius: 0.38, classes: ['infantry'],
    desc: 'Infantaria corpo a corpo básica.',
  },
  spearman: {
    label: 'Lanceiro', model: 'spearman', hp: 45, attack: 3, armor: 0, pierceArmor: 0, range: 0.4, rate: 0.33, speed: 2.0,
    los: 16, cost: { food: 35, wood: 25 }, time: 22, pop: 1, radius: 0.38, classes: ['infantry', 'spear'],
    bonus: { cavalry: 15 }, age: 1, desc: 'Barato e forte contra cavalaria.',
  },
  archer: {
    label: 'Arqueiro', model: 'archer', hp: 30, attack: 4, armor: 0, pierceArmor: 0, range: 16, rate: 0.5, speed: 1.9,
    los: 20, cost: { wood: 25, gold: 45 }, time: 30, pop: 1, radius: 0.35, classes: ['archer'], projectile: 'arrow',
    bonus: { spear: 3 }, age: 1, desc: 'Ataque à distância.',
  },
  scout: {
    label: 'Cavalaria Batedora', model: 'scout', hp: 45, attack: 3, armor: 0, pierceArmor: 2, range: 0, rate: 0.5, speed: 3.2,
    los: 24, cost: { food: 80 }, time: 25, pop: 1, radius: 0.7, classes: ['cavalry'], age: 1,
    desc: 'Rápida, ótima para explorar.',
  },
  knight: {
    label: 'Cavaleiro', model: 'knight', hp: 100, attack: 10, armor: 2, pierceArmor: 2, range: 0, rate: 0.55, speed: 2.8,
    los: 18, cost: { food: 60, gold: 75 }, time: 30, pop: 1, radius: 0.75, classes: ['cavalry'], age: 2,
    desc: 'Cavalaria pesada e poderosa.',
  },
  // gaia
  sheep: { label: 'Ovelha', model: 'sheep', hp: 7, attack: 0, armor: 0, pierceArmor: 0, range: 0, rate: 0, speed: 1.2, los: 6, radius: 0.45, food: 100, classes: ['animal'], herdable: true },
  deer: { label: 'Cervo', model: 'deer', hp: 5, attack: 0, armor: 0, pierceArmor: 0, range: 0, rate: 0, speed: 2.4, los: 8, radius: 0.5, food: 140, classes: ['animal'] },
};

/** Buildings. size = footprint side (m). */
export const BUILDINGS = {
  town_center: {
    label: 'Centro da Cidade', hp: 2400, size: 14, cost: { wood: 275, stone: 100 }, time: 150, pop: 5, los: 30,
    drop: ['food', 'wood', 'gold', 'stone'], train: ['villager'], attack: 5, range: 18, rate: 0.5, age: 0,
    desc: 'Treina aldeões, recebe todos os recursos e avança de era.',
  },
  house: { label: 'Casa', hp: 550, size: 6, cost: { wood: 25 }, time: 25, pop: 5, los: 8, desc: '+5 de população.' },
  lumber_camp: { label: 'Serraria', hp: 600, size: 8, cost: { wood: 100 }, time: 35, los: 8, drop: ['wood'], desc: 'Depósito de madeira.' },
  mill: { label: 'Moinho', hp: 600, size: 8, cost: { wood: 100 }, time: 35, los: 8, drop: ['food'], desc: 'Depósito de comida; permite fazendas.' },
  mining_camp: { label: 'Campo de Mineração', hp: 600, size: 8, cost: { wood: 100 }, time: 35, los: 8, drop: ['gold', 'stone'], desc: 'Depósito de ouro e pedra.' },
  farm: { label: 'Fazenda', hp: 480, size: 10, cost: { wood: 60 }, time: 15, los: 2, food: 175, requiresBuilding: 'mill', passable: true, desc: 'Fonte renovável de comida.' },
  barracks: { label: 'Quartel', hp: 1200, size: 11, cost: { wood: 175 }, time: 50, los: 10, train: ['militia', 'spearman'], desc: 'Treina infantaria.' },
  archery_range: { label: 'Campo de Arqueiros', hp: 1200, size: 11, cost: { wood: 175 }, time: 50, los: 10, train: ['archer'], age: 1, requiresBuilding: 'barracks', desc: 'Treina arqueiros.' },
  stable: { label: 'Estábulo', hp: 1200, size: 11, cost: { wood: 175 }, time: 50, los: 10, train: ['scout', 'knight'], age: 1, requiresBuilding: 'barracks', desc: 'Treina cavalaria.' },
  watch_tower: { label: 'Torre de Vigia', hp: 700, size: 5, cost: { wood: 25, stone: 125 }, time: 60, los: 26, attack: 5, range: 20, rate: 0.5, age: 1, desc: 'Defesa com flechas.' },
};

export const RESOURCES = {
  tree: { label: 'Árvore', res: 'wood', amount: 100 },
  gold: { label: 'Mina de Ouro', res: 'gold', amount: 800 },
  stone: { label: 'Mina de Pedra', res: 'stone', amount: 350 },
  berry: { label: 'Arbusto de Frutas', res: 'food', amount: 125 },
  carcass: { label: 'Carcaça', res: 'food', amount: 100, decay: 0.25 },
  farm: { label: 'Fazenda', res: 'food', amount: 175 },
};

export const GATHER_RATE = { tree: 0.39, gold: 0.38, stone: 0.36, berry: 0.31, carcass: 0.42, farm: 0.33 };
export const CARRY = 10;
export const BUILD_RATE = 1;       // build-seconds per villager-second
export const START_RES = { food: 200, wood: 200, gold: 100, stone: 200 };
export const POP_CAP = 200;

/** Armor classes attacked by bonus damage. */
export function damage(attacker, target) {
  const a = attacker.def;
  const ranged = a.range > 2;
  let dmg = a.attack - (ranged ? (target.def.pierceArmor || 0) : (target.def.armor || 0));
  if (a.bonus && target.def.classes) for (const c of target.def.classes) dmg += a.bonus[c] || 0;
  return Math.max(1, dmg);
}
