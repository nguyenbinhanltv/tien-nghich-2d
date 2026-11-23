// Uniform-grid broad phase. Built each tick from position arrays with a counting sort, queried into a
// caller-owned Int32Array: after construction nothing allocates. `allocations` counts buffer growth so tests
// can assert the hot loop stays at zero.
export class SpatialHash {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originY: number;
  /** Times a buffer had to be re-allocated after construction. Must stay 0 in the tick loop. */
  allocations = 0;
  private start: Int32Array;
  private fill: Int32Array;
  private items: Int32Array;
  private cellOf: Int32Array;

  constructor(width: number, height: number, cell: number, capacity: number, originX = 0, originY = 0) {
    this.cell = cell; this.originX = originX; this.originY = originY;
    this.cols = Math.max(1, Math.ceil(width / cell)); this.rows = Math.max(1, Math.ceil(height / cell));
    this.start = new Int32Array(this.cols * this.rows + 1);
    this.fill = new Int32Array(this.cols * this.rows);
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  private col(x: number): number { const c = Math.floor((x - this.originX) / this.cell); return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c; }
  private row(y: number): number { const r = Math.floor((y - this.originY) / this.cell); return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r; }

  /** Index the first `n` points; the stored id of point i is i. Points outside the grid clamp to the edge cells. */
  rebuild(n: number, xs: Float64Array, ys: Float64Array): void {
    if (n > this.items.length) { this.items = new Int32Array(n); this.cellOf = new Int32Array(n); this.allocations++; }
    const { start, fill, cellOf, items } = this;
    start.fill(0); fill.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.row(ys[i] as number) * this.cols + this.col(xs[i] as number);
      cellOf[i] = c; start[c + 1] = (start[c + 1] as number) + 1;
    }
    for (let c = 0; c < start.length - 1; c++) start[c + 1] = (start[c + 1] as number) + (start[c] as number);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i] as number;
      items[(start[c] as number) + (fill[c] as number)] = i; fill[c] = (fill[c] as number) + 1;
    }
  }

  /**
   * Write ids of points whose cell overlaps the box [x-r, x+r] x [y-r, y+r] into `out` (ascending cell order, ascending id
   * inside a cell, so results are deterministic). Returns the count; stops when `out` is full. Narrow phase is the caller's.
   * Inflate r by the largest entity radius when points are centres of circles.
   */
  query(x: number, y: number, r: number, out: Int32Array): number {
    const c0 = this.col(x - r), c1 = this.col(x + r), r0 = this.row(y - r), r1 = this.row(y + r);
    let n = 0;
    for (let ry = r0; ry <= r1; ry++) {
      for (let cx = c0; cx <= c1; cx++) {
        const c = ry * this.cols + cx;
        for (let k = this.start[c] as number, e = this.start[c + 1] as number; k < e; k++) {
          if (n >= out.length) return n;
          out[n++] = this.items[k] as number;
        }
      }
    }
    return n;
  }
}
