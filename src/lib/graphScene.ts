import { DEFAULT_FORCE_SETTINGS, type ForceSettings, type PhysicsNode } from "./forceLayout";
import { GraphFrameLoop } from "./graphFrameLoop";
import { clamp, fitGraph, graphBounds, screenToWorld, zoomAt } from "./graphGeometry";
import { ClassicGraphPainter, folderColors, VolumeGraphPainter, type GraphPainter } from "./graphPainters";
import type { GraphLayoutRequest, GraphLayoutResponse } from "./graphWorkerProtocol";
import type { GraphAppearance, GraphCamera, GraphData, GraphMapSnapshot, GraphMode } from "./graphTypes";
import GraphLayoutWorker from "../workers/graphLayout.worker.ts?worker&inline";
import { classicNodeColor, classicNodeRadius } from "./graphStyle";
import { seedClassicLayout } from "./graphSeedLayout";

export type GraphSceneSnapshot = { positions: Map<string, [number, number]>; camera: GraphCamera; userInteracted: boolean };
export type GraphSceneCallbacks = {
  select: (key: string) => void;
  open: (key: string) => void;
  context: (key: string, x: number, y: number, pinned: boolean) => void;
  minimap: (snapshot: GraphMapSnapshot) => void;
  error: (message: string) => void;
};

/** Shared gestures/worker lifecycle; drawing is deliberately different for the two modes. */
export class GraphScene {
  private painter: GraphPainter | null = null;
  private worker: Worker | null = null;
  private positions: Float32Array;
  private active: Uint8Array;
  private radii: number[];
  private maximumDegree = 0;
  private colors: number[];
  private mapColors: string[];
  private keys: Map<string, number>;
  private nodes: PhysicsNode[];
  private groups: number[][] = [];
  private clusterIds: Int32Array;
  private camera: GraphCamera = { x: 0, y: 0, scale: 1 };
  private target: GraphCamera | null = null;
  private width = 1;
  private height = 1;
  private hovered = -1;
  private selected = -1;
  private pins = new Set<number>();
  private focused: number | null = null;
  private filter: Set<string> | null = null;
  private destroyed = false;
  private userInteracted = false;
  private background = false;
  private moving = true;
  private lastInteraction = 0;
  private lastMap = 0;
  private frames = 0;
  private metricsStarted = performance.now();
  private metricsMs = 0;
  private latestSimulationMs = 0;
  private paintCount = 0;
  private paintMsTotal = 0;
  private geometryVersion = 0;
  private dragged = -1;
  private dragPinned = false;
  private dragging = false;
  private down: { x: number; y: number; camera: GraphCamera } | null = null;
  private observer: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private loop: GraphFrameLoop;
  private hitBuckets = new Map<string, number[]>();
  private nodeByKey: Map<string, number>;
  private cleanup: Array<() => void> = [];

