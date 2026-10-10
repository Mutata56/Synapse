import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { ClusterHullManager, KERNEL_PAD } from "./clusterHull";
import type { GraphData } from "./graphTypes";
import { sameGraphTopology } from "./graphData";
import { recordGraphDiagnostic } from "./graphDiagnostics";
import type { GraphPainter, PaintFrame } from "./graphPainters";
const LABEL_LIMIT = 180;

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
  private ranked: number[];
  private readonly groups = new Map<string, number[]>();
  private lastHullFrame = 0;
  private oldCamera = "";
  private lastGeometryVersion = -1;
  private lastSpread = 0;
  private oldColors: readonly number[] | null = null;
  private lastNodeGeometry = -1;
  private oldHover = -2;
  private oldSelected = -2;
  private oldFolderColor = false;
  private oldEdges = false;
  private oldEdgeScale = 0;
  private groupOrder: Array<[string, number[]]> = [];
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
    this.groupOrder = [...this.groups].sort((a, b) => b[1].length - a[1].length);
  }

  updateData(data: GraphData, radii: readonly number[], colors: readonly number[]) {
    if (sameGraphTopology(this.data, data)) {
      this.data = data;
      for (const [index, text] of this.labels) if (text.text !== data.nodes[index].label) text.text = data.nodes[index].label;
      return;
    }
    const oldNodes = this.data.nodes;
    const oldSprites = new Map(oldNodes.map((node, index) => [node.key, [this.sprites[index], this.haloSprites[index]] as const]));
    const oldLabels = new Map([...this.labels].map(([index, text]) => [oldNodes[index].key, text]));
    this.labels.clear(); this.sprites = []; this.haloSprites = []; this.groups.clear(); this.data = data;
    data.nodes.forEach((node, index) => {
      const pair = oldSprites.get(node.key); oldSprites.delete(node.key);
      const dot = pair?.[0] ?? new Sprite(this.dotTexture), halo = pair?.[1] ?? new Sprite(this.haloTexture);
      if (!pair) { dot.anchor.set(0.5); halo.anchor.set(0.5); halo.blendMode = "add"; this.dots.addChild(dot); this.halos.addChild(halo); }
      dot.width = dot.height = radii[index] * 2; halo.width = halo.height = radii[index] * 8;
      dot.tint = halo.tint = colors[index]; this.sprites.push(dot); this.haloSprites.push(halo);
      const label = oldLabels.get(node.key);
      if (label) { this.labels.set(index, label); oldLabels.delete(node.key); label.text = node.label; }
      if (node.group) { const list = this.groups.get(node.group) ?? []; list.push(index); this.groups.set(node.group, list); }
    });
    for (const pair of oldSprites.values()) { pair[0].destroy(); pair[1].destroy(); }
    for (const text of oldLabels.values()) text.destroy();
    for (const [name, text] of this.clusterLabels) if ((this.groups.get(name)?.length ?? 0) < 3) { text.destroy(); this.clusterLabels.delete(name); }
    for (const [name, members] of this.groups) {
      if (members.length < 3 || this.clusterLabels.has(name)) continue;
      const text = new Text({ text: name.split("/").pop() ?? name, resolution: 1.25, style: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 17, fontWeight: "700", fill: colors[members[0]] } });
      text.anchor.set(0.5, 1); this.labelLayer.addChild(text); this.clusterLabels.set(name, text);
    }
    this.ranked = data.nodes.map((_, index) => index).sort((a, b) => data.nodes[b].degree - data.nodes[a].degree);
    this.groupOrder = [...this.groups].sort((a, b) => b[1].length - a[1].length);
    this.points = data.nodes.map(() => ({ x: 0, y: 0, active: true }));
    this.hull.destroy();
    this.hull = new ClusterHullManager(this.app.renderer, this.width, this.height, { radii, colors, clustered: data.nodes.map((node) => Boolean(node.group && (this.groups.get(node.group)?.length ?? 0) >= 3)), resolution: 0.8, maxPixels: 768000 });
    this.app.stage.addChildAt(this.hull.output, 0); this.lastHullFrame = 0; this.oldColors = null; this.lastNodeGeometry = -1;
    recordGraphDiagnostic("painterTopologyUpdates");
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
    const geometryChanged = this.lastNodeGeometry !== frame.geometryVersion;
    const styleChanged = frame.hovered !== this.oldHover || frame.selected !== this.oldSelected || frame.appearance.colorByFolder !== this.oldFolderColor || this.oldColors !== frame.colors;
    const lit = frame.hovered >= 0 ? new Set([frame.hovered, ...this.data.adjacency[frame.hovered]]) : null;
    for (let i = 0; i < this.sprites.length; i++) {
      const x = p[i * 2], y = p[i * 2 + 1];
      const sx = x * c.scale + c.x, sy = y * c.scale + c.y;
      const visible = Boolean(active[i] && sx > -60 && sy > -60 && sx < this.width + 60 && sy < this.height + 60);
      const dot = this.sprites[i], halo = this.haloSprites[i];
      const newlyVisible = visible && !dot.visible;
      dot.visible = halo.visible = visible;
      if (!visible) continue;
      if (geometryChanged || newlyVisible) { dot.position.set(x, y); halo.position.set(x, y); }
      if (styleChanged || newlyVisible) {
        dot.tint = i === frame.hovered || i === frame.selected ? 0xf4f4ff : frame.appearance.colorByFolder ? frame.colors[i] : this.data.nodes[i].kind === "folder" ? 0x929bc8 : 0xb3bacb;
        dot.alpha = lit && !lit.has(i) ? 0.4 : 1;
        halo.tint = dot.tint; halo.alpha = dot.alpha * 0.48;
      }
    }
    if (geometryChanged || frame.hovered !== this.oldHover || frame.appearance.showEdges !== this.oldEdges || c.scale !== this.oldEdgeScale) {
      this.edgeGraphics.clear();
      if (frame.appearance.showEdges) {
      for (const edge of this.data.edges) {
        if (!active[edge.a] || !active[edge.b]) continue;
        const highlighted = frame.hovered === edge.a || frame.hovered === edge.b;
        this.edgeGraphics.moveTo(p[edge.a * 2], p[edge.a * 2 + 1]).lineTo(p[edge.b * 2], p[edge.b * 2 + 1]).stroke({ color: highlighted ? 0xd5d9fb : 0x8890b7, alpha: highlighted ? 0.9 : edge.kind === "contains" ? 0.22 : 0.45, width: (highlighted ? 1.5 : 0.8) / c.scale });
      }
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
    for (const [name, members] of this.groupOrder) {
      const text = this.clusterLabels.get(name); if (!text) continue;
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
    const spread = Math.cbrt(1 + frame.appearance.internalRepulsion / 20000);
    this.hull.output.alpha = frame.pulse; this.halos.alpha = frame.pulse;
    const qualityChanged = this.hull.setQuality(frame.interacting ? 0.55 : 0.8, frame.interacting ? 384000 : 768000);
    const colorChanged = this.oldColors !== frame.colors;
    if (colorChanged) { this.hull.recolor(frame.colors); this.oldColors = frame.colors; }
    const hullGeometryChanged = this.lastGeometryVersion !== frame.geometryVersion;
    if (qualityChanged || cameraChanged || colorChanged || spread !== this.lastSpread || (hullGeometryChanged && (frame.now - this.lastHullFrame >= 32 || !frame.moving)) || this.lastHullFrame === 0) {
      for (let i = 0; i < this.points.length; i++) { this.points[i].x = p[i * 2]; this.points[i].y = p[i * 2 + 1]; this.points[i].active = Boolean(active[i]); }
      this.hull.update(this.points, c.scale, c.x, c.y, spread);
      recordGraphDiagnostic("hullUpdates");
      this.lastHullFrame = frame.now;
      this.lastGeometryVersion = frame.geometryVersion;
      this.lastSpread = spread;
    }
    this.lastNodeGeometry = frame.geometryVersion; this.oldHover = frame.hovered; this.oldSelected = frame.selected;
    this.oldFolderColor = frame.appearance.colorByFolder; this.oldEdges = frame.appearance.showEdges; this.oldEdgeScale = c.scale;
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
