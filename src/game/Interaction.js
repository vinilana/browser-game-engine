import { LineSegments, EdgesGeometry, BoxGeometry, LineBasicMaterial, Vector3 } from 'three';
import { RenderType } from '../engine/voxel/BlockRegistry.js';

const REACH = 6;

/** Block targeting, breaking, placing and picking. */
export class Interaction {
  constructor(game) {
    this.game = game;
    const { engine } = game;
    const geo = new EdgesGeometry(new BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new LineSegments(geo, new LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }));
    this.outline.visible = false;
    this.outline.renderOrder = 5;
    engine.forwardScene.add(this.outline);
    this.target = null;
    this.breakCooldown = 0;
    this.placeCooldown = 0;
    this._dir = new Vector3();
  }

  update(dt) {
    const { engine, world, registry, player } = this.game;
    const input = engine.input;
    const cam = engine.camera;
    this.breakCooldown -= dt;
    this.placeCooldown -= dt;
    cam.getWorldDirection(this._dir);
    const hit = world.raycast(cam.position, this._dir, REACH);
    this.target = hit;
    if (hit) {
      const rt = registry.renderType[hit.id];
      this.outline.visible = true;
      if (rt === RenderType.CROSS || rt === RenderType.TORCH) {
        this.outline.scale.set(rt === RenderType.TORCH ? 0.2 : 0.8, rt === RenderType.TORCH ? 0.65 : 0.85, rt === RenderType.TORCH ? 0.2 : 0.8);
        this.outline.position.set(hit.x + 0.5, hit.y + this.outline.scale.y / 2, hit.z + 0.5);
      } else {
        this.outline.scale.set(1, 1, 1);
        this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      }
      this.outline.updateMatrix();
    } else {
      this.outline.visible = false;
    }
    if (!input.locked || this.game.ui.blocking) return;

    // break
    if (hit && input.isButtonDown(0) && this.breakCooldown <= 0) {
      const def = registry.get(hit.id);
      if (def && def.hardness >= 0) {
        this.breakCooldown = input.wasButtonPressed(0) ? 0.22 : 0.26;
        world.setBlock(hit.x, hit.y, hit.z, 0);
        this.game.onBlockBroken(hit.x, hit.y, hit.z, hit.id);
        // plants on top pop off
        const above = world.getBlock(hit.x, hit.y + 1, hit.z);
        const art = registry.renderType[above];
        if (art === RenderType.CROSS || art === RenderType.TORCH) {
          world.setBlock(hit.x, hit.y + 1, hit.z, 0);
          this.game.onBlockBroken(hit.x, hit.y + 1, hit.z, above);
        }
      }
    }
    if (!input.isButtonDown(0)) this.breakCooldown = Math.min(this.breakCooldown, 0);

    // place
    if (hit && (input.wasButtonPressed(2) || (input.isButtonDown(2) && this.placeCooldown <= 0))) {
      this.placeCooldown = input.wasButtonPressed(2) ? 0.25 : 0.2;
      const id = this.game.ui.selectedBlock();
      if (id) this._place(hit, id);
    }

    // pick block
    if (hit && input.wasButtonPressed(1)) this.game.ui.pickBlock(hit.id);
  }

  _place(hit, id) {
    const { world, registry, player } = this.game;
    let x = hit.x, y = hit.y, z = hit.z;
    if (!registry.replaceable[hit.id]) { x += hit.nx; y += hit.ny; z += hit.nz; }
    const cur = world.getBlock(x, y, z);
    if (cur !== 0 && !registry.replaceable[cur]) return;
    const rt = registry.renderType[id];
    if (rt === RenderType.CROSS || rt === RenderType.TORCH) {
      const below = world.getBlock(x, y - 1, z);
      if (!registry.solid[below] || !registry.opaque[below]) return;
    }
    // don't place into the player
    if (registry.solid[id]) {
      const p = player.body.position;
      const hw = player.body.width / 2;
      if (x + 1 > p.x - hw && x < p.x + hw && z + 1 > p.z - hw && z < p.z + hw && y + 1 > p.y && y < p.y + player.body.height) return;
    }
    if (world.setBlock(x, y, z, id)) this.game.onBlockPlaced(x, y, z, id);
  }
}
