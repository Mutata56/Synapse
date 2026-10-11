import type { TreeNode } from "./storage";

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const WORKSPACE_TREE_ROW_HEIGHT = 38;
export function sortWorkspaceTree(tree: TreeNode[], order: "name" | "modified" | "created"): TreeNode[] {
  return tree.map(node => node.kind === "folder" ? { ...node, children: sortWorkspaceTree(node.children, order) } : node).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    if (a.kind === "note" && b.kind === "note" && order !== "name") {
      const delta = order === "modified" ? b.note.updatedAt - a.note.updatedAt : b.note.createdAt - a.note.createdAt;
      if (delta) return delta;
    }
    return names.compare(a.kind === "folder" ? a.name : a.note.title, b.kind === "folder" ? b.name : b.note.title);
  });
}
export type WorkspaceTreeRow = { kind: "node"; node: TreeNode; depth: number } | { kind: "creator"; creator: "note" | "folder"; parent: string; depth: number };
export function visibleWorkspaceTree(tree: TreeNode[], expanded: ReadonlySet<string>, creatingNoteIn: string | null = null, creatingFolderIn: string | null = null): WorkspaceTreeRow[] {
  const rows: WorkspaceTreeRow[] = [];
  function walk(nodes: TreeNode[], parent: string, depth: number) {
    if (creatingFolderIn === parent) rows.push({ kind: "creator", creator: "folder", parent, depth });
    if (creatingNoteIn === parent) rows.push({ kind: "creator", creator: "note", parent, depth });
    for (const node of nodes) {
      rows.push({ kind: "node", node, depth });
      if (node.kind === "folder" && expanded.has(node.path)) walk(node.children, node.path, depth + 1);
    }
  }
  walk(tree, "", 0);
  return rows;
}
export function workspaceTreeWindow(count: number, top: number, height: number) {
  const visible = Math.max(1, Math.ceil(height / WORKSPACE_TREE_ROW_HEIGHT));
  const first = Math.min(Math.max(0, count - visible), Math.max(0, Math.floor(top / WORKSPACE_TREE_ROW_HEIGHT)));
  return { start: Math.max(0, first - 6), end: Math.min(count, first + visible + 6) };
}
