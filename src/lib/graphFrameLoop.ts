/** An invalidation loop: no callbacks remain queued after the scene stops changing. */
export class GraphFrameLoop {
  private frame = 0;
  private enabled = true;
  private dirty = false;
  private lastFrame = 0;
  private destroyed = false;

  constructor(private paint: (now: number, deltaMs: number) => boolean, private maxFps = 60) {}

  request = () => {
    if (this.destroyed) return;
    this.dirty = true;
    if (this.enabled && !this.frame) this.frame = requestAnimationFrame(this.tick);
  };

  setEnabled(value: boolean) {
    this.enabled = value;
    if (!value && this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    if (value) { this.lastFrame = 0; this.request(); }
  }

  private tick = (now: number) => {
    this.frame = 0;
    if (!this.enabled || this.destroyed) return;
    const interval = 1000 / this.maxFps;
    if (this.lastFrame && now - this.lastFrame < interval - 1) { this.frame = requestAnimationFrame(this.tick); return; }
    if (!this.dirty) return;
    this.dirty = false;
    const delta = this.lastFrame ? Math.min(34, now - this.lastFrame) : interval;
    this.lastFrame = now;
    const continuing = this.paint(now, delta);
    if (continuing) this.dirty = true;
    if (this.dirty && !this.frame) this.frame = requestAnimationFrame(this.tick);
  };

  destroy() { this.destroyed = true; if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0; }
}
