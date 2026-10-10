import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Worker } from "node:worker_threads";

const directory = await mkdtemp(join(tmpdir(), "synapse-graph-tests-"));
const bundle = join(directory, "graph.mjs");
await build({ stdin: { contents: `export * from './src/lib/graphData.ts'; export * from './src/lib/graphReferences.ts'; export * from './src/lib/graphGeometry.ts'; export * from './src/lib/graphFrameLoop.ts'; export * from './src/lib/forceLayout.ts'; export * from './src/lib/graphStyle.ts'; export * from './src/lib/graphSeedLayout.ts';`, resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", outfile: bundle });
const { buildGraphData, makeGraphResolver, collectGraphReferences, zoomAt, screenToWorld, graphBounds, clampMinimapPosition, GraphFrameLoop, ForceLayout, DEFAULT_FORCE_SETTINGS, coerceGraphStyle, readObsidianGraphPreferences, matchesGraphQuery, classicNodeColor, classicNodeRadius, seedClassicLayout } = await import(pathToFileURL(bundle));
const options = { showOrphans: true, showUnresolved: true, showTags: false, showAttachments: false };
const note = (id, title = id.split('/').pop(), links = [], tags = []) => ({ id, title, folder: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '', createdAt: 1, updatedAt: 1, icon: null, cover: null, preview: '', favorite: false, tags, links, mood: null });
const treeOf = (notes) => notes.map(note => ({ kind: 'note', note }));

test('Copied Obsidian colors, display sizes and force preferences are bounded and preserved', () => {
  const preset = readObsidianGraphPreferences({ colorGroups: [{ query: 'path:"DBA RoadMap"', color: { a: 1, rgb: 7306466 } }, { query: 'bad', color: 'url(unsafe)' }], nodeSizeMultiplier: 1.31624218051832, lineSizeMultiplier: 0.757110142984808, linkDistance: 250, repelStrength: 10, centerStrength: 0.518713248970312 });
  assert.deepEqual(preset.style.colorGroups, [{ query: 'path:"DBA RoadMap"', color: '#6f7ce2' }]);
  assert.equal(preset.style.nodeSize, 1.31624218051832);
  assert.equal(preset.linkDistance, 250);
  assert.equal(preset.repulsion, 100000);
  assert(Math.abs(preset.centerForce - 0.00518713248970312) < 1e-15);
  assert.equal(coerceGraphStyle({ nodeSize: Infinity, lineWidth: -10 }).nodeSize, 1);
  assert.equal(coerceGraphStyle({ lineWidth: -10 }).lineWidth, 0.2);
});

test('Color groups follow quoted path, file and tag rules with first-match priority', () => {
  const meta = note('Ascend/RoadMaps/DBA RoadMap/SELECT', 'SELECT', [], ['sql']);
  const node = { path: meta.id, label: meta.title, note: meta, kind: 'note' };
  assert(matchesGraphQuery(node, 'path:"DBA RoadMap" tag:#sql'));
  assert(matchesGraphQuery(node, 'path:Linux OR file:select'));
  assert(!matchesGraphQuery(node, 'path:"DBA RoadMap" -tag:sql'));
  assert.equal(classicNodeColor(node, [{query:'tag:#sql',color:'#b1df52'},{query:'path:DBA',color:'#6f7ce2'}]), 0xb1df52);
  assert(classicNodeRadius(100, 0.1) > classicNodeRadius(1, 0.1) * 3);
});

test('Connectivity seeding exposes a star and separates a disconnected component deterministically', () => {
  const notes = [note('Hub'), ...Array.from({length:20}, (_, i) => note(`Leaf${i}`)), note('Island')];
  const references = { Hub: notes.slice(1,21).map(meta=>({target:meta.title,embedded:false})) };
  const graph = buildGraphData(treeOf(notes), 'obsidian', references, options);
  const positions = seedClassicLayout(graph, 160);
  assert.deepEqual(positions, seedClassicLayout(graph, 160));
  assert([...positions].every(Number.isFinite));
  const hub = graph.nodes.findIndex(node => node.path === 'Hub');
  const island = graph.nodes.findIndex(node => node.path === 'Island');
  const distances = graph.adjacency[hub].map(index => Math.hypot(positions[index*2]-positions[hub*2],positions[index*2+1]-positions[hub*2+1]));
  assert(Math.max(...distances) - Math.min(...distances) < 0.001);
  assert(Math.hypot(positions[island*2]-positions[hub*2],positions[island*2+1]-positions[hub*2+1]) > Math.max(...distances));
});

test('Markdown edges exclude code and escaped wiki syntax, retaining real links and embeds', () => {
  const refs = collectGraphReferences('[[A#header|shown]] ![[image.png|200]] `[[Code]]`\n~~~md\n[[Fence]]\n~~~\n\\[[Literal]] [link](B.md#part)\n[ref][id]\n\n[id]: C.md\n');
  assert.deepEqual(refs.map(ref => ref.target), ['A#header|shown', 'image.png|200', 'B.md#part', 'C.md']);
  assert.equal(refs.find(ref => ref.target.startsWith('image')).embedded, true);
});

test('Physical paths and source-folder duplicate resolution replace first-title wins', () => {
  const notes = [note('B/Target'), note('A/Target'), note('A/Source'), note('A/uuid', 'Custom')];
  const resolve = makeGraphResolver(notes);
  assert.equal(resolve('Target#heading|alias', 'A/Source').id, 'A/Target');
  assert.equal(resolve('../B/Target.md', 'A/Source').id, 'B/Target');
  assert.equal(resolve('/B/Target', 'A/Source').id, 'B/Target');
  assert.equal(resolve('A/Custom', 'A/Source').id, 'A/uuid');
  assert.equal(resolve('../../Outside', 'A/Source'), null);
});

test('Classic mode contains link nodes, volume retains folders and structural edges', () => {
  const a = note('Folder/A', 'A'), b = note('Folder/B', 'B');
  const tree = [{ kind: 'folder', path: 'Folder', name: 'Folder', children: treeOf([a, b]) }];
  const refs = { 'Folder/A': [{ target: 'B', embedded: false }], 'Folder/B': [] };
  const classic = buildGraphData(tree, 'obsidian', refs, options);
  const volume = buildGraphData(tree, 'volume', refs, options);
  assert.equal(classic.nodes.length, 2);
  assert.equal(classic.edges.length, 1);
  assert.equal(volume.nodes.filter(node => node.kind === 'folder').length, 1);
  assert.equal(volume.edges.filter(edge => edge.kind === 'contains').length, 2);
  assert.equal(volume.edges.filter(edge => edge.kind === 'link').length, 1);
});

test('Unresolved, tags, attachments and orphan filtering keep correct remapped adjacency', () => {
  const notes = [note('A', 'A', [], ['work']), note('Lonely')];
  const refs = { A: [{ target: 'Missing', embedded: false }, { target: 'image.png', embedded: true }], Lonely: [] };
  const graph = buildGraphData(treeOf(notes), 'obsidian', refs, { ...options, showTags: true, showAttachments: true, showOrphans: false }, ['image.png']);
  assert.deepEqual(graph.nodes.map(node => node.kind), ['note', 'unresolved', 'attachment', 'tag']);
  assert.equal(graph.edges.length, 3);
  assert.deepEqual(graph.adjacency[0], [1, 2, 3]);
  const noUnknown = buildGraphData(treeOf(notes), 'obsidian', refs, { ...options, showUnresolved: false });
  assert.equal(noUnknown.nodes.some(node => node.kind === 'unresolved'), false);
});

test('Self links and duplicate references do not create extra edges', () => {
  const notes = [note('A'), note('B')];
  const graph = buildGraphData(treeOf(notes), 'obsidian', { A: [{ target: '#header', embedded: false }, { target: 'B', embedded: false }, { target: 'B#x|alias', embedded: true }], B: [{ target: 'A', embedded: false }] }, options);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual(graph.nodes.map(node => node.degree), [1, 1]);
});

test('Zoom preserves the world point under the pointer and bounds ignore hidden nodes', () => {
  const camera = { x: 50, y: 70, scale: 0.7 };
  const point = screenToWorld(120, 80, camera);
  const after = screenToWorld(120, 80, zoomAt(camera, 120, 80, 2.4));
  assert.ok(Math.abs(point.x - after.x) < 1e-8);
  assert.ok(Math.abs(point.y - after.y) < 1e-8);
  assert.deepEqual(graphBounds(new Float32Array([1, 2, 999, 999]), new Uint8Array([1, 0])), { minX: 1, minY: 2, maxX: 1, maxY: 2 });
});

test('Minimap stays recoverable after drag/resize and collapsed height changes bounds', () => {
  assert.deepEqual(clampMinimapPosition(-500, 900, 400, 300, 194, 164), { x: 8, y: 128 });
  assert.deepEqual(clampMinimapPosition(900, 900, 400, 300, 194, 32), { x: 198, y: 260 });
});

test('Invalidation loop stops, coalesces requests, pauses and resumes without idle RAF', () => {
  let sequence = 0; const callbacks = new Map(); let paints = 0;
  globalThis.requestAnimationFrame = callback => { callbacks.set(++sequence, callback); return sequence; };
  globalThis.cancelAnimationFrame = id => callbacks.delete(id);
  const flush = time => { const pending = [...callbacks.values()]; callbacks.clear(); for (const callback of pending) callback(time); };
  const loop = new GraphFrameLoop(() => { paints++; return false; });
  loop.request(); loop.request(); assert.equal(callbacks.size, 1);
  flush(100); assert.equal(paints, 1); assert.equal(callbacks.size, 0);
  loop.request(); loop.setEnabled(false); assert.equal(callbacks.size, 0);
  loop.setEnabled(true); flush(200); assert.equal(paints, 2); assert.equal(callbacks.size, 0);
  loop.destroy(); loop.request(); assert.equal(callbacks.size, 0);
});

test('Cooling changes forces only when explicitly requested; zero alpha leaves resting nodes stationary', () => {
  const nodes = [{ x: -10, y: 0, px: -10, py: 0, mass: 1, charge: 1, radius: 4, active: true, fixed: false }, { x: 10, y: 0, px: 10, py: 0, mass: 1, charge: 1, radius: 4, active: true, fixed: false }];
  const layout = new ForceLayout(nodes, [], DEFAULT_FORCE_SETTINGS, []);
  assert.equal(layout.step(0), 0);
  assert.equal(nodes[0].x, -10);
  assert.ok(layout.step() > 0);
});

test('Layout Worker pauses computation, still accepts dragging, resumes and settles without perpetual timer', async () => {
  const workerCode = join(directory, 'layout-worker.mjs');
  await build({ entryPoints: ['src/workers/graphLayout.worker.ts'], bundle: true, platform: 'node', format: 'esm', outfile: workerCode });
  const wrapper = join(directory, 'worker-wrapper.mjs');
  await import('node:fs/promises').then(fs => fs.writeFile(wrapper, `import { parentPort } from 'node:worker_threads'; globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer), onmessage: null }; await import('./layout-worker.mjs'); parentPort.on('message', data => self.onmessage({data}));`));
  const worker = new Worker(pathToFileURL(wrapper));
  const frames = [];
  worker.on('message', data => { if (data.type === 'frame') frames.push({ ...data, positions: Array.from(data.positions) }); });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { const deadline = Date.now() + 3000; while (!predicate() && Date.now() < deadline) await sleep(10); assert.ok(predicate()); };
  const initial = [0, 1].map(index => ({ x: index * 100, y: 0, px: index * 100, py: 0, mass: 1, charge: 1, radius: 4, active: true, fixed: false }));
  try {
    worker.postMessage({ type: 'init', nodes: initial, edges: [], settings: DEFAULT_FORCE_SETTINGS, groups: [], clusterIds: new Int32Array([-1, -1]) });
    worker.postMessage({ type: 'pause' });
    await wait(() => frames.length > 0); await sleep(50);
    const pausedCount = frames.length; await sleep(70); assert.equal(frames.length, pausedCount);
    worker.postMessage({ type: 'pin', index: 0, fixed: true, x: 50, y: -10 });
    await wait(() => frames.length > pausedCount); assert.deepEqual(frames.at(-1).positions.slice(0, 2), [50, -10]);
    const pinnedCount = frames.length;
    worker.postMessage({ type: 'resume' }); await wait(() => frames.length > pinnedCount);
    worker.postMessage({ type: 'init', nodes: initial.map(node => ({ ...node, fixed: true })), edges: [], settings: DEFAULT_FORCE_SETTINGS, groups: [], clusterIds: new Int32Array([-1, -1]) });
    await wait(() => frames.some(frame => frame.settled));
    const settledCount = frames.length; await sleep(80); assert.equal(frames.length, settledCount);
  } finally { await worker.terminate(); }
});

test.after(async () => { await rm(directory, { recursive: true, force: true }); });
