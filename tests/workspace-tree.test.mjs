import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const built = await build({ entryPoints: ["src/lib/workspaceTree.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { sortWorkspaceTree, visibleWorkspaceTree, workspaceTreeWindow } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const note = (id, updatedAt = 1) => ({ kind: "note", note: { id, title: id, updatedAt, createdAt: updatedAt } });
const nested = [{ kind: "folder", name: "Folder", path: "Folder", children: [{ kind: "folder", name: "Sub", path: "Folder/Sub", children: [note("deep")] }, note("child")] }, note("root")];

test("visible rows keep ancestors, order and inline creators without mounting collapsed children", () => {
  assert.equal(visibleWorkspaceTree(nested, new Set()).length, 2);
  const rows = visibleWorkspaceTree(nested, new Set(["Folder"]), "Folder");
  assert.deepEqual(rows.map(row => row.kind === "creator" ? "create" : row.node.kind === "folder" ? row.node.path : row.node.note.id), ["Folder", "create", "Folder/Sub", "child", "root"]);
  assert.deepEqual(rows.map(row => row.depth), [0, 1, 1, 1, 0]);
  assert.equal(visibleWorkspaceTree(nested, new Set(["Folder", "Folder/Sub"])).length, 5);
});
test("window remains bounded for ten thousand rows, including resize and collapse after a deep scroll", () => {
  for (const top of [0, 38 * 4000, 38 * 9999]) {
    const range = workspaceTreeWindow(10000, top, 600);
    assert(range.end - range.start <= 28);
    assert(range.start >= 0 && range.end <= 10000);
  }
  assert.deepEqual(workspaceTreeWindow(0, 100000, 600), { start: 0, end: 0 });
  assert.deepEqual(workspaceTreeWindow(3, 100000, 600), { start: 0, end: 3 });
});
test("sorting preserves source nodes, folder-first grouping, numeric names and requested date order", () => {
  const nodes = [note("10", 2), note("2", 3), ...nested];
  const original = JSON.stringify(nodes);
  const sorted = sortWorkspaceTree(nodes, "name");
  assert.equal(sorted[0].kind, "folder");
  assert.deepEqual(sorted.slice(1, 3).map(row => row.note.id), ["2", "10"]);
  assert.equal(sortWorkspaceTree(nodes, "modified")[1].note.id, "2");
  assert.equal(JSON.stringify(nodes), original);
});
