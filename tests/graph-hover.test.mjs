import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const temporary = await mkdtemp(join(tmpdir(), "graph-hover-"));
const entry = join(temporary, "scene.mjs");
await build({
  entryPoints: ["src/lib/graphScene.ts"], bundle: true, platform: "node", format: "esm", outfile: entry,
  define: { "import.meta.env.DEV": "false" },
  plugins: [{ name: "graph-test-surfaces", setup(builder) {
    builder.onResolve({ filter: /graphLayout\.worker\.ts\?worker&inline$/ }, () => ({ path: "worker", namespace: "test" }));
    builder.onResolve({ filter: /^\.\/graph(Painters|VolumePainter)$/ }, () => ({ path: "painters", namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "worker"
      ? "export default class { constructor() { globalThis.graphFixture.worker = this; } postMessage() {} terminate() {} }"
      : `export const folderColors = data => data.nodes.map(() => 0x888888);
         export class ClassicGraphPainter {
           constructor() { this.canvas = globalThis.graphFixture.canvas; }
           updateData() {} resize() {} destroy() {}
           paint(frame) { globalThis.graphFixture.frames.push({ hovered: frame.hovered }); }
         }
         export const VolumeGraphPainter = { create: async () => new ClassicGraphPainter() };`, loader: "js" }));
  } }],
});
const { GraphScene } = await import(pathToFileURL(entry));
after(() => rm(temporary, { recursive: true, force: true }));

async function fixture(t, mode) {
  class Canvas extends EventTarget {
    style = {};
    captured = new Set();
    rect = { left: 20, top: 30, width: 400, height: 400 };
    setAttribute() {} focus() {}
    getBoundingClientRect() { return this.rect; }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
  }
  const canvas = new Canvas(), frames = [], queued = new Map();
  let nextId = 1, now = performance.now() + 10000;
  const globals = { graphFixture: { canvas, frames, worker: null },
    window: new EventTarget(), document: Object.assign(new EventTarget(), { hidden: false, documentElement: {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }), matchMedia: () => ({ matches: true }),
    ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (callback) => { const id = nextId++; queued.set(id, callback); return id; },
    cancelAnimationFrame: (id) => queued.delete(id),
  };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  const data = { nodes: ["a", "b"].map(key => ({ key, label: key, path: key, kind: "note", group: "", degree: 0 })), edges: [], adjacency: [[], []] };
  const appearance = { repulsion: 100, clusterSeparation: 100, internalRepulsion: 100, linkDistance: 60, cohesion: 0.1, damping: 0.8, centerForce: 0.01, showEdges: true, colorByFolder: false, frozen: false, breathing: false, labelZoom: 0.6, nodeSize: 1, lineWidth: 1, linkStrength: 0.5, colorGroups: [] };
  const callbacks = { select() {}, open() {}, context() {}, minimap() {}, error(message) { throw new Error(message); } };
  const scene = new GraphScene({ clientWidth: 400, clientHeight: 400, appendChild() {}, dataset: {} }, data, mode, appearance, callbacks);
  t.after(() => {
    scene.destroy();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  await scene.start();
  const flush = () => {
    for (let pass = 0; queued.size && pass < 100; pass++) {
      const tasks = [...queued.values()]; queued.clear(); now += 34;
      for (const task of tasks) task(now);
    }
    assert.equal(queued.size, 0, "a settled graph must have no idle animation callbacks");
  };
  const layout = (positions) => {
    globals.graphFixture.worker.onmessage({ data: { type: "frame", revision: 1, positions: new Float32Array(positions), settled: true, simulationMs: 0 } });
    flush();
  };
  const pointer = (type, point) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX: point.x + canvas.rect.left, clientY: point.y + canvas.rect.top, pointerId: 1, button: 0, shiftKey: false });
    canvas.dispatchEvent(event); flush();
  };
  const screen = (x, y) => { const camera = scene.snapshot().camera; return { x: x * camera.scale + camera.x, y: y * camera.scale + camera.y }; };
  layout([0, 0, 100, 100]);
  return { scene, canvas, layout, pointer, screen, flush, hovered: () => frames.at(-1).hovered };
}

for (const mode of ["volume", "obsidian"]) {
  test(`${mode}: dropping a node updates hover as physics moves under a stationary cursor`, async t => {
    const f = await fixture(t, mode), start = f.screen(0, 0), drop = { x: start.x + 80, y: start.y };
    f.pointer("pointermove", start); assert.equal(f.hovered(), 0);
    f.pointer("pointerdown", start); f.pointer("pointermove", drop); f.pointer("pointerup", drop);
    assert.equal(f.hovered(), 0, "the dropped node is initially still under the cursor");
    const [x, y] = f.scene.snapshot().positions.get("a");
    f.layout([x + 100, y + 100, x - 100, y + 100]);
    assert.equal(f.hovered(), -1, "node left the unmoved cursor after release");
    assert.equal(f.canvas.style.cursor, "grab");
    f.layout([x + 100, y + 100, x, y]);
    assert.equal(f.hovered(), 1, "another node moving under the same cursor becomes hovered");
    assert.equal(f.canvas.style.cursor, "pointer");
  });

  test(`${mode}: moving the camera updates hover without another pointer event`, async t => {
    const f = await fixture(t, mode), point = f.screen(0, 0);
    f.pointer("pointermove", point); assert.equal(f.hovered(), 0);
    f.scene.center(1000, 1000); f.flush();
    assert.equal(f.hovered(), -1); assert.equal(f.canvas.style.cursor, "grab");
  });

  test(`${mode}: pointer exit or cancellation cannot restore stale hover on a later layout`, async t => {
    const f = await fixture(t, mode), point = f.screen(0, 0);
    f.pointer("pointermove", point); f.pointer("pointerleave", point);
    f.layout([0, 0, 100, 100]); assert.equal(f.hovered(), -1);
    f.pointer("pointermove", point); f.pointer("pointerdown", point); f.pointer("pointercancel", point);
    f.layout([0, 0, 100, 100]); assert.equal(f.hovered(), -1);
    assert.equal(f.canvas.style.cursor, "grab");
    f.pointer("pointermove", point); f.pointer("pointerdown", point);
    f.pointer("pointermove", { x: point.x + 60, y: point.y });
    f.pointer("lostpointercapture", { x: point.x + 60, y: point.y });
    f.layout([0, 0, 100, 100]); assert.equal(f.hovered(), -1);
  });
}
