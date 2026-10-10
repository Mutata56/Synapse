/** Numeric cell buckets are retained between frames; unchanged cells allocate nothing. */
export class GraphSpatialIndex {
  private buckets = new Map<number, number[]>();
  private cells: Int32Array;
  private valid: Uint8Array;
  private pool: number[][] = [];
  constructor(count: number, private cellSize = 64) { this.cells = new Int32Array(count); this.valid = new Uint8Array(count); }
  private hash(x: number, y: number) { return Math.imul(x, 73856093) ^ Math.imul(y, 19349663); }
  update(positions: Float32Array) {
    for (let index = 0; index < this.cells.length; index++) {
      this.move(index, positions[index * 2], positions[index * 2 + 1]);
    }
  }
  move(index: number, x: number, y: number) {
      const key = this.hash(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
      if (this.valid[index] && this.cells[index] === key) return;
      if (this.valid[index]) {
        const old = this.buckets.get(this.cells[index])!;
        const offset = old.indexOf(index); if (offset >= 0) { old[offset] = old[old.length - 1]; old.pop(); }
        if (!old.length) { this.buckets.delete(this.cells[index]); this.pool.push(old); }
      }
      let values = this.buckets.get(key);
      if (!values) { values = this.pool.pop() ?? []; this.buckets.set(key, values); }
      values.push(index); this.cells[index] = key; this.valid[index] = 1;
  }
  candidates(x: number, y: number, radius: number, visit: (index: number) => void) {
    for (let cx = Math.floor((x - radius) / this.cellSize); cx <= Math.floor((x + radius) / this.cellSize); cx++) {
      for (let cy = Math.floor((y - radius) / this.cellSize); cy <= Math.floor((y + radius) / this.cellSize); cy++) {
        for (const index of this.buckets.get(this.hash(cx, cy)) ?? []) visit(index);
      }
    }
  }
  get bucketCount() { return this.buckets.size; }
}