  constructor(
    private host: HTMLElement,
    private data: GraphData,
    private mode: GraphMode,
    private appearance: GraphAppearance,
    private callbacks: GraphSceneCallbacks,
    private previous?: GraphSceneSnapshot,
  ) {
    this.nodeByKey = this.keys = new Map(data.nodes.map((node, index) => [node.key, index]));
    this.positions = new Float32Array(data.nodes.length * 2);
    this.active = new Uint8Array(data.nodes.length).fill(1);
    this.colors = this.nodeColors();
    this.mapColors = this.minimapColors();
    this.radii = data.nodes.map((node) => mode === "volume"
      ? (node.kind === "folder" ? 6 : 4.5) + Math.min(1.5 * Math.sqrt(node.degree), 14)
      : classicNodeRadius(node.degree, 1, appearance.nodeSize));
    for (const node of data.nodes) this.maximumDegree = Math.max(this.maximumDegree, node.degree);
    const grouped = new Map<string, number[]>();
    if (mode === "volume") data.nodes.forEach((node, index) => {
      if (node.group) { const values = grouped.get(node.group) ?? []; values.push(index); grouped.set(node.group, values); }
    });
    const groupIds = new Map([...grouped.keys()].sort().map((name, index) => [name, index]));
    this.groups = [...grouped.values()].filter((values) => values.length > 1);
    this.clusterIds = new Int32Array(data.nodes.map((node) => groupIds.get(node.group) ?? -1));
    const classicSeed = mode === "obsidian" ? seedClassicLayout(data, appearance.linkDistance) : null;
    this.nodes = data.nodes.map((node, index) => {
      const group = this.clusterIds[index];
      const groupAngle = Math.max(0, group) / Math.max(1, groupIds.size) * Math.PI * 2;
      const groupDistance = mode === "volume" && group >= 0 ? 80 + groupIds.size * 20 : 0;
      const radius = mode === "volume" ? Math.sqrt(index % 30 + 1) * 12 : Math.sqrt(index + 1) * 18;
      const angle = index * 2.39996323;
      const saved = previous?.positions.get(node.key);
      const x = saved?.[0] ?? classicSeed?.[index * 2] ?? Math.cos(groupAngle) * groupDistance + Math.cos(angle) * radius;
      const y = saved?.[1] ?? classicSeed?.[index * 2 + 1] ?? Math.sin(groupAngle) * groupDistance + Math.sin(angle) * radius;
      this.positions[index * 2] = x; this.positions[index * 2 + 1] = y;
      return { x, y, px: x, py: y, mass: 1 + 0.5 * Math.sqrt(node.degree), charge: 1, radius: this.radii[index], active: true, fixed: false };
    });
    this.loop = new GraphFrameLoop(this.paint);
  }

