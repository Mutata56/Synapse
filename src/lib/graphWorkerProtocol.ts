import type { ForceSettings, PhysicsEdge, PhysicsNode } from "./forceLayout";

export type GraphLayoutRequest =
  | { type: "init"; nodes: PhysicsNode[]; edges: PhysicsEdge[]; settings: ForceSettings; groups: number[][]; clusterIds: Int32Array; cooling?: number; revision?: number; settled?: boolean }
  | { type: "replace"; nodes: PhysicsNode[]; edges: PhysicsEdge[]; settings: ForceSettings; groups: number[][]; clusterIds: Int32Array; revision: number; preservePositions: boolean }
  | { type: "settings"; settings: Partial<ForceSettings>; linkDistance?: number; radii?: number[] }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "active"; values: Uint8Array }
  | { type: "pin"; index: number; fixed: boolean; x?: number; y?: number }
  | { type: "recycle"; buffer: ArrayBuffer };

export type GraphLayoutFrame = {
  revision: number;
  type: "frame";
  positions: Float32Array;
  settled: boolean;
  energy: number;
  simulationMs: number;
};

export type GraphLayoutResponse = GraphLayoutFrame | { type: "error"; message: string };
