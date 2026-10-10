import { buildGraphData } from "./graphData";
import { flattenNotes } from "./treeUtils";
import { recordGraphDiagnostic } from "./graphDiagnostics";
import type { NoteMeta, TreeNode } from "./storage";
import type { GraphData, GraphMode, GraphOptions, GraphReferenceMap } from "./graphTypes";
type Cached = { notes: NoteMeta[]; folders: string; references: GraphReferenceMap | null; options: string; files: string; data: GraphData };
const same = (a: readonly string[], b: readonly string[]) => a === b || a.length === b.length && a.every((value, i) => value === b[i]);

export class GraphModelCache {
  private modes = new Map<GraphMode, Cached>();
  update(tree: TreeNode[], mode: GraphMode, references: GraphReferenceMap | null, options: GraphOptions, files: readonly string[]): GraphData {
    const notes = flattenNotes(tree), old = this.modes.get(mode);
    const folders: string[] = [];
    if (mode === "volume") {
      const walk = (items: TreeNode[]) => { for (const item of items) if (item.kind === "folder") { folders.push(`${item.path}\0${item.name}`); walk(item.children); } };
      walk(tree);
    }
    const folderKey = JSON.stringify(folders), optionKey = JSON.stringify(options), fileKey = JSON.stringify(files);
    const identical = old && old.folders === folderKey && old.options === optionKey && old.files === fileKey && old.references === references && old.notes.length === notes.length
      && notes.every((note, i) => { const before = old.notes[i]; return note.id === before.id && note.title === before.title && note.folder === before.folder && (!options.showTags || same(note.tags, before.tags)) && (references || same(note.links, before.links)); });
    let data: GraphData;
    if (identical) {
      const byId = new Map(notes.map((note) => [note.id, note]));
      data = { ...old.data, nodes: old.data.nodes.map((node) => node.note ? { ...node, note: byId.get(node.path)! } : node) };
      recordGraphDiagnostic("modelCacheHits");
    } else {
      const started = performance.now(); data = buildGraphData(tree, mode, references, options, files);
      recordGraphDiagnostic("graphBuilds"); recordGraphDiagnostic("graphBuildMs", performance.now() - started);
    }
    this.modes.set(mode, { notes, folders: folderKey, references, options: optionKey, files: fileKey, data }); return data;
  }
}
