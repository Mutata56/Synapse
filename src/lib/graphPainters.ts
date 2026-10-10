import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { ClusterHullManager, KERNEL_PAD } from "./clusterHull";
import { readClusterPalette } from "./themeColors";
import type { GraphAppearance, GraphCamera, GraphData } from "./graphTypes";
import { classicNodeRadius } from "./graphStyle";

export const GRAPH_PALETTE = [0x4cc9f0, 0xf7945d, 0xf72585, 0x4895ef, 0x80ed99, 0xb388ff, 0xffd166, 0xff6b6b, 0x52d1b8, 0xc77dff, 0x90be6d, 0xff8fab];
export type PaintFrame = {
  positions: Float32Array;
  active: Uint8Array;
  camera: GraphCamera;
  appearance: GraphAppearance;
  hovered: number;
  selected: number;
  radii: readonly number[];
  colors: readonly number[];
  now: number;
  pulse: number;
  geometryVersion: number;
  moving: boolean;
};

export interface GraphPainter {
  canvas: HTMLCanvasElement;
  resize(width: number, height: number): void;
  paint(frame: PaintFrame): void;
  destroy(): void;
}

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
const LABEL_LIMIT = 180;

/** Flat, muted nodes and straight links; no shader, shadows, halos or folder islands. */
export class ClassicGraphPainter implements GraphPainter {
  readonly canvas = document.createElement("canvas");
  private context: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private readonly ranked: number[];

  constructor(private data: GraphData) {
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D недоступен");
    this.context = context;
    this.ranked = data.nodes.map((_, index) => index).sort((a, b) => data.nodes[b].degree - data.nodes[a].degree);
  }

