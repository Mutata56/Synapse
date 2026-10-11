// Opt-in benchmark bundle only. No production entry imports this module.
import { getCurrentWindow } from "@tauri-apps/api/window";

export const metrics = {
  started: performance.now(), markdownParses: 0, markdownMs: 0,
  fs: {} as Record<string, number>, fsMs: {} as Record<string, number>,
  actions: [] as { name: string; ms: number; ok: boolean; count?: number }[],
  frameGaps: [] as number[], views: [] as string[],
};
const endpoint = "http://127.0.0.1:1467/metrics";
let frame = 0, until = 0, lastFrame = 0;
export function publish(reason: string) {
  const snapshot = {
    reason, window: "__TAURI_INTERNALS__" in window ? getCurrentWindow().label : "browser", elapsedMs: performance.now() - metrics.started,
    ...metrics, frameGaps: metrics.frameGaps.slice(-1000),
    dom: document.querySelectorAll("*").length,
    fileRows: document.querySelectorAll(".fs-row").length,
    sidebarRows: document.querySelectorAll("aside [draggable=true]").length,
  };
  const output = document.getElementById("files-performance-metrics");
  if (output) output.textContent = JSON.stringify(snapshot);
  void fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) }).catch(() => {});
}
export function measureFrames() {
  until = performance.now() + 800;
  if (frame) return;
  lastFrame = 0;
  const tick = (now: number) => {
    if (lastFrame) metrics.frameGaps.push(now - lastFrame);
    if (metrics.frameGaps.length > 1500) metrics.frameGaps.splice(0, 500);
    lastFrame = now;
    if (now < until) frame = requestAnimationFrame(tick);
    else { frame = 0; publish("interaction-settled"); }
  };
  frame = requestAnimationFrame(tick);
}
