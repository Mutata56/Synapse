import type { NoteMeta, TreeNode } from "./storage";
import { flattenNotes } from "./treeUtils";
import { boundedVaultPath, wikiTarget } from "./obsidianImport";
import type { GraphData, GraphMode, GraphNode, GraphOptions, GraphReferenceMap } from "./graphTypes";

const normalize = (value: string) => value.normalize("NFC").toLowerCase();
const stem = (value: string) => value.replace(/\.md$/i, "");
const basename = (value: string) => value.slice(value.lastIndexOf("/") + 1);

/** Resolve physical paths before display titles; duplicate names prefer the source folder. */
export function makeGraphResolver(notes: readonly NoteMeta[]) {
  const paths = new Map(notes.map((note) => [normalize(stem(note.id)), note]));
  const names = new Map<string, NoteMeta[]>();
  for (const note of notes) {
    for (const name of new Set([normalize(basename(note.id)), normalize(note.title.trim())])) {
      const candidates = names.get(name) ?? [];
      candidates.push(note);
      names.set(name, candidates);
    }
  }
  return (reference: string, sourceId: string): NoteMeta | null => {
    let target = wikiTarget(reference).path.trim();
    try { target = decodeURIComponent(target); } catch { /* a literal percent is allowed */ }
    if (!target) return paths.get(normalize(sourceId)) ?? null;
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;
    const rooted = target.startsWith("/");
    target = stem(target.replace(/^\/+/, ""));
    const sourceFolder = sourceId.includes("/") ? sourceId.slice(0, sourceId.lastIndexOf("/")) : "";
    const relative = boundedVaultPath(target, sourceFolder);
    const root = boundedVaultPath(target);
    const attempts = target.startsWith("./") || target.startsWith("../") ? [relative, root] : [root, relative];
    for (const path of rooted ? [root] : attempts) {
      const found = path ? paths.get(normalize(path)) : null;
      if (found) return found;
    }
    if (rooted || (!root && !relative)) return null;
    const key = normalize(target);
    const candidates = target.includes("/")
      ? (names.get(normalize(basename(target))) ?? []).filter((note) => normalize(note.id).endsWith(`/${key}`) || normalize(`${note.folder}/${note.title}`) === key)
      : names.get(key) ?? [];
    return [...candidates].sort((a, b) => {
      const aLocal = a.folder === sourceFolder ? 0 : 1;
      const bLocal = b.folder === sourceFolder ? 0 : 1;
      return aLocal - bLocal || a.id.length - b.id.length || a.id.localeCompare(b.id);
    })[0] ?? null;
  };
}

export function buildGraphData(
  tree: TreeNode[],
  mode: GraphMode,
  references: GraphReferenceMap | null,
  options: GraphOptions,
  files: readonly string[] = [],
): GraphData {
  const notes = flattenNotes(tree);
  const nodes: GraphNode[] = [];
  const edges: GraphData["edges"] = [];
  const keys = new Map<string, number>();
  const edgeKeys = new Set<string>();
  const addNode = (node: Omit<GraphNode, "degree">): number => {
    const found = keys.get(node.key);
    if (found !== undefined) return found;
    const index = nodes.length;
    keys.set(node.key, index);
    nodes.push({ ...node, degree: 0 });
    return index;
  };
  const addEdge = (a: number, b: number, kind: "link" | "contains") => {
    if (a === b) return;
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ a, b, kind });
    nodes[a].degree++;
    nodes[b].degree++;
  };
  for (const note of notes) addNode({ key: `n:${note.id}`, path: note.id, label: note.title || basename(note.id), kind: "note", group: note.folder, note });
  if (mode === "volume") {
    const walk = (children: TreeNode[], parent: number | null) => {
      for (const item of children) {
        if (item.kind === "folder") {
          const index = addNode({ key: `f:${item.path}`, path: item.path, label: item.name, kind: "folder", group: item.path });
          if (parent !== null) addEdge(parent, index, "contains");
          walk(item.children, index);
        } else if (parent !== null) addEdge(parent, keys.get(`n:${item.note.id}`)!, "contains");
      }
    };
    walk(tree, null);
  }
  const resolve = makeGraphResolver(notes);
  const filePaths = new Map(files.map((file) => [normalize(file), file]));
  const attachment = (reference: string, source: NoteMeta): string | null => {
    let target = wikiTarget(reference).path;
    try { target = decodeURIComponent(target); } catch { /* literal percent */ }
    for (const path of [boundedVaultPath(target), boundedVaultPath(target, source.folder)]) {
      const found = path ? filePaths.get(normalize(path)) : null;
      if (found) return found;
    }
    if (target.includes("/")) return null;
    const matches = files.filter((file) => normalize(basename(file)) === normalize(target));
    return matches.length === 1 ? matches[0] : null;
  };
  for (const note of notes) {
    const source = keys.get(`n:${note.id}`)!;
    const refs = references?.[note.id] ?? note.links.map((target) => ({ target, embedded: false }));
    for (const ref of refs) {
      if (/^[a-z][a-z\d+.-]*:/i.test(ref.target)) continue;
      const destination = resolve(ref.target, note.id);
      if (destination) {
        addEdge(source, keys.get(`n:${destination.id}`)!, "link");
        continue;
      }
      const target = wikiTarget(ref.target).path;
      if (!target) continue;
      const looksLikeAttachment = /\.[a-z\d]{1,8}$/i.test(target) && !/\.md$/i.test(target);
      if (looksLikeAttachment) {
        if (mode === "obsidian" && options.showAttachments) {
          const path = attachment(target, note);
          if (path) addEdge(source, addNode({ key: `a:${path}`, label: basename(path), kind: "attachment", path, group: "" }), "link");
        }
      } else if (mode === "obsidian" && options.showUnresolved) {
        const path = target.startsWith(".") ? boundedVaultPath(stem(target), note.folder) : boundedVaultPath(stem(target));
        if (path) addEdge(source, addNode({ key: `u:${normalize(path)}`, label: basename(path), kind: "unresolved", path, group: "" }), "link");
      }
    }
    if (mode === "obsidian" && options.showTags) {
      for (const tag of new Set(note.tags)) {
        const clean = tag.replace(/^#/, "");
        addEdge(source, addNode({ key: `t:${normalize(clean)}`, label: `#${clean}`, kind: "tag", path: clean, group: "" }), "link");
      }
    }
  }
  if (mode === "obsidian" && !options.showOrphans) {
    const remap = new Map<number, number>();
    const kept = nodes.filter((node, index) => {
      if (node.degree === 0) return false;
      remap.set(index, remap.size);
      return true;
    });
    const keptEdges = edges.filter((edge) => remap.has(edge.a) && remap.has(edge.b))
      .map((edge) => ({ ...edge, a: remap.get(edge.a)!, b: remap.get(edge.b)! }));
    return withAdjacency(kept, keptEdges);
  }
  return withAdjacency(nodes, edges);
}

function withAdjacency(nodes: GraphNode[], edges: GraphData["edges"]): GraphData {
  const adjacency = nodes.map(() => [] as number[]);
  for (const edge of edges) { adjacency[edge.a].push(edge.b); adjacency[edge.b].push(edge.a); }
  return { nodes, edges, adjacency };
}
