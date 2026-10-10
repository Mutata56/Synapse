import type { NoteMeta } from "./storage";

export type GraphMode = "volume" | "obsidian";
export type GraphNodeKind = "note" | "folder" | "unresolved" | "tag" | "attachment";
export type GraphReference = { target: string; embedded: boolean };
export type GraphDocument = { id: string; body: string };
export type GraphReferenceMap = Record<string, GraphReference[]>;
export type GraphColorGroup = { query: string; color: string };
export type GraphNode = {
  key: string;
  label: string;
  kind: GraphNodeKind;
  path: string;
  group: string;
  degree: number;
  note?: NoteMeta;
};
export type GraphEdge = { a: number; b: number; kind: "link" | "contains" };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; adjacency: number[][] };
export type GraphOptions = {
  showOrphans: boolean;
  showUnresolved: boolean;
  showTags: boolean;
  showAttachments: boolean;
};
export type GraphAppearance = {
  repulsion: number;
  clusterSeparation: number;
  internalRepulsion: number;
  linkDistance: number;
  cohesion: number;
  damping: number;
  centerForce: number;
  showEdges: boolean;
  colorByFolder: boolean;
  frozen: boolean;
  breathing: boolean;
  labelZoom: number;
  nodeSize: number;
  lineWidth: number;
  linkStrength: number;
  colorGroups: GraphColorGroup[];
};
export type GraphCamera = { x: number; y: number; scale: number };
export type GraphBounds = { minX: number; minY: number; maxX: number; maxY: number };
export type GraphMapSnapshot = {
  positions: Float32Array;
  active: Uint8Array;
  colors: readonly string[];
  bounds: GraphBounds;
  camera: GraphCamera;
  width: number;
  height: number;
};
