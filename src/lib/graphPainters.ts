import { readClusterPalette } from "./themeColors";
import type { GraphAppearance, GraphCamera, GraphData } from "./graphTypes";
import { classicNodeRadius } from "./graphStyle";
import { sameGraphTopology } from "./graphData";

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
  interacting: boolean;
};

export interface GraphPainter {
  updateData(data: GraphData, radii: readonly number[], colors: readonly number[]): void;
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
  private ranked: number[];
  private edgePath: Path2D | null = null;
  private edgeVersion = -1;
  private highlightPath: Path2D | null = null;
  private highlightNode = -2;

  constructor(private data: GraphData) {
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D недоступен");
    this.context = context;
    this.ranked = data.nodes.map((_, index) => index).sort((a, b) => data.nodes[b].degree - data.nodes[a].degree);
  }

  updateData(data: GraphData) {
    if (!sameGraphTopology(this.data, data)) { this.ranked = data.nodes.map((_, index) => index).sort((a, b) => data.nodes[b].degree - data.nodes[a].degree); this.edgePath = null; this.highlightNode = -2; }
    this.data = data;
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
      if (this.edgeVersion !== frame.geometryVersion || !this.edgePath) {
        this.edgePath = new Path2D(); this.highlightNode = -2; this.edgeVersion = frame.geometryVersion;
        for (const edge of this.data.edges) if (active[edge.a] && active[edge.b]) {
          this.edgePath.moveTo(p[edge.a * 2], p[edge.a * 2 + 1]); this.edgePath.lineTo(p[edge.b * 2], p[edge.b * 2 + 1]);
        }
      }
      ctx.setTransform(this.ratio * c.scale, 0, 0, this.ratio * c.scale, this.ratio * c.x, this.ratio * c.y);
      ctx.strokeStyle = "rgba(142,145,166,0.30)"; ctx.lineWidth = 0.8 * frame.appearance.lineWidth / c.scale; ctx.stroke(this.edgePath);
      if (frame.hovered >= 0) {
        if (this.highlightNode !== frame.hovered) {
          this.highlightPath = new Path2D(); this.highlightNode = frame.hovered;
          for (const next of this.data.adjacency[frame.hovered]) if (active[next]) {
            this.highlightPath.moveTo(p[frame.hovered * 2], p[frame.hovered * 2 + 1]); this.highlightPath.lineTo(p[next * 2], p[next * 2 + 1]);
          }
        }
        ctx.strokeStyle = css("--accent", "#8b6cef"); ctx.lineWidth = 1.5 * frame.appearance.lineWidth / c.scale; ctx.stroke(this.highlightPath!);
      }
      ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
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

export function folderColors(data: GraphData): number[] {
  const palette = readClusterPalette(GRAPH_PALETTE);
  const groups = [...new Set(data.nodes.map((node) => node.group).filter(Boolean))].sort();
  const colors = new Map(groups.map((group, index) => [group, palette[index % palette.length]]));
  return data.nodes.map((node) => colors.get(node.group) ?? 0xa7b0c2);
}
