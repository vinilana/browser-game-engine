// Grid A* path finding (8-connected, octile heuristic, binary heap) with
// line-of-sight path smoothing. Cells hold an occupancy count so several
// obstacles (buildings, trees, water...) can overlap and be removed again.

export class GridPathfinder {
  /**
   * @param {{width:number, height:number, cellSize:number, originX?:number, originZ?:number}} o
   */
  constructor({ width, height, cellSize, originX = 0, originZ = 0 }) {
    this.w = width;
    this.h = height;
    this.cs = cellSize;
    this.ox = originX;
    this.oz = originZ;
    const n = width * height;
    this.blocked = new Uint16Array(n);   // occupancy counter (0 = free)
    this.static = new Uint8Array(n);     // terrain blocking (water / cliffs)
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.visit = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 1;
    this.heap = new Int32Array(n);
    this.heapF = new Float32Array(n);
    this.heapPos = new Int32Array(n);
    this.heapSize = 0;
    this.maxExpansions = 60000;
  }

  cellOf(x, z) {
    return [Math.floor((x - this.ox) / this.cs), Math.floor((z - this.oz) / this.cs)];
  }

  centerOf(i, j) { return [this.ox + (i + 0.5) * this.cs, this.oz + (j + 0.5) * this.cs]; }

  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h; }

  isFree(i, j) {
    if (!this.inBounds(i, j)) return false;
    const k = j * this.w + i;
    return this.blocked[k] === 0 && this.static[k] === 0;
  }

  isFreeAt(x, z) { const [i, j] = this.cellOf(x, z); return this.isFree(i, j); }

  /** Adds (+1) or removes (-1) an occupant over a world rectangle. */
  markRect(minX, minZ, maxX, maxZ, delta = 1) {
    const i0 = Math.max(0, Math.floor((minX - this.ox) / this.cs));
    const i1 = Math.min(this.w - 1, Math.floor((maxX - this.ox - 1e-4) / this.cs));
    const j0 = Math.max(0, Math.floor((minZ - this.oz) / this.cs));
    const j1 = Math.min(this.h - 1, Math.floor((maxZ - this.oz - 1e-4) / this.cs));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.w + i;
        this.blocked[k] = Math.max(0, this.blocked[k] + delta);
      }
    }
  }

  markCircle(x, z, r, delta = 1) {
    const i0 = Math.max(0, Math.floor((x - r - this.ox) / this.cs)), i1 = Math.min(this.w - 1, Math.floor((x + r - this.ox) / this.cs));
    const j0 = Math.max(0, Math.floor((z - r - this.oz) / this.cs)), j1 = Math.min(this.h - 1, Math.floor((z + r - this.oz) / this.cs));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const [cx, cz] = this.centerOf(i, j);
        if (Math.hypot(cx - x, cz - z) > r + this.cs * 0.35) continue;
        const k = j * this.w + i;
        this.blocked[k] = Math.max(0, this.blocked[k] + delta);
      }
    }
  }

  /** Nearest free cell to (x,z) searching outward in rings. */
  nearestFree(x, z, maxRadius = 40) {
    const [ci, cj] = this.cellOf(x, z);
    if (this.isFree(ci, cj)) return [ci, cj];
    for (let r = 1; r <= maxRadius; r++) {
      let best = null, bd = 1e9;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (!this.isFree(i, j)) continue;
          const [cx, cz] = this.centerOf(i, j);
          const d = (cx - x) ** 2 + (cz - z) ** 2;
          if (d < bd) { bd = d; best = [i, j]; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  _push(k, f) {
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapF[p] <= f) break;
      this.heap[i] = this.heap[p]; this.heapF[i] = this.heapF[p]; this.heapPos[this.heap[i]] = i;
      i = p;
    }
    this.heap[i] = k; this.heapF[i] = f; this.heapPos[k] = i;
  }

  _decrease(k, f) {
    let i = this.heapPos[k];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapF[p] <= f) break;
      this.heap[i] = this.heap[p]; this.heapF[i] = this.heapF[p]; this.heapPos[this.heap[i]] = i;
      i = p;
    }
    this.heap[i] = k; this.heapF[i] = f; this.heapPos[k] = i;
  }

  _pop() {
    const top = this.heap[0];
    const last = this.heap[--this.heapSize];
    const lf = this.heapF[this.heapSize];
    let i = 0;
    const n = this.heapSize;
    while (true) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && this.heapF[c + 1] < this.heapF[c]) c++;
      if (this.heapF[c] >= lf) break;
      this.heap[i] = this.heap[c]; this.heapF[i] = this.heapF[c]; this.heapPos[this.heap[i]] = i;
      i = c;
    }
    if (n > 0) { this.heap[i] = last; this.heapF[i] = lf; this.heapPos[last] = i; }
    return top;
  }

  /**
   * Finds a path between world positions. If the goal cell is blocked, the
   * closest reachable cell to it is used. Returns world waypoints [[x,z]...]
   * (excluding the start) or null.
   * @param {{ignoreGoalBlock?: boolean}} opts
   */
  findPath(sx, sz, gx, gz, opts = {}) {
    let [si, sj] = this.cellOf(sx, sz);
    if (!this.isFree(si, sj)) {
      const f = this.nearestFree(sx, sz, 6);
      if (!f) return null;
      [si, sj] = f;
    }
    let [ti, tj] = this.cellOf(gx, gz);
    ti = Math.max(0, Math.min(this.w - 1, ti));
    tj = Math.max(0, Math.min(this.h - 1, tj));
    const goalBlocked = !this.isFree(ti, tj);
    const w = this.w;
    const start = sj * w + si, goal = tj * w + ti;
    if (start === goal) return [[gx, gz]];
    const gen = ++this.gen;
    this.heapSize = 0;
    const h = (i, j) => {
      const dx = Math.abs(i - ti), dz = Math.abs(j - tj);
      return (dx + dz + (1.4142 - 2) * Math.min(dx, dz)) * 1.001;
    };
    this.g[start] = 0;
    this.visit[start] = gen;
    this.parent[start] = -1;
    this._push(start, h(si, sj));
    let best = start, bestH = h(si, sj);
    let expansions = 0;
    let found = false;
    while (this.heapSize > 0) {
      const k = this._pop();
      if (this.closed[k] === gen) continue;
      this.closed[k] = gen;
      const i = k % w, j = (k / w) | 0;
      const hk = h(i, j);
      if (hk < bestH) { bestH = hk; best = k; }
      if (k === goal) { found = true; break; }
      // adjacent to a blocked goal is good enough
      if (goalBlocked && Math.abs(i - ti) <= 1 && Math.abs(j - tj) <= 1) { best = k; found = true; break; }
      if (++expansions > this.maxExpansions) break;
      const gk = this.g[k];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj;
          if (!this.isFree(ni, nj)) {
            if (!(goalBlocked && ni === ti && nj === tj)) continue;
            continue;
          }
          // no corner cutting
          if (di && dj && (!this.isFree(i + di, j) || !this.isFree(i, j + dj))) continue;
          const nk = nj * w + ni;
          if (this.closed[nk] === gen) continue;
          const ng = gk + (di && dj ? 1.4142 : 1);
          if (this.visit[nk] !== gen) {
            this.visit[nk] = gen;
            this.g[nk] = ng;
            this.parent[nk] = k;
            this._push(nk, ng + h(ni, nj));
          } else if (ng < this.g[nk]) {
            this.g[nk] = ng;
            this.parent[nk] = k;
            this._decrease(nk, ng + h(ni, nj));
          }
        }
      }
    }
    const end = found ? (goalBlocked ? best : goal) : best;
    if (end === start && !found) return null;
    // rebuild
    const cells = [];
    for (let k = end; k !== -1; k = this.parent[k]) cells.push(k);
    cells.reverse();
    // smooth with line of sight
    const pts = [];
    let anchor = 0;
    for (let c = 2; c < cells.length; c++) {
      if (!this.lineOfSight(cells[anchor], cells[c])) {
        pts.push(cells[c - 1]);
        anchor = c - 1;
      }
    }
    if (cells.length > 1) pts.push(cells[cells.length - 1]);
    const out = pts.map((k) => this.centerOf(k % w, (k / w) | 0));
    if (found && !goalBlocked && out.length) out[out.length - 1] = [gx, gz];
    return out.length ? out : [[gx, gz]];
  }

  /** Supercover grid traversal between two cells. */
  lineOfSight(a, b) {
    const w = this.w;
    let x0 = a % w, y0 = (a / w) | 0;
    const x1 = b % w, y1 = (b / w) | 0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let n = dx + dy;
    while (n-- > 0) {
      const e2 = 2 * err;
      if (e2 > -dy && e2 < dx) {
        // diagonal step: both neighbours must be free
        if (!this.isFree(x0 + sx, y0) || !this.isFree(x0, y0 + sy)) return false;
        err -= dy; x0 += sx; err += dx; y0 += sy; n--;
      } else if (e2 > -dy) { err -= dy; x0 += sx; } else { err += dx; y0 += sy; }
      if (!this.isFree(x0, y0)) return false;
    }
    return true;
  }
}
