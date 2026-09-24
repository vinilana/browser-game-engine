// Minecraft-like water flow: sources spread up to 7 blocks horizontally,
// fall down as "falling water" and drain when their supply is removed.
const TICK = 0.25;          // seconds between fluid ticks
const MAX_PER_TICK = 400;   // cell updates per tick
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Fluids {
  constructor(game) {
    this.game = game;
    const reg = game.registry;
    this.source = reg.byName.get('water');
    this.flow = [0];
    for (let l = 1; l <= 8; l++) this.flow[l] = reg.byName.get(`water_flow_${l}`);
    this.levelOf = new Int8Array(256);
    this.levelOf[this.source] = 9;             // 9 = source
    for (let l = 1; l <= 8; l++) this.levelOf[this.flow[l]] = l;
    this.pending = new Map();
    this.timer = 0;
    this.enabled = true;
    game.world.on('blockChanged', (e) => this.onChange(e));
  }

  _key(x, y, z) { return `${x},${y},${z}`; }

  schedule(x, y, z) {
    this.pending.set(this._key(x, y, z), [x, y, z]);
  }

  onChange({ x, y, z }) {
    if (this._applying) return;
    this.schedule(x, y, z);
    for (const [dx, dz] of DIRS) this.schedule(x + dx, y, z + dz);
    this.schedule(x, y + 1, z);
    this.schedule(x, y - 1, z);
  }

  _isWater(id) { return this.levelOf[id] > 0; }

  /** Level this cell should have given its neighbours (0 = dry). */
  _desired(x, y, z) {
    const w = this.game.world;
    const reg = this.game.registry;
    const above = w.getBlock(x, y + 1, z);
    if (this._isWater(above)) return 8;
    let best = 0;
    for (const [dx, dz] of DIRS) {
      const n = w.getBlock(x + dx, y, z + dz);
      const ln = this.levelOf[n];
      if (!ln) continue;
      // water only spreads sideways when it rests on something
      const below = w.getBlock(x + dx, y - 1, z + dz);
      const resting = reg.solid[below] || this.levelOf[below] === 9 || (reg.opaque[below] && !reg.liquid[below]);
      if (!resting) continue;
      const lv = ln >= 8 ? 7 : ln - 1;
      if (lv > best) best = lv;
    }
    return best;
  }

  update(dt) {
    if (!this.enabled || this.pending.size === 0) return;
    this.timer += dt;
    if (this.timer < TICK) return;
    this.timer = 0;
    const w = this.game.world;
    const reg = this.game.registry;
    const batch = [];
    for (const [k, v] of this.pending) {
      batch.push(v);
      this.pending.delete(k);
      if (batch.length >= MAX_PER_TICK) break;
    }
    const changes = [];
    for (const [x, y, z] of batch) {
      if (y < 1 || y > 250 || !w.isColumnReady(x, z)) continue;
      const id = w.getBlock(x, y, z);
      const lv = this.levelOf[id];
      if (lv === 9) continue; // sources never change on their own
      const replaceable = id === 0 || (reg.replaceable[id] && !reg.liquid[id]);
      if (!lv && !replaceable) continue;
      const want = this._desired(x, y, z);
      if (want === lv) continue;
      if (want === 0) { if (lv) changes.push([x, y, z, 0]); }
      else changes.push([x, y, z, this.flow[want]]);
    }
    for (const [x, y, z, id] of changes) {
      this._applying = true;
      w.setBlock(x, y, z, id, { record: true });
      this._applying = false;
      for (const [dx, dz] of DIRS) this.schedule(x + dx, y, z + dz);
      this.schedule(x, y - 1, z);
      this.schedule(x, y + 1, z);
    }
  }
}
