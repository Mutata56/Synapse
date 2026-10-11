import type { NoteMeta } from "./storage";

export type TagMatch = "all" | "any";
export type NoteSort = "updated" | "created" | "title";
export type TagSort = "count" | "name";
export type TagNode = {
  path: string;
  label: string;
  parent: string | null;
  children: string[];
  count: number;
  explicit: boolean;
};
export type TagRow = TagNode & { depth: number; expanded: boolean };
export type TagIndex = {
  notes: NoteMeta[];
  tags: Map<string, TagNode>;
  postings: Map<string, number[]>;
  roots: string[];
  untagged: number[];
  search: string[];
  explicitCount: number;
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export function normalizeTag(tag: unknown): string {
  if (typeof tag !== "string") return "";
  return tag.normalize("NFC").trim().replace(/^#+/, "").split("/")
    .map((part) => part.trim().toLocaleLowerCase()).filter(Boolean).join("/");
}

/** One metadata-only index per tree revision. Ancestors count unique notes,
 * including descendants; nothing reads or rewrites Markdown files. */
export function buildTagIndex(source: readonly NoteMeta[]): TagIndex {
  const notes = [...new Map(source.map((note) => [note.id, note])).values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || collator.compare(a.title, b.title) || collator.compare(a.id, b.id));
  const tags = new Map<string, TagNode>();
  const postings = new Map<string, number[]>();
  const roots: string[] = [];
  const untagged: number[] = [];
  const search: string[] = [];
  let explicitCount = 0;
  notes.forEach((note, noteIndex) => {
    const ownTags = new Set(note.tags.map(normalizeTag).filter(Boolean));
    if (!ownTags.size) untagged.push(noteIndex);
    const memberships = new Set<string>();
    for (const tag of ownTags) {
      const parts = tag.split("/");
      let parent: string | null = null;
      parts.forEach((label, depth) => {
        const path = parts.slice(0, depth + 1).join("/");
        let node = tags.get(path);
        if (!node) {
          node = { path, label, parent, children: [], count: 0, explicit: false };
          tags.set(path, node);
          postings.set(path, []);
          if (parent) tags.get(parent)!.children.push(path);
          else roots.push(path);
        }
        if (path === tag && !node.explicit) { node.explicit = true; explicitCount++; }
        memberships.add(path);
        parent = path;
      });
    }
    for (const path of memberships) {
      postings.get(path)!.push(noteIndex);
      tags.get(path)!.count++;
    }
    search.push([note.title, ...(note.aliases ?? []), note.folder, note.preview, ...ownTags].join("\n").normalize("NFC").toLocaleLowerCase());
  });
  return { notes, tags, postings, roots, untagged, search, explicitCount };
}

export function queryTagIndex(index: TagIndex, options: {
  tags?: readonly string[];
  match?: TagMatch;
  untagged?: boolean;
  search?: string;
  sort?: NoteSort;
} = {}): NoteMeta[] {
  const selected = [...new Set((options.tags ?? []).map(normalizeTag).filter(Boolean))];
  let ids: number[];
  if (options.untagged) ids = index.untagged;
  else if (!selected.length) ids = index.notes.map((_, i) => i);
  else {
    const lists = selected.map((tag) => index.postings.get(tag) ?? []);
    if (options.match === "any") ids = [...new Set(lists.flat())].sort((a, b) => a - b);
    else {
      lists.sort((a, b) => a.length - b.length);
      const rest = lists.slice(1).map((list) => new Set(list));
      ids = lists[0].filter((id) => rest.every((set) => set.has(id)));
    }
  }
  const terms = (options.search ?? "").normalize("NFC").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length ? ids.filter((id) => terms.every((term) => index.search[id].includes(term.replace(/^#/, "")))) : ids;
  const notes = matches.map((id) => index.notes[id]);
  if (options.sort === "title") notes.sort((a, b) => collator.compare(a.title, b.title) || b.updatedAt - a.updatedAt);
  else if (options.sort === "created") notes.sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt);
  return notes;
}

/** Searching reveals matching descendants and their actual ancestors.
 * Without a search, branches stay collapsed until explicitly opened. */
export function getTagRows(index: TagIndex, expanded: ReadonlySet<string>, query = "", sort: TagSort = "count"): TagRow[] {
  const needle = normalizeTag(query);
  const included = new Set<string>();
  const autoExpanded = new Set<string>();
  if (needle) for (const node of index.tags.values()) {
    if (!node.path.includes(needle)) continue;
    included.add(node.path);
    let parent = node.parent;
    while (parent) {
      included.add(parent);
      autoExpanded.add(parent);
      parent = index.tags.get(parent)!.parent;
    }
  }
  const compare = (a: string, b: string) => {
    const first = index.tags.get(a)!; const second = index.tags.get(b)!;
    return (sort === "count" ? second.count - first.count : 0) || collator.compare(first.label, second.label);
  };
  const rows: TagRow[] = [];
  const visit = (paths: string[], depth: number) => {
    for (const path of [...paths].sort(compare)) {
      if (needle && !included.has(path)) continue;
      const node = index.tags.get(path)!;
      const isExpanded = autoExpanded.has(path) || expanded.has(path);
      rows.push({ ...node, depth, expanded: isExpanded });
      if (isExpanded) visit(node.children, depth + 1);
    }
  };
  visit(index.roots, 0);
  return rows;
}

/** Fixed rows keep both lists bounded, even with tens of thousands of items. */
export function windowRange(count: number, scrollTop: number, height: number, rowHeight: number, overscan = 4) {
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, count * rowHeight - height));
  const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((top + height) / rowHeight) + overscan);
  return { start, end, offset: start * rowHeight, total: count * rowHeight };
}
