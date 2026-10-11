import type { NoteMeta, TreeNode } from "./storage";

export type FileTarget = { kind: "note"; id: string } | { kind: "folder"; path: string };
export type FileEntry = {
  key: string; path: string; parent: string; name: string; kind: "note" | "folder";
  note?: NoteMeta; notes: number; folders: number; modified: number; search: string;
};
export type FileIndex = {
  entries: FileEntry[]; byKey: Map<string, FileEntry>; children: Map<string, FileEntry[]>;
  folders: Map<string, FileEntry>; notes: number; folderCount: number;
};
export type FileSort = "name" | "modified" | "kind";
const indexes = new WeakMap<TreeNode[], FileIndex>();
const collators = new Map<string, Intl.Collator>();
export const fileParent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
export const targetPath = (target: FileTarget) => target.kind === "note" ? target.id : target.path;
export const targetKey = (target: FileTarget) => `${target.kind}:${targetPath(target)}`;
export const entryTarget = (entry: FileEntry): FileTarget => entry.kind === "note" ? { kind: "note", id: entry.path } : { kind: "folder", path: entry.path };
const normalize = (value: string) => value.normalize("NFC").toLocaleLowerCase();

/** One iterative traversal per immutable tree revision, shared by Files/Trash. */
export function getFileIndex(tree: TreeNode[]): FileIndex {
  const cached = indexes.get(tree); if (cached) return cached;
  const index: FileIndex = { entries: [], byKey: new Map(), children: new Map([["", []]]), folders: new Map(), notes: 0, folderCount: 0 };
  const stack = [{ nodes: tree, parent: "" }];
  const folderOrder: FileEntry[] = [];
  while (stack.length) {
    const { nodes, parent } = stack.pop()!;
    const children = index.children.get(parent)!;
    for (const node of nodes) {
      const folder = node.kind === "folder";
      const path = folder ? node.path : node.note.id;
      const name = folder ? node.name : node.note.title;
      const entry: FileEntry = { key: `${node.kind}:${path}`, path, parent, name, kind: node.kind,
        note: folder ? undefined : node.note, notes: folder ? 0 : 1, folders: 0,
        modified: folder ? 0 : node.note.updatedAt,
        search: normalize(`${name}\n${path}\n${folder ? "" : node.note.tags.join(" ")}`) };
      children.push(entry); index.entries.push(entry); index.byKey.set(entry.key, entry);
      if (folder) {
        index.folderCount++; index.folders.set(path, entry); folderOrder.push(entry);
        index.children.set(path, []); stack.push({ nodes: node.children, parent: path });
      } else index.notes++;
    }
  }
  for (let i = folderOrder.length - 1; i >= 0; i--) {
    const folder = folderOrder[i];
    for (const child of index.children.get(folder.path)!) {
      folder.notes += child.notes; folder.folders += child.folders + Number(child.kind === "folder");
      folder.modified = Math.max(folder.modified, child.modified);
    }
  }
  indexes.set(tree, index); return index;
}

export function fileRows(index: FileIndex, folder: string, query: string, descendants: boolean,
  kind: "all" | "note" | "folder", sort: FileSort, descending: boolean, locale = "ru") {
  let collator = collators.get(locale);
  if (!collator) { collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" }); collators.set(locale, collator); }
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const source = descendants ? index.entries : index.children.get(folder) ?? [];
  return source.filter(entry => (!folder || !descendants || entry.parent === folder || entry.parent.startsWith(`${folder}/`))
    && (kind === "all" || entry.kind === kind) && words.every(word => entry.search.includes(word)))
    .sort((a, b) => {
      // Stable folder grouping remains independent of sort direction.
      const group = Number(a.kind === "note") - Number(b.kind === "note");
      if (group) return group;
      const difference = sort === "modified" ? a.modified - b.modified : sort === "kind" ? a.kind.localeCompare(b.kind) : collator!.compare(a.name, b.name);
      return (descending ? -difference : difference) || collator!.compare(a.name, b.name) || a.key.localeCompare(b.key);
    });
}

export function closestFileFolder(index: FileIndex, folder: string): string {
  while (folder && !index.folders.has(folder)) folder = fileParent(folder);
  return folder;
}

/** A selected ancestor already carries its children. O(items × path depth). */
export function normalizeFileTargets(source: readonly FileTarget[]): FileTarget[] {
  const unique = new Map<string, FileTarget>();
  for (const item of source) if (targetPath(item)) unique.set(targetKey(item), item);
  const folders = new Set([...unique.values()].filter(item => item.kind === "folder").map(targetPath));
  return [...unique.values()].filter(item => {
    let parent = fileParent(targetPath(item));
    while (parent) { if (folders.has(parent)) return false; parent = fileParent(parent); }
    return true;
  });
}

export function movableFileTargets(source: readonly FileTarget[], destination: string): FileTarget[] {
  return normalizeFileTargets(source).filter(item => {
    const path = targetPath(item);
    return fileParent(path) !== destination && (item.kind !== "folder" || (destination !== path && !destination.startsWith(`${path}/`)));
  });
}

/** Prune a batch once, retaining untouched subtrees and typed captured nodes. */
export function extractFileTargets(tree: TreeNode[], source: readonly FileTarget[]) {
  const targets = new Set(normalizeFileTargets(source).map(targetKey));
  const captured = new Map<string, TreeNode>();
  type Frame = { nodes: TreeNode[]; offset: number; out: TreeNode[]; changed: boolean; folder?: Extract<TreeNode, { kind: "folder" }> };
  const stack: Frame[] = [{ nodes: tree, offset: 0, out: [], changed: false }];
  let result = tree;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.offset === frame.nodes.length) {
      const next = frame.changed ? frame.out : frame.nodes;
      stack.pop();
      if (!stack.length) { result = next; break; }
      const parent = stack[stack.length - 1], folder = frame.folder!;
      parent.out.push(next === folder.children ? folder : { ...folder, children: next });
      parent.changed ||= next !== folder.children;
      continue;
    }
    const node = frame.nodes[frame.offset++];
    const key = `${node.kind}:${node.kind === "folder" ? node.path : node.note.id}`;
    if (targets.has(key)) { captured.set(key, node); frame.changed = true; }
    else if (node.kind === "folder") stack.push({ nodes: node.children, offset: 0, out: [], changed: false, folder: node });
    else frame.out.push(node);
  }
  return { tree: result, captured };
}

export function fileRangeSelection(keys: readonly string[], selected: ReadonlySet<string>, index: number,
  anchor: number, toggle: boolean, range: boolean): Set<string> {
  if (!keys[index]) return new Set(selected);
  if (range) {
    const result = toggle ? new Set(selected) : new Set<string>();
    for (let i = Math.min(Math.max(0, anchor), index); i <= Math.max(Math.max(0, anchor), index) && i < keys.length; i++) result.add(keys[i]);
    return result;
  }
  if (!toggle) return new Set([keys[index]]);
  const result = new Set(selected); if (result.has(keys[index])) result.delete(keys[index]); else result.add(keys[index]); return result;
}
