import type { NoteMeta } from "./storage";
import type { WordEntry } from "./writingStats";

export type OverviewWordLoader = (notes: NoteMeta[]) => Promise<WordEntry[]>;
type Profile = { updatedAt: number; createdAt: number };

/** Exact invalidation and shared requests for optional writing analytics. */
export class OverviewWordResource {
  private profiles = new Map<string, Profile>();
  private revision = 0;
  private loadedRevision = -1;
  private reader: OverviewWordLoader | null = null;
  private pending: Promise<WordEntry[]> | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  version(notes: readonly NoteMeta[]): number {
    const matches = this.profiles.size === notes.length && notes.every(note => {
      const profile = this.profiles.get(note.id);
      return profile?.updatedAt === note.updatedAt && profile.createdAt === note.createdAt;
    });
    if (!matches) {
      this.profiles = new Map(notes.map(note => [note.id, { updatedAt: note.updatedAt, createdAt: note.createdAt }]));
      this.revision++;
    }
    return this.revision;
  }

  load(notes: readonly NoteMeta[], reader: OverviewWordLoader): Promise<WordEntry[]> {
    const revision = this.version(notes);
    if (this.pending && this.loadedRevision === revision && this.reader === reader) return this.pending;
    const snapshot = notes.map(note => ({ ...note }));
    const request = this.tail.catch(() => undefined).then(() => reader(snapshot));
    this.tail = request; this.pending = request; this.loadedRevision = revision; this.reader = reader;
    void request.catch(() => { if (this.pending === request) this.pending = null; });
    return request;
  }
}

export const overviewWordResource = new OverviewWordResource();
export const loadOverviewWords: OverviewWordLoader = async notes => {
  if (!notes.length) return [];
  const { wordCountsFor } = await import("./fullTextSearch");
  return wordCountsFor(notes);
};
