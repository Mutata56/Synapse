import type { NoteMeta } from "./storage";
import type { GraphDocument, GraphReference, GraphReferenceMap } from "./graphTypes";

type Entry = { revision: number; body: string; references: GraphReference[] };
const equal = (a: readonly GraphReference[], b: readonly GraphReference[]) => a.length === b.length && a.every((value, i) => value.target === b[i].target && value.embedded === b[i].embedded);

/** Cache survives graph navigation; only changed bodies are sent to the parser. */
export class GraphReferenceIndex {
  private entries = new Map<string, Entry>();
  private pending: Promise<unknown> = Promise.resolve();
  references: GraphReferenceMap = Object.create(null);
  get hasSnapshot() { return this.entries.size > 0; }

  update(
    notes: readonly NoteMeta[],
    read: () => Promise<readonly GraphDocument[]>,
    parse: (documents: GraphDocument[]) => Promise<GraphReferenceMap>,
    supplied?: readonly GraphDocument[],
  ): Promise<GraphReferenceMap> {
    const task = this.pending.then(() => this.updateEntries(notes, read, parse, supplied));
    this.pending = task.catch(() => undefined);
    return task;
  }
  private async updateEntries(notes: readonly NoteMeta[], read: () => Promise<readonly GraphDocument[]>, parse: (documents: GraphDocument[]) => Promise<GraphReferenceMap>, supplied?: readonly GraphDocument[]) {
    const bodies = supplied ? new Map(supplied.map((document) => [document.id, document.body])) : null;
    const present = new Set(notes.map((note) => note.id));
    const missing = notes.filter((note) => {
      const old = this.entries.get(note.id);
      return !old || (bodies ? old.body !== bodies.get(note.id) : old.revision !== note.updatedAt);
    });
    const loaded = missing.length ? supplied ?? await read() : [];
    const loadedBodies = new Map(loaded.map((document) => [document.id, document.body]));
    const changed = missing.filter((note) => this.entries.get(note.id)?.body !== (loadedBodies.get(note.id) ?? ""))
      .map((note) => ({ id: note.id, body: loadedBodies.get(note.id) ?? "" }));
    const parsed = changed.length ? await parse(changed) : Object.create(null) as GraphReferenceMap;
    let next = this.references;
    const copy = () => { if (next === this.references) next = Object.assign(Object.create(null), next); };
    for (const note of missing) {
      const old = this.entries.get(note.id), body = loadedBodies.get(note.id) ?? "";
      const references = parsed[note.id] ?? old?.references ?? [];
      if (!old || !equal(old.references, references)) { copy(); next[note.id] = references; }
      this.entries.set(note.id, { revision: note.updatedAt, body, references });
    }
    for (const id of this.entries.keys()) if (!present.has(id)) { this.entries.delete(id); copy(); delete next[id]; }
    this.references = next;
    return next;
  }
}