  async start() {
    this.painter = this.mode === "volume"
      ? await VolumeGraphPainter.create(this.host, this.data, this.radii, this.colors)
      : new ClassicGraphPainter(this.data);
    if (this.destroyed) { this.painter.destroy(); return; }
    const canvas = this.painter.canvas;
    canvas.className = "graph-scene-canvas"; canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", this.mode === "volume" ? "Объёмный граф: колесо — масштаб, перетаскивание — перемещение" : "Граф в стиле Obsidian: колесо — масштаб, перетаскивание — перемещение");
    this.host.appendChild(canvas);
    this.width = Math.max(1, this.host.clientWidth); this.height = Math.max(1, this.host.clientHeight);
    this.painter.resize(this.width, this.height);
    this.camera = this.previous?.camera ?? fitGraph(graphBounds(this.positions, this.active), this.width, this.height);
    this.userInteracted = this.previous?.userInteracted ?? false;
    this.rebuildHitIndex();
    this.bindEvents(canvas);
    this.themeObserver = new MutationObserver(() => {
      this.colors = this.nodeColors(); this.mapColors = this.minimapColors();
      this.loop.request(); this.publishMap(true);
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    this.observer = new ResizeObserver(() => {
      const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
      if (width === this.width && height === this.height) return;
      this.camera.x += (width - this.width) / 2; this.camera.y += (height - this.height) / 2;
      this.width = width; this.height = height; this.painter?.resize(width, height);
      this.loop.request(); this.publishMap(true);
    });
    this.observer.observe(this.host);
    // Inline workers use a Blob URL, including in WKWebView's custom Tauri origin.
    this.worker = new GraphLayoutWorker();
    this.worker.onmessage = ({ data }: MessageEvent<GraphLayoutResponse>) => {
      if (this.destroyed) return;
      if (data.type === "error") { this.loop.setEnabled(false); this.callbacks.error(data.message); return; }
      const dragX = this.dragged >= 0 ? this.positions[this.dragged * 2] : 0;
      const dragY = this.dragged >= 0 ? this.positions[this.dragged * 2 + 1] : 0;
      this.positions.set(data.positions);
      this.geometryVersion++;
      if (this.dragged >= 0 && this.dragging) { this.positions[this.dragged * 2] = dragX; this.positions[this.dragged * 2 + 1] = dragY; }
      this.latestSimulationMs = data.simulationMs; this.moving = !data.settled;
      if (import.meta.env.DEV) this.host.dataset.graphMoving = String(this.moving);
      this.rebuildHitIndex();
      if (!this.userInteracted && this.focused === null) this.camera = fitGraph(graphBounds(this.positions, this.active), this.width, this.height);
      this.send({ type: "recycle", buffer: data.positions.buffer as ArrayBuffer });
      this.loop.request(); this.publishMap(data.settled);
    };
    this.worker.onerror = (event) => { if (!this.destroyed) { this.loop.setEnabled(false); this.callbacks.error(event.message || "Не удалось рассчитать расположение узлов"); } };
    this.send({ type: "init", nodes: this.nodes, edges: this.data.edges.map((edge) => ({ a: edge.a, b: edge.b, rest: this.radii[edge.a] + this.radii[edge.b] + this.appearance.linkDistance })), settings: this.forceSettings(), groups: this.groups, clusterIds: this.clusterIds, cooling: this.mode === "obsidian" ? 0.992 : 0.982 });
    this.background = document.hidden;
    this.synchronizeActivity();
    this.loop.request(); this.publishMap(true);
  }

  private forceSettings(): ForceSettings {
    return { ...DEFAULT_FORCE_SETTINGS, repulsion: this.appearance.repulsion, damping: this.appearance.damping, gravity: this.appearance.centerForce,
      stiffness: this.appearance.linkStrength, springLog: this.mode === "volume",
      interCluster: this.mode === "volume" ? this.appearance.clusterSeparation : 0,
      intraRepulsion: this.mode === "volume" ? this.appearance.internalRepulsion : 0,
      cohesion: this.mode === "volume" ? this.appearance.cohesion : 0 };
  }

  setAppearance(value: GraphAppearance) {
    const simulationChanged = value.repulsion !== this.appearance.repulsion || value.damping !== this.appearance.damping || value.centerForce !== this.appearance.centerForce || value.linkDistance !== this.appearance.linkDistance || value.linkStrength !== this.appearance.linkStrength || value.cohesion !== this.appearance.cohesion || value.clusterSeparation !== this.appearance.clusterSeparation || value.internalRepulsion !== this.appearance.internalRepulsion;
    const colorChanged = value.colorByFolder !== this.appearance.colorByFolder || value.colorGroups !== this.appearance.colorGroups;
    const radiusChanged = this.mode === "obsidian" && value.nodeSize !== this.appearance.nodeSize;
    this.appearance = value;
    if (radiusChanged) this.radii = this.data.nodes.map((node) => classicNodeRadius(node.degree, 1, value.nodeSize));
    if (colorChanged) this.colors = this.nodeColors();
    this.mapColors = this.minimapColors();
    if (simulationChanged || radiusChanged) this.send({ type: "settings", settings: this.forceSettings(), linkDistance: value.linkDistance, radii: radiusChanged ? this.radii : undefined });
    this.synchronizeActivity(); this.loop.request(); this.publishMap(true);
  }

  private minimapColors() {
    return this.data.nodes.map((node, index) => this.mode === "obsidian" || this.appearance.colorByFolder
      ? `#${this.colors[index].toString(16).padStart(6, "0")}`
      : node.kind === "unresolved" ? "#676771" : node.kind === "tag" ? "#7bbba4" : node.kind === "attachment" ? "#ad9875" : "#b7b7c1");
  }

  private nodeColors() {
    const folders = folderColors(this.data);
    return this.mode === "volume" ? folders : this.data.nodes.map((node, index) => classicNodeColor(node, this.appearance.colorGroups, this.appearance.colorByFolder ? folders[index] : 0x8e91a6));
  }

  setSelected(key: string | null) { this.selected = key === null ? -1 : this.keys.get(key) ?? -1; this.loop.request(); }

  setFilter(noteIds: Set<string> | null) {
    if (noteIds === null && this.filter === null && this.focused === null) return;
    this.filter = noteIds;
    this.applyActive();
  }

  private applyActive() {
    const visibleFolders = new Set<string>();
    if (this.filter) for (const node of this.data.nodes) {
      if (!node.note || !this.filter.has(node.path)) continue;
      const segments = node.group.split("/");
      for (let i = 1; i <= segments.length; i++) visibleFolders.add(segments.slice(0, i).join("/"));
    }
    const focused = new Set<number>();
    if (this.focused !== null) {
      focused.add(this.focused); const queue: Array<[number, number]> = [[this.focused, 0]];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const [index, depth] = queue[cursor]; if (depth >= 2) continue;
        for (const next of this.data.adjacency[index]) if (!focused.has(next)) { focused.add(next); queue.push([next, depth + 1]); }
      }
    }
    for (let index = 0; index < this.data.nodes.length; index++) {
      const node = this.data.nodes[index];
      const passes = !this.filter || (node.kind === "note" ? this.filter.has(node.path)
        : node.kind === "folder" ? visibleFolders.has(node.path)
          : this.data.adjacency[index].some((next) => this.filter!.has(this.data.nodes[next].path)));
      this.active[index] = Number(passes && (this.focused === null || focused.has(index)));
    }
    this.send({ type: "active", values: this.active });
    this.geometryVersion++;
    this.synchronizeActivity(); this.fit();
  }

  focus(key: string) {
    const index = this.nodeByKey.get(key);
    if (index === undefined) {
      if (key.startsWith("f:")) {
        const path = key.slice(2); const noteIds = new Set(this.data.nodes.filter((node) => node.note && (node.group === path || node.group.startsWith(`${path}/`))).map((node) => node.path));
        if (noteIds.size) this.setFilter(noteIds);
      }
      return;
    }
    this.focused = index; this.selected = index; this.applyActive(); this.callbacks.select(key);
  }

  clearFocus() { this.focused = null; this.applyActive(); }

  fit() { this.target = fitGraph(graphBounds(this.positions, this.active), this.width, this.height); this.userInteracted = true; this.loop.request(); }

  center(x: number, y: number) {
    this.target = { ...this.camera, x: this.width / 2 - x * this.camera.scale, y: this.height / 2 - y * this.camera.scale };
    this.userInteracted = true; this.loop.request();
  }

  togglePin(key: string) {
    const index = this.keys.get(key); if (index === undefined) return;
    if (this.pins.has(index)) this.pins.delete(index); else this.pins.add(index);
    this.send({ type: "pin", index, fixed: this.pins.has(index) }); this.loop.request();
  }

  zoom(factor: number) { this.target = null; this.camera = zoomAt(this.camera, this.width / 2, this.height / 2, factor); this.userInteracted = true; this.loop.request(); this.publishMap(true); }

  snapshot(): GraphSceneSnapshot {
    return { camera: { ...this.camera }, userInteracted: this.userInteracted, positions: new Map(this.data.nodes.map((node, index) => [node.key, [this.positions[index * 2], this.positions[index * 2 + 1]]])) };
  }

  private send(value: GraphLayoutRequest) { if (!this.destroyed) this.worker?.postMessage(value, value.type === "recycle" ? [value.buffer] : []); }

  private synchronizeActivity() {
    this.loop.setEnabled(!this.background);
    this.send({ type: this.background || this.appearance.frozen || this.focused !== null || this.filter !== null ? "pause" : "resume" });
  }

  private paint = (now: number, delta: number): boolean => {
    if (!this.painter || this.destroyed) return false;
    const started = performance.now();
    if (this.target) {
      const fraction = 1 - Math.exp(-delta / 75);
      this.camera.x += (this.target.x - this.camera.x) * fraction; this.camera.y += (this.target.y - this.camera.y) * fraction;
      this.camera.scale += (this.target.scale - this.camera.scale) * fraction;
      if (Math.abs(this.target.x - this.camera.x) < 0.5 && Math.abs(this.target.y - this.camera.y) < 0.5 && Math.abs(this.target.scale - this.camera.scale) < 0.0005) { this.camera = this.target; this.target = null; }
    }
    const breathe = this.mode === "volume" && this.appearance.breathing && !matchMedia("(prefers-reduced-motion: reduce)").matches && now - this.lastInteraction < 1600;
    this.painter.paint({ positions: this.positions, active: this.active, camera: this.camera, appearance: this.appearance, hovered: this.hovered, selected: this.selected, radii: this.radii, colors: this.colors, now, pulse: breathe ? 1 + Math.sin(now / 650) * 0.012 : 1, geometryVersion: this.geometryVersion, moving: this.moving });
    const workMs = performance.now() - started;
    this.frames++; this.metricsMs += workMs; this.paintCount++; this.paintMsTotal += workMs;
    if (import.meta.env.DEV) {
      this.host.dataset.graphPaintCount = String(this.paintCount);
      this.host.dataset.graphPaintMsTotal = String(this.paintMsTotal);
      this.host.dataset.graphLastPaint = String(now);
    }
    if (import.meta.env.DEV && now - this.metricsStarted >= 500) {
      this.host.dataset.graphMetrics = JSON.stringify({ frames: this.frames, fps: this.frames * 1000 / (now - this.metricsStarted), renderSubmissionMs: this.metricsMs / this.frames, simulationMs: this.latestSimulationMs, moving: this.moving, mode: this.mode, nodes: this.data.nodes.length });
      this.frames = 0; this.metricsMs = 0; this.metricsStarted = now;
    }
    this.publishMap(false);
    return Boolean(this.target || breathe);
  };

  private publishMap(force: boolean) {
    const now = performance.now(); if (!force && now - this.lastMap < 120) return;
    this.lastMap = now;
    this.callbacks.minimap({ positions: this.positions, active: this.active, colors: this.mapColors, bounds: graphBounds(this.positions, this.active), camera: { ...this.camera }, width: this.width, height: this.height });
  }

  private rebuildHitIndex() {
    this.hitBuckets.clear();
    for (let index = 0; index < this.data.nodes.length; index++) {
      const key = `${Math.floor(this.positions[index * 2] / 64)},${Math.floor(this.positions[index * 2 + 1] / 64)}`;
      const values = this.hitBuckets.get(key) ?? []; values.push(index); this.hitBuckets.set(key, values);
    }
  }

  private hit(x: number, y: number): number {
    const world = screenToWorld(x, y, this.camera);
    const radius = this.mode === "obsidian" ? (classicNodeRadius(this.maximumDegree, this.camera.scale, this.appearance.nodeSize) + 6) / this.camera.scale : 20 + 6 / this.camera.scale;
    let nearest = -1, distance = Infinity;
    for (let cx = Math.floor((world.x - radius) / 64); cx <= Math.floor((world.x + radius) / 64); cx++) {
      for (let cy = Math.floor((world.y - radius) / 64); cy <= Math.floor((world.y + radius) / 64); cy++) {
        for (const index of this.hitBuckets.get(`${cx},${cy}`) ?? []) {
          if (!this.active[index]) continue;
          const dx = this.positions[index * 2] - world.x, dy = this.positions[index * 2 + 1] - world.y;
          const squared = dx * dx + dy * dy;
          const hitRadius = (this.mode === "obsidian" ? classicNodeRadius(this.data.nodes[index].degree, this.camera.scale, this.appearance.nodeSize) / this.camera.scale : this.radii[index]) + 6 / this.camera.scale;
          if (squared <= hitRadius ** 2 && squared < distance) { nearest = index; distance = squared; }
        }
      }
    }
    return nearest;
  }

  private bindEvents(canvas: HTMLCanvasElement) {
    const point = (event: MouseEvent | PointerEvent) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const listen = <K extends keyof HTMLElementEventMap>(kind: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) => {
      canvas.addEventListener(kind, handler as EventListener, options); this.cleanup.push(() => canvas.removeEventListener(kind, handler as EventListener, options));
    };
    listen("pointerdown", (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      this.background = document.hidden; this.synchronizeActivity(); canvas.focus({ preventScroll: true });
      const p = point(event); this.down = { ...p, camera: { ...this.camera } }; this.dragging = false;
      this.dragged = event.button === 0 ? this.hit(p.x, p.y) : -1;
      this.dragPinned = this.pins.has(this.dragged); this.target = null; this.userInteracted = true;
      if (this.dragged >= 0) this.send({ type: "pin", index: this.dragged, fixed: true });
      canvas.setPointerCapture(event.pointerId); event.preventDefault();
    });
    listen("pointermove", (event) => {
      const p = point(event);
      if (this.down) {
        this.dragging ||= Math.hypot(p.x - this.down.x, p.y - this.down.y) > 4;
        if (this.dragged >= 0 && this.dragging) {
          const world = screenToWorld(p.x, p.y, this.camera);
          this.positions[this.dragged * 2] = world.x; this.positions[this.dragged * 2 + 1] = world.y;
          this.send({ type: "pin", index: this.dragged, fixed: true, ...world }); this.rebuildHitIndex();
        } else if (this.dragged < 0) {
          this.camera.x = this.down.camera.x + p.x - this.down.x; this.camera.y = this.down.camera.y + p.y - this.down.y;
        }
        this.lastInteraction = performance.now(); this.loop.request(); this.publishMap(true);
      } else {
        const hover = this.hit(p.x, p.y);
        if (hover !== this.hovered) { this.hovered = hover; canvas.style.cursor = hover >= 0 ? "pointer" : "grab"; this.loop.request(); }
      }
    });
    const release = (event: PointerEvent, canceled = false) => {
      if (this.dragged >= 0) this.send({ type: "pin", index: this.dragged, fixed: this.dragPinned });
      if (!canceled && this.down && !this.dragging && this.dragged >= 0) {
        const key = this.data.nodes[this.dragged].key;
        if (event.shiftKey) this.focus(key);
        else if (this.mode === "obsidian") this.callbacks.open(key);
        else { this.selected = this.dragged; this.callbacks.select(key); this.loop.request(); }
      }
      this.down = null; this.dragged = -1; this.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    listen("pointerup", (event) => release(event)); listen("pointercancel", (event) => release(event, true));
    listen("pointerleave", () => { if (!this.down && this.hovered >= 0) { this.hovered = -1; this.loop.request(); } });
    listen("dblclick", (event) => { const p = point(event), index = this.hit(p.x, p.y); if (index >= 0) this.callbacks.open(this.data.nodes[index].key); });
    listen("contextmenu", (event) => { event.preventDefault(); const p = point(event), index = this.hit(p.x, p.y); if (index >= 0) this.callbacks.context(this.data.nodes[index].key, event.clientX, event.clientY, this.pins.has(index)); });
    listen("wheel", (event) => { event.preventDefault(); const p = point(event); this.target = null; this.camera = zoomAt(this.camera, p.x, p.y, Math.exp(-clamp(event.deltaY, -120, 120) * 0.0025)); this.userInteracted = true; this.lastInteraction = performance.now(); this.loop.request(); this.publishMap(true); }, { passive: false });
    listen("keydown", (event) => {
      if (event.key === "Home" || event.key === "0") { event.preventDefault(); this.fit(); }
      else if (event.key === "Escape") this.clearFocus();
      else if (event.key === "+" || event.key === "=") this.zoom(1.2);
      else if (event.key === "-") this.zoom(1 / 1.2);
      else if (event.key.startsWith("Arrow")) {
        event.preventDefault(); const distance = event.shiftKey ? 100 : 35;
        this.camera.x += event.key === "ArrowLeft" ? distance : event.key === "ArrowRight" ? -distance : 0;
        this.camera.y += event.key === "ArrowUp" ? distance : event.key === "ArrowDown" ? -distance : 0;
        this.userInteracted = true; this.loop.request(); this.publishMap(true);
      }
    });
    const hide = () => { this.background = true; this.synchronizeActivity(); };
    const show = () => { this.background = document.hidden; this.synchronizeActivity(); };
    window.addEventListener("blur", hide); window.addEventListener("focus", show); document.addEventListener("visibilitychange", show);
    this.cleanup.push(() => { window.removeEventListener("blur", hide); window.removeEventListener("focus", show); document.removeEventListener("visibilitychange", show); });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.loop.destroy(); this.worker?.terminate(); this.observer?.disconnect(); this.themeObserver?.disconnect();
    for (const cleanup of this.cleanup) cleanup(); this.cleanup = [];
    this.painter?.destroy(); this.painter = null;
    this.hitBuckets.clear();
  }
}
