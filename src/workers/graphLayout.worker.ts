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
let revision = 0;
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
  scope.postMessage({ type: "frame", positions, settled, energy, simulationMs, revision }, [positions.buffer as ArrayBuffer]);
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

function wake(startAlpha = 1) {
  calm = 0;
  alpha = startAlpha;
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
        revision = data.revision ?? 0; settled = !!data.settled;
        paused = false;
        buffers.length = 0;
        emit(0, 0);
        if (!settled) wake();
        break;
      case "replace":
        stop(); revision = data.revision;
        const warm = data.preservePositions && !!layout && layout.nodes.length === data.nodes.length && layout.clusterId?.length === data.clusterIds.length && data.clusterIds.every((value, i) => value === layout!.clusterId![i]);
        if (warm && layout) {
          layout.edges.length = 0; for (const edge of data.edges) layout.edges.push(edge);
          layout.groups.length = 0; for (const group of data.groups) layout.groups.push(group);
          data.nodes.forEach((node, i) => { Object.assign(layout!.nodes[i], { mass: node.mass, radius: node.radius, charge: node.charge, fixed: node.fixed, active: node.active }); });
          Object.assign(layout.settings, data.settings);
        } else layout = new ForceLayout(data.nodes, data.edges, data.settings, data.groups, data.clusterIds);
        buffers.length = 0; wake(warm ? 0.3 : 1); emit(0, 0);
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
          let changed = false;
          for (let i = 0; i < layout.nodes.length; i++) { const active = Boolean(data.values[i]); changed ||= active !== layout.nodes[i].active; layout.nodes[i].active = active; }
          if (changed) wake();
        }
        break;
      case "pin":
        if (layout?.nodes[data.index]) {
          const node = layout.nodes[data.index];
          const changed = node.fixed !== data.fixed;
          const moved = data.x !== undefined && data.y !== undefined && (node.x !== data.x || node.y !== data.y);
          node.fixed = data.fixed;
          if (moved) { node.x = node.px = data.x!; node.y = node.py = data.y!; wake(); }
          if (changed || moved) emit(0, 0);
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