  resize(width: number, height: number) {
    this.width = width; this.height = height;
    this.ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1800000 / Math.max(1, width * height)));
    this.canvas.width = Math.round(width * this.ratio); this.canvas.height = Math.round(height * this.ratio);
    this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`;
  }

  paint(frame: PaintFrame) {
    const { positions: p, active, camera: c } = frame;
    const ctx = this.context;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = css("--graph-background", "#282a36"); ctx.fillRect(0, 0, this.width, this.height);
    const x = (index: number) => p[index * 2] * c.scale + c.x;
    const y = (index: number) => p[index * 2 + 1] * c.scale + c.y;
    const lit = frame.hovered >= 0 ? new Set([frame.hovered, ...this.data.adjacency[frame.hovered]]) : null;
    if (frame.appearance.showEdges) {
      for (const highlight of [false, true]) {
        ctx.beginPath();
        for (const edge of this.data.edges) {
          if (!active[edge.a] || !active[edge.b]) continue;
          const on = frame.hovered >= 0 && (edge.a === frame.hovered || edge.b === frame.hovered);
          if (on !== highlight) continue;
          if (Math.max(x(edge.a), x(edge.b)) < 0 || Math.min(x(edge.a), x(edge.b)) > this.width || Math.max(y(edge.a), y(edge.b)) < 0 || Math.min(y(edge.a), y(edge.b)) > this.height) continue;
          ctx.moveTo(x(edge.a), y(edge.a)); ctx.lineTo(x(edge.b), y(edge.b));
        }
        ctx.strokeStyle = highlight ? css("--accent", "#8b6cef") : "rgba(142,145,166,0.30)";
        ctx.lineWidth = (highlight ? 1.5 : 0.8) * frame.appearance.lineWidth; ctx.stroke();
      }
    }
    for (let i = 0; i < this.data.nodes.length; i++) {
      if (!active[i]) continue;
      const sx = x(i), sy = y(i), radius = classicNodeRadius(this.data.nodes[i].degree, c.scale, frame.appearance.nodeSize);
      if (sx + radius < 0 || sy + radius < 0 || sx - radius > this.width || sy - radius > this.height) continue;
      ctx.globalAlpha = lit && !lit.has(i) ? 0.3 : 1;
      ctx.fillStyle = i === frame.hovered || i === frame.selected ? css("--accent", "#8b6cef")
        : hex(frame.colors[i]);
      ctx.beginPath(); ctx.arc(sx, sy, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.font = "13px Inter, system-ui, sans-serif"; ctx.textBaseline = "middle";
    ctx.fillStyle = css("--text-secondary", "#c8c8cf");
    const order = frame.hovered >= 0 ? [frame.hovered, ...this.ranked] : this.ranked;
    const displayed = new Set<number>(); let labels = 0;
    for (const i of order) {
      if (displayed.has(i) || !active[i]) continue;
      displayed.add(i);
      if (i !== frame.hovered && i !== frame.selected && (c.scale < frame.appearance.labelZoom || labels >= LABEL_LIMIT)) continue;
      const sx = x(i), sy = y(i);
      if (sx < -20 || sy < 0 || sx > this.width || sy > this.height) continue;
      ctx.globalAlpha = lit && !lit.has(i) ? 0.3 : 1;
      const label = this.data.nodes[i].label;
      ctx.fillText(label.length > 54 ? `${label.slice(0, 51)}…` : label, sx + classicNodeRadius(this.data.nodes[i].degree, c.scale, frame.appearance.nodeSize) + 5, sy, 330);
      labels++;
    }
    ctx.globalAlpha = 1;
  }

  destroy() { this.canvas.remove(); this.canvas.width = this.canvas.height = 1; }
}

/** Existing liquid volume visual, with bounded raster work and a small live label cache. */
export class VolumeGraphPainter implements GraphPainter {
  readonly canvas: HTMLCanvasElement;
  private world = new Container();
  private edgeGraphics = new Graphics();
  private halos = new Container();
  private dots = new Container();
  private labelLayer = new Container();
  private sprites: Sprite[] = [];
  private haloSprites: Sprite[] = [];
  private labels = new Map<number, Text>();
  private clusterLabels = new Map<string, Text>();
  private haloTexture: Texture;
  private dotTexture: Texture;
  private hull: ClusterHullManager;
  private width = 1;
  private height = 1;
  private readonly ranked: number[];
  private readonly groups = new Map<string, number[]>();
  private lastHullFrame = 0;
  private oldCamera = "";
  private lastGeometryVersion = -1;
  private lastSpread = 0;
  private oldColors: readonly number[] | null = null;
  private points: Array<{ x: number; y: number; active: boolean }>;

  static async create(host: HTMLElement, data: GraphData, radii: readonly number[], colors: readonly number[]) {
    const app = new Application();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1800000 / Math.max(1, host.clientWidth * host.clientHeight)));
    await app.init({ width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight), resolution: ratio, autoDensity: true, antialias: false, backgroundAlpha: 0, autoStart: false, sharedTicker: false, preference: "webgl" });
    return new VolumeGraphPainter(app, data, radii, colors);
  }

  private constructor(private app: Application, private data: GraphData, radii: readonly number[], colors: readonly number[]) {
    this.canvas = app.canvas;
    this.points = data.nodes.map(() => ({ x: 0, y: 0, active: true }));
    this.haloTexture = circleTexture(true);
    this.dotTexture = circleTexture(false);
    this.ranked = data.nodes.map((_, index) => index).sort((a, b) => data.nodes[b].degree - data.nodes[a].degree);
    data.nodes.forEach((node, index) => {
      if (node.group) { const list = this.groups.get(node.group) ?? []; list.push(index); this.groups.set(node.group, list); }
    });
    this.hull = new ClusterHullManager(app.renderer, app.screen.width, app.screen.height, {
      radii, colors, clustered: data.nodes.map((node) => Boolean(node.group && (this.groups.get(node.group)?.length ?? 0) >= 3)), resolution: 0.8, maxPixels: 768000,
    });
    app.stage.addChild(this.hull.output, this.world);
    this.world.addChild(this.edgeGraphics, this.halos, this.dots, this.labelLayer);
    for (let i = 0; i < data.nodes.length; i++) {
      const halo = new Sprite(this.haloTexture); halo.anchor.set(0.5); halo.width = halo.height = radii[i] * 8; halo.tint = colors[i]; halo.alpha = 0.5; halo.blendMode = "add";
      this.halos.addChild(halo); this.haloSprites.push(halo);
      const dot = new Sprite(this.dotTexture); dot.anchor.set(0.5); dot.width = dot.height = radii[i] * 2; dot.tint = colors[i];
      this.dots.addChild(dot); this.sprites.push(dot);
    }
    for (const [name, members] of this.groups) {
      if (members.length < 3) continue;
      const text = new Text({ text: name.split("/").pop() ?? name, resolution: 1.25, style: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 17, fontWeight: "700", fill: colors[members[0]] } });
      text.anchor.set(0.5, 1); this.labelLayer.addChild(text); this.clusterLabels.set(name, text);
    }
  }

  resize(width: number, height: number) {
    this.width = width; this.height = height;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1800000 / Math.max(1, width * height)));
    this.app.renderer.resize(width, height, ratio);
    this.hull.resize(width, height);
    this.lastHullFrame = 0;
  }

  paint(frame: PaintFrame) {
    const { positions: p, active, camera: c } = frame;
    this.world.position.set(c.x, c.y); this.world.scale.set(c.scale);
    const cameraKey = `${c.x}:${c.y}:${c.scale}`;
    const cameraChanged = cameraKey !== this.oldCamera; this.oldCamera = cameraKey;
    const lit = frame.hovered >= 0 ? new Set([frame.hovered, ...this.data.adjacency[frame.hovered]]) : null;
    for (let i = 0; i < this.sprites.length; i++) {
      const x = p[i * 2], y = p[i * 2 + 1];
      const sx = x * c.scale + c.x, sy = y * c.scale + c.y;
      const visible = Boolean(active[i] && sx > -60 && sy > -60 && sx < this.width + 60 && sy < this.height + 60);
      const dot = this.sprites[i], halo = this.haloSprites[i];
      dot.visible = halo.visible = visible;
      if (!visible) continue;
      dot.position.set(x, y); halo.position.set(x, y);
      dot.tint = i === frame.hovered || i === frame.selected ? 0xf4f4ff : frame.appearance.colorByFolder ? frame.colors[i] : this.data.nodes[i].kind === "folder" ? 0x929bc8 : 0xb3bacb;
      dot.alpha = lit && !lit.has(i) ? 0.4 : 1;
      halo.tint = dot.tint; halo.alpha = dot.alpha * 0.48;
    }
    this.edgeGraphics.clear();
    if (frame.appearance.showEdges) {
      for (const edge of this.data.edges) {
        if (!active[edge.a] || !active[edge.b]) continue;
        const highlighted = frame.hovered === edge.a || frame.hovered === edge.b;
        this.edgeGraphics.moveTo(p[edge.a * 2], p[edge.a * 2 + 1]).lineTo(p[edge.b * 2], p[edge.b * 2 + 1]).stroke({ color: highlighted ? 0xd5d9fb : 0x8890b7, alpha: highlighted ? 0.9 : edge.kind === "contains" ? 0.22 : 0.45, width: (highlighted ? 1.5 : 0.8) / c.scale });
      }
    }
    const visibleLabels = new Set<number>(); let labelCount = 0;
    const order = frame.hovered >= 0 ? [frame.hovered, ...this.ranked] : this.ranked;
    for (const index of order) {
      if (visibleLabels.has(index) || !this.sprites[index].visible) continue;
      if (index !== frame.hovered && index !== frame.selected && (c.scale < frame.appearance.labelZoom || labelCount >= LABEL_LIMIT)) continue;
      visibleLabels.add(index); labelCount++;
      let text = this.labels.get(index);
      if (!text) {
        text = new Text({ text: this.data.nodes[index].label, resolution: 1.25, style: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 13, fill: 0xd6d9e2, fontWeight: "500" } });
        text.anchor.set(0, 0.5); this.labelLayer.addChild(text); this.labels.set(index, text);
      }
      text.visible = true; text.scale.set(1 / c.scale); text.position.set(p[index * 2] + frame.radii[index] + 6 / c.scale, p[index * 2 + 1]);
    }
    for (const [index, text] of this.labels) {
      if (visibleLabels.has(index)) continue;
      text.visible = false;
      if (this.labels.size > LABEL_LIMIT + 80) { this.labels.delete(index); text.destroy(); }
    }
    const labelBoxes: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    const groupOrder = [...this.clusterLabels.entries()].sort((a, b) => this.groups.get(b[0])!.length - this.groups.get(a[0])!.length);
    for (const [name, text] of groupOrder) {
      const members = this.groups.get(name)!;
      let x = 0, y = Infinity, count = 0;
      for (const index of members) if (active[index]) { x += p[index * 2]; y = Math.min(y, p[index * 2 + 1] - frame.radii[index]); count++; }
      text.visible = count > 0 && c.scale > 0.08;
      if (count) {
        text.scale.set(1 / c.scale); text.position.set(x / count, y - KERNEL_PAD - 8 / c.scale);
        const sx = text.x * c.scale + c.x, sy = text.y * c.scale + c.y;
        const width = text.width * c.scale, height = text.height * c.scale;
        const box = { left: sx - width / 2 - 4, top: sy - height - 4, right: sx + width / 2 + 4, bottom: sy + 4 };
        const outside = box.right < 0 || box.bottom < 0 || box.left > this.width || box.top > this.height;
        const overlap = labelBoxes.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
        text.visible = !outside && !overlap;
        if (text.visible) labelBoxes.push(box);
      }
    }
    // The soft field can update at 30Hz while interactions and text stay at 60Hz.
    const spread = Math.cbrt(1 + frame.appearance.internalRepulsion / 20000) * frame.pulse;
    const colorChanged = this.oldColors !== frame.colors;
    if (colorChanged) { this.hull.recolor(frame.colors); this.oldColors = frame.colors; }
    const geometryChanged = this.lastGeometryVersion !== frame.geometryVersion;
    if (cameraChanged || colorChanged || spread !== this.lastSpread || (geometryChanged && (frame.now - this.lastHullFrame >= 32 || !frame.moving)) || this.lastHullFrame === 0) {
      for (let i = 0; i < this.points.length; i++) { this.points[i].x = p[i * 2]; this.points[i].y = p[i * 2 + 1]; this.points[i].active = Boolean(active[i]); }
      this.hull.update(this.points, c.scale, c.x, c.y, spread);
      this.lastHullFrame = frame.now;
      this.lastGeometryVersion = frame.geometryVersion;
      this.lastSpread = spread;
    }
    this.app.render();
  }

  destroy() {
    this.hull.destroy(); this.app.destroy(true, { children: true });
    this.haloTexture.destroy(true); this.dotTexture.destroy(true);
  }
}

function circleTexture(glow: boolean): Texture {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = glow ? 128 : 32;
  const ctx = canvas.getContext("2d")!; const middle = canvas.width / 2;
  if (glow) {
    const gradient = ctx.createRadialGradient(middle, middle, 0, middle, middle, middle);
    gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(0.3, "rgba(255,255,255,.5)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else { ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(middle, middle, middle - 1, 0, Math.PI * 2); ctx.fill(); }
  return Texture.from(canvas);
}

export function folderColors(data: GraphData): number[] {
  const palette = readClusterPalette(GRAPH_PALETTE);
  const groups = [...new Set(data.nodes.map((node) => node.group).filter(Boolean))].sort();
  const colors = new Map(groups.map((group, index) => [group, palette[index % palette.length]]));
  return data.nodes.map((node) => colors.get(node.group) ?? 0xa7b0c2);
}
