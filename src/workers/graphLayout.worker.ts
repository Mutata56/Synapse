import { ForceLayout } from "../lib/forceLayout";
import type { GraphLayoutRequest, GraphLayoutResponse } from "../lib/graphWorkerProtocol";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GraphLayoutRequest>) => void) | null;
  postMessage: (message: GraphLayoutResponse, transfer?: Transferable[]) => void;
};
let layout: ForceLayout | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let paused = false;
let calm = 0;
let settled = false;
let alpha = 1;
let cooling = 0.982;
const buffers: Float32Array[] = [];

function stop() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function emit(energy: number, simulationMs: number) {
  if (!layout) return;
  const positions = buffers.pop() ?? new Float32Array(layout.nodes.length * 2);
  for (let i = 0; i < layout.nodes.length; i++) {
    positions[i * 2] = layout.nodes[i].x;
    positions[i * 2 + 1] = layout.nodes[i].y;
  }
  scope.postMessage({ type: "frame", positions, settled, energy, simulationMs }, [positions.buffer as ArrayBuffer]);
}

function step() {
  timer = null;
  if (!layout || paused || settled) return;
  const started = performance.now();
  const energy = layout.step(alpha);
  alpha *= cooling;
  const ms = performance.now() - started;
  calm = energy < 0.01 * Math.max(1, layout.nodes.length) ? calm + 1 : 0;
  settled = calm >= 32 || alpha <= 0.002;
  emit(energy, ms);
  // Keep large layouts away from the UI thread and give other processes CPU time.
  if (!settled) timer = setTimeout(step, Math.max(4, 1000 / 50 - ms, ms * 0.35));
}

function wake() {
  calm = 0;
  alpha = 1;
  settled = false;
  if (!paused && timer === null) timer = setTimeout(step, 0);
}

scope.onmessage = ({ data }) => {
  try {
    switch (data.type) {
      case "init":
        stop();
        layout = new ForceLayout(data.nodes, data.edges, data.settings, data.groups, data.clusterIds);
        cooling = typeof data.cooling === "number" ? Math.max(0.9, Math.min(0.998, data.cooling)) : 0.982;
        paused = false;
        buffers.length = 0;
        emit(0, 0);
        wake();
        break;
      case "settings":
        if (!layout) break;
        Object.assign(layout.settings, data.settings);
        if (data.radii?.length === layout.nodes.length) {
          for (let i = 0; i < data.radii.length; i++) layout.nodes[i].radius = data.radii[i];
        }
        if (data.linkDistance !== undefined) {
          for (const edge of layout.edges) edge.rest = layout.nodes[edge.a].radius + layout.nodes[edge.b].radius + data.linkDistance;
        }
        wake();
        break;
      case "pause": paused = true; stop(); break;
      case "resume": paused = false; if (!settled && timer === null) timer = setTimeout(step, 0); break;
      case "active":
        if (layout) {
          for (let i = 0; i < layout.nodes.length; i++) layout.nodes[i].active = Boolean(data.values[i]);
          wake();
        }
        break;
      case "pin":
        if (layout?.nodes[data.index]) {
          const node = layout.nodes[data.index];
          node.fixed = data.fixed;
          if (data.x !== undefined && data.y !== undefined) { node.x = node.px = data.x; node.y = node.py = data.y; }
          emit(0, 0);
          wake();
        }
        break;
      case "recycle":
        if (layout && data.buffer.byteLength === layout.nodes.length * 8 && buffers.length < 3) buffers.push(new Float32Array(data.buffer));
        break;
    }
  } catch (error) {
    stop();
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
