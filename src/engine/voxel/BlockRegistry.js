// Block definitions compiled into flat typed arrays for fast access in the
// mesher / lighting / physics (usable in workers and on the main thread).

export const RenderType = {
  NONE: 0,     // air / invisible
  OPAQUE: 1,   // full opaque cube
  CUTOUT: 2,   // full cube with alpha-tested texture (leaves)
  CROSS: 3,    // two crossed quads (grass, flowers)
  LIQUID: 4,   // water-like translucent volume
  GLASS: 5,    // translucent cube
  TORCH: 6,    // small emissive stick
  CACTUS: 7,   // cube with inset sides
  SLAB: 8,     // bottom half block
  LAYER: 9,    // thin layer on top of a block (snow)
};

export const Face = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 };
export const FACE_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export const Tint = { NONE: 0, GRASS: 1, FOLIAGE: 2, MASKED_GRASS: 3, WATER: 4 };
export const Waving = { NONE: 0, LEAVES: 1, PLANT: 2, PLANT_TALL: 3 };

/**
 * @typedef {Object} BlockDef
 * @property {string} name
 * @property {string} [label]
 * @property {number} [render]
 * @property {boolean} [solid]
 * @property {boolean} [opaque]
 * @property {number} [lightOpacity]   0..15
 * @property {number} [emission]       0..15
 * @property {string|Object} [textures] texture name or {top,bottom,side,north,south,east,west}
 * @property {number} [tint]
 * @property {number} [waving]
 * @property {number} [matFlags]
 * @property {string} [sound]
 * @property {number} [hardness]
 * @property {boolean} [replaceable]
 * @property {boolean} [liquid]
 * @property {boolean} [creative]    shown in the inventory
 */

export class BlockRegistry {
  /**
   * @param {BlockDef[]} defs  index = block id (0 must be air)
   * @param {string[]} textureNames ordered texture layer names
   */
  constructor(defs, textureNames) {
    this.defs = defs;
    this.textureNames = textureNames;
    this.textureIndex = new Map(textureNames.map((n, i) => [n, i]));
    this.byName = new Map();
    const N = 256;
    this.renderType = new Uint8Array(N);
    this.solid = new Uint8Array(N);
    this.opaque = new Uint8Array(N);
    this.lightOpacity = new Uint8Array(N);
    this.emission = new Uint8Array(N);
    this.tint = new Uint8Array(N);
    this.waving = new Uint8Array(N);
    this.matFlags = new Uint8Array(N);
    this.liquid = new Uint8Array(N);
    this.liquidLevel = new Uint8Array(N);   // 8 = source/falling, 1..7 = flowing
    this.replaceable = new Uint8Array(N);
    this.selectable = new Uint8Array(N);
    this.faceLayer = new Uint16Array(N * 6);
    this.hardness = new Float32Array(N);

    defs.forEach((d, id) => {
      if (!d) return;
      d.id = id;
      this.byName.set(d.name, id);
      const render = d.render ?? RenderType.OPAQUE;
      this.renderType[id] = render;
      const opaque = d.opaque ?? (render === RenderType.OPAQUE);
      this.opaque[id] = opaque ? 1 : 0;
      this.solid[id] = (d.solid ?? (render !== RenderType.NONE && render !== RenderType.CROSS && render !== RenderType.LIQUID && render !== RenderType.TORCH)) ? 1 : 0;
      this.lightOpacity[id] = d.lightOpacity ?? (opaque ? 15 : 0);
      this.emission[id] = d.emission ?? 0;
      this.tint[id] = d.tint ?? Tint.NONE;
      this.waving[id] = d.waving ?? Waving.NONE;
      this.matFlags[id] = d.matFlags ?? 0;
      this.liquid[id] = d.liquid ? 1 : 0;
      this.liquidLevel[id] = d.liquid ? (d.level ?? 8) : 0;
      this.replaceable[id] = (d.replaceable ?? (render === RenderType.NONE || render === RenderType.LIQUID)) ? 1 : 0;
      this.selectable[id] = (render !== RenderType.NONE && render !== RenderType.LIQUID) ? 1 : 0;
      this.hardness[id] = d.hardness ?? 1;
      const t = d.textures;
      if (t) {
        const faces = typeof t === 'string'
          ? [t, t, t, t, t, t]
          : [
            t.east ?? t.side ?? t.all, t.west ?? t.side ?? t.all,
            t.top ?? t.all ?? t.side, t.bottom ?? t.all ?? t.top ?? t.side,
            t.south ?? t.side ?? t.all, t.north ?? t.side ?? t.all,
          ];
        for (let f = 0; f < 6; f++) {
          const idx = this.textureIndex.get(faces[f]);
          if (idx === undefined) throw new Error(`Block ${d.name}: unknown texture "${faces[f]}"`);
          this.faceLayer[id * 6 + f] = idx;
        }
      }
    });
  }

  id(name) {
    const v = this.byName.get(name);
    if (v === undefined) throw new Error('Unknown block ' + name);
    return v;
  }

  get(id) { return this.defs[id]; }
}
