import { dayKey, toISODate } from "./daily";
import { normalizeTag } from "./tagExplorer";
import type { NoteMeta } from "./storage";

export type OverviewFilter = "recent" | "favorites" | "untagged";
export type OverviewCollection = { path: string; count: number; updatedAt: number };
export type OverviewTopic = { tag: string; count: number };
export type OverviewDay = { key: string; count: number };
export type OverviewModel = {
  notes: readonly NoteMeta[];
  byId: ReadonlyMap<string, NoteMeta>;
  recent: readonly NoteMeta[];
  favorites: readonly NoteMeta[];
  favoriteCount: number;
  untaggedCount: number;
  tagCount: number;
  collections: readonly OverviewCollection[];
  collectionCount: number;
  topics: readonly OverviewTopic[];
  days: ReadonlyMap<string, number>;
};

const RECENT_LIMIT = 12;
const FAVORITE_LIMIT = 5;
const timestamp = (note: NoteMeta) => Number.isFinite(note.updatedAt) ? note.updatedAt : 0;
const compare = (a: NoteMeta, b: NoteMeta) => timestamp(b) - timestamp(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
type DerivedMeta = { folder: string; updatedAt: number; rawTags: string[]; tags: ReadonlySet<string>; path: string; day: string | null };
const derivedMetadata = new WeakMap<NoteMeta, DerivedMeta>();

/** Reuse normalization for unchanged notes; no retained Markdown or permanent id cache. */
function derivedMeta(note: NoteMeta): DerivedMeta {
  const cached = derivedMetadata.get(note);
  if (cached && cached.folder === note.folder && cached.updatedAt === note.updatedAt && cached.rawTags.length === note.tags.length && note.tags.every((tag, index) => tag === cached.rawTags[index])) return cached;
  const value = { folder: note.folder, updatedAt: note.updatedAt, rawTags: [...note.tags], tags: new Set(note.tags.map(normalizeTag).filter(Boolean)), path: note.folder.split("/")[0], day: timestamp(note) > 0 ? dayKey(timestamp(note)) : null };
  derivedMetadata.set(note, value);
  return value;
}

/** Bounded selection instead of sorting the vault for each small widget. */
function insertRecent(result: NoteMeta[], note: NoteMeta, limit: number) {
  if (result.length === limit && compare(note, result[result.length - 1]) >= 0) return;
  let index = result.length;
  while (index > 0 && compare(note, result[index - 1]) < 0) index--;
  result.splice(index, 0, note);
  if (result.length > limit) result.pop();
}

export function recentOverviewNotes(source: readonly NoteMeta[], limit: number, predicate: (note: NoteMeta) => boolean) {
  const result: NoteMeta[] = [];
  for (const note of source) if (predicate(note)) insertRecent(result, note, limit);
  return result;
}

/** Metadata only: this model cannot read or rewrite Markdown bodies. */
export function buildOverviewModel(source: readonly NoteMeta[]): OverviewModel {
  const notes: NoteMeta[] = [], recent: NoteMeta[] = [], favorites: NoteMeta[] = [];
  const byId = new Map<string, NoteMeta>(), collections = new Map<string, OverviewCollection>();
  const tags = new Map<string, number>(), days = new Map<string, number>();
  let favoriteCount = 0, untaggedCount = 0;
  for (const note of source) {
    if (byId.has(note.id)) continue;
    byId.set(note.id, note); notes.push(note);
    insertRecent(recent, note, RECENT_LIMIT);
    if (note.favorite) { favoriteCount++; insertRecent(favorites, note, FAVORITE_LIMIT); }
    const derived = derivedMeta(note);
    const path = derived.path;
    const collection = collections.get(path);
    if (collection) { collection.count++; collection.updatedAt = Math.max(collection.updatedAt, timestamp(note)); }
    else collections.set(path, { path, count: 1, updatedAt: timestamp(note) });
    const uniqueTags = derived.tags;
    if (!uniqueTags.size) untaggedCount++;
    for (const tag of uniqueTags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    if (derived.day) {
      const key = derived.day;
      days.set(key, (days.get(key) ?? 0) + 1);
    }
  }
  return {
    notes, byId, recent, favorites, favoriteCount, untaggedCount, tagCount: tags.size,
    collections: [...collections.values()].sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)).slice(0, 6),
    collectionCount: collections.size,
    topics: [...tags].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 7),
    days,
  };
}

export function overviewActivity(model: OverviewModel, today: string, length = 30): OverviewDay[] {
  const [year, month, day] = today.split("-").map(Number);
  return Array.from({ length }, (_, index) => {
    const date = new Date(year, month - 1, day - length + 1 + index, 12);
    const key = toISODate(date);
    return { key, count: model.days.get(key) ?? 0 };
  });
}

export function overviewSelection(model: OverviewModel, filter: OverviewFilter, day: string | null, excludeId: string | null = null) {
  if (filter === "recent" && !day) return { notes: model.recent.filter(note => note.id !== excludeId).slice(0, 8), count: model.notes.length };
  const result: NoteMeta[] = [];
  let count = 0;
  for (const note of model.notes) {
    if (filter === "favorites" && !note.favorite) continue;
    if (filter === "untagged" && note.tags.some(tag => normalizeTag(tag))) continue;
    if (day && (!(timestamp(note) > 0) || dayKey(timestamp(note)) !== day)) continue;
    count++;
    if (note.id !== excludeId) insertRecent(result, note, 8);
  }
  return { notes: result, count };
}
