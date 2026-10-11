import type { NoteMeta } from "./storage";
export type LibrarySort = "updated" | "created" | "title";
export type LibraryGrouping = "section" | "folder" | "none";
export type LibraryFilters = {
    query: string;
    folder: string;
    favorite: boolean;
    tag: string;
    sort: LibrarySort;
};
type Entry = {
    note: NoteMeta;
    search: string;
    tags: Set<string>;
};
export type LibraryIndex = {
    entries: Entry[];
    sorted: Map<LibrarySort, Entry[]>;
    byId: Map<string, NoteMeta>;
    folders: Array<{
        path: string;
        count: number;
    }>;
    roots: Array<{
        path: string;
        count: number;
    }>;
    tags: string[];
    favoriteCount: number;
};
export type LibraryRow = {
    kind: "heading";
    label: string;
    path: string;
    count: number;
    top: number;
    height: number;
} | {
    kind: "cards";
    notes: NoteMeta[];
    top: number;
    height: number;
};
export type LibraryLayout = {
    rows: LibraryRow[];
    height: number;
};
export function libraryColumns(width: number, compact = false): number {
    return Math.max(1, Math.min(compact ? 4 : 3, Math.floor((width + 16) / (compact ? 248 : 298))));
}
const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
export const normalizeLibraryText = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
export const normalizeLibraryTag = (value: string) => normalizeLibraryText(value.replace(/^#+/, "").trim());
/** Clean display-only excerpts; original Markdown and cached note metadata stay intact. */
export function libraryExcerpt(note: Pick<NoteMeta, "title" | "preview">): string {
    let text = note.preview.replace(/^(?:#[\p{L}\p{N}_/\-]+\s+)+/u, "").replace(/\[![\w-]+\]/g, "").trim();
    const titles = [note.title, note.title.replace(/^\d+(?:\.\d+)*[.)]?\s+/, "")];
    for (const title of titles)
        if (title && normalizeLibraryText(text).startsWith(normalizeLibraryText(title))) {
            text = text.slice(title.length).replace(/^[\s:—–-]+/, "");
            break;
        }
    return text.replace(/\[\[([^\]]+)\]\]/g, (_match, value: string) => value.includes("|") ? value.slice(value.lastIndexOf("|") + 1) : value.replace(/#.*$/, ""))
        .replace(/\[\[[^\]]*$/, "").replace(/\s+/g, " ").trim();
}
/** One metadata pass; browsing does not read Markdown bodies or attachment files. */
export function buildLibraryIndex(notes: readonly NoteMeta[]): LibraryIndex {
    const byId = new Map<string, NoteMeta>(), folders = new Map<string, number>(), tags = new Set<string>();
    const entries: Entry[] = [];
    let favoriteCount = 0;
    for (const note of notes) {
        if (byId.has(note.id))
            continue;
        byId.set(note.id, note);
        favoriteCount += Number(note.favorite);
        const canonicalTags = new Set(note.tags.map(normalizeLibraryTag).filter(Boolean));
        for (const tag of canonicalTags)
            tags.add(tag);
        const parts = note.folder.split("/").filter(Boolean);
        for (let depth = 1; depth <= parts.length; depth++) {
            const path = parts.slice(0, depth).join("/");
            folders.set(path, (folders.get(path) ?? 0) + 1);
        }
        entries.push({ note, tags: canonicalTags, search: normalizeLibraryText([note.title, note.folder, note.preview, ...canonicalTags, ...(note.aliases ?? [])].join(" ")) });
    }
    const orderedFolders = [...folders].map(([path, count]) => ({ path, count })).sort((a, b) => collator.compare(a.path, b.path));
    return { entries, sorted: new Map(), byId, folders: orderedFolders, roots: orderedFolders.filter(folder => !folder.path.includes("/")), tags: [...tags].sort(collator.compare), favoriteCount };
}
export function queryLibrary(index: LibraryIndex, filter: LibraryFilters): NoteMeta[] {
    const tokens = normalizeLibraryText(filter.query.trim()).split(/\s+/).filter(Boolean);
    const tag = normalizeLibraryTag(filter.tag), prefix = `${filter.folder}/`;
    let sorted = index.sorted.get(filter.sort);
    if (!sorted) {
        const timestamp = (note: NoteMeta) => filter.sort === "created" ? note.createdAt : note.updatedAt;
        sorted = [...index.entries].sort(({ note: a }, { note: b }) => (filter.sort === "title" ? collator.compare(a.title, b.title) : timestamp(b) - timestamp(a)) || collator.compare(a.title, b.title) || collator.compare(a.id, b.id));
        index.sorted.set(filter.sort, sorted);
    }
    const result: NoteMeta[] = [];
    for (const entry of sorted) {
        const { note } = entry;
        if (filter.folder && note.folder !== filter.folder && !note.folder.startsWith(prefix))
            continue;
        if (filter.favorite && !note.favorite)
            continue;
        if (tag && !entry.tags.has(tag))
            continue;
        if (!tokens.every(token => token.startsWith("#") ? !normalizeLibraryTag(token) || entry.tags.has(normalizeLibraryTag(token)) : entry.search.includes(token)))
            continue;
        result.push(note);
    }
    return result;
}
/** Headings and fixed-height card rows share one scroll window, including tiny groups. */
export function layoutLibrary(notes: readonly NoteMeta[], columns: number, cardHeight: number, grouping: LibraryGrouping, scope = ""): LibraryLayout {
    columns = Math.max(1, Math.floor(columns));
    const groups = new Map<string, NoteMeta[]>();
    const depth = scope ? scope.split("/").length + 1 : 1;
    for (const note of notes) {
        const path = grouping === "none" ? "" : grouping === "folder" ? note.folder : note.folder.split("/").slice(0, depth).join("/");
        const group = groups.get(path) ?? [];
        group.push(note);
        groups.set(path, group);
    }
    const rows: LibraryRow[] = [];
    let top = 0;
    for (const [path, group] of groups) {
        if (grouping !== "none") {
            const parts = path.split("/");
            rows.push({ kind: "heading", path, label: parts[parts.length - 1] || "", count: group.length, top, height: 56 });
            top += 56;
        }
        for (let i = 0; i < group.length; i += columns) {
            rows.push({ kind: "cards", notes: group.slice(i, i + columns), top, height: cardHeight + 16 });
            top += cardHeight + 16;
        }
        if (grouping !== "none")
            top += 12;
    }
    return { rows, height: Math.max(0, top - 16) };
}
/** Binary searches avoid a complete row scan on every scroll frame. */
export function libraryWindow(layout: LibraryLayout, top: number, height: number, overscan = 320) {
    const startY = Math.max(0, top - overscan), endY = top + height + overscan;
    let low = 0, high = layout.rows.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        const row = layout.rows[middle];
        if (row.top + row.height <= startY)
            low = middle + 1;
        else
            high = middle;
    }
    const start = low;
    high = layout.rows.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (layout.rows[middle].top < endY)
            low = middle + 1;
        else
            high = middle;
    }
    return { start, end: low, rows: layout.rows.slice(start, low) };
}
