import { indexVaultFiles, mapMarkdownText, resolveVaultReference, wikiTarget, type VaultFileIndex } from "./obsidianImport";

export type ImageUsage = { id: string; title: string; folder: string };
export const isImageNote = (usage: ImageUsage) => usage.id !== "__trash__" && usage.id !== "__versions__" && !usage.id.startsWith("__unindexed__:");
export type LibraryImage = {
  id: string;
  name: string;
  folder: string;
  url: string;
  sizeBytes: number;
  modifiedAt: number;
  managed: boolean;
  usedBy: ImageUsage[];
};
export type ImageLibrary = { images: LibraryImage[]; complete: boolean };
export type ImageReferences = { links: { value: string; relative: boolean }[]; managed: string[] };
export type ImageScope = "all" | "used" | "unused";
export type ImageSort = "modified" | "name" | "size";
export type ImageFilter = { query: string; scope: ImageScope; folder: string | null; format: string; sort: ImageSort };

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "tif", "tiff", "ico", "heic", "heif"]);
const SHA_IMAGE = /[0-9a-f]{64}\.[a-z0-9]+/gi;
const normalize = (value: string) => value.normalize("NFC").toLowerCase();
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function imageFormat(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) return "";
  return extension === "jpeg" ? "jpg" : extension === "tif" ? "tiff" : extension;
}

/** Cache syntax, rather than resolved targets: adding a file updates associations
 * without re-reading unchanged notes. Source text is never rewritten. */
export function extractImageReferences(source: string): ImageReferences {
  const links: ImageReferences["links"] = [];
  const seen = new Set<string>();
  const add = (value: string, relative: boolean) => {
    const cleaned = value.replace(/\\([()\[\] ])/g, "$1").trim();
    const key = `${relative}:${cleaned}`;
    if (cleaned && !seen.has(key)) { seen.add(key); links.push({ value: cleaned, relative }); }
  };
  mapMarkdownText(source, (text) => {
    for (const match of text.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) add(wikiTarget(match[1]).path, false);
    for (const match of text.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|(?:\\.|[^\s()])+)(?:\s+["'][^\n]*?["'])?\s*\)/g)) add(match[1].replace(/^<|>$/g, ""), true);
    for (const match of text.matchAll(/<(?:img|a)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) add(match[1].replace(/&amp;/g, "&"), true);
    for (const match of text.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|[^\s]+)(?:\s+["'][^\n]*?["'])?\s*$/gm)) add(match[1].replace(/^<|>$/g, ""), true);
    for (const match of text.matchAll(/^cover:\s*["']?([^\r\n"']+)["']?\s*$/gm)) add(match[1], false);
    return text;
  });
  // BlockNote persists URLs in JSON/code sections. SHA names are conservative
  // protection for these and for asset:// URLs, as in the existing asset scanner.
  const managed = [...new Set((source.match(SHA_IMAGE) ?? []).map((value) => value.toLowerCase()))];
  return { links, managed };
}

export function resolveImageReferences(refs: ImageReferences, noteId: string, files: VaultFileIndex): Set<string> {
  const result = new Set<string>();
  for (const name of refs.managed) {
    const path = files.paths.get(normalize(`.assets/${name}`));
    if (path) result.add(path);
  }
  for (const { value, relative } of refs.links) {
    const target = value.split(/[?#]/, 1)[0];
    const found = resolveVaultReference(target, noteId, files, { relativeFirst: relative });
    if (found && imageFormat(found)) result.add(found);
  }
  return result;
}

export function createImageFilesIndex(paths: readonly string[]): VaultFileIndex { return indexVaultFiles(paths); }

export function buildImageIndex(input: readonly LibraryImage[]) {
  const byId = new Map<string, LibraryImage>();
  const search = new Map<string, string>();
  const folders = new Map<string, number>();
  const formats = new Map<string, number>();
  let totalBytes = 0; let used = 0;
  for (const item of input) {
    const format = imageFormat(item.name);
    if (!format || byId.has(item.id)) continue;
    byId.set(item.id, item);
    search.set(item.id, normalize([item.name, item.folder, ...item.usedBy.flatMap((usage) => [usage.title, usage.folder])].join(" ")));
    totalBytes += item.sizeBytes;
    if (item.usedBy.length) used++;
    for (const folder of new Set([item.folder, ...item.usedBy.filter(isImageNote).map((usage) => usage.folder)])) folders.set(folder, (folders.get(folder) ?? 0) + 1);
    formats.set(format, (formats.get(format) ?? 0) + 1);
  }
  const images = [...byId.values()];
  const byName = (a: LibraryImage, b: LibraryImage) => nameCollator.compare(a.name, b.name) || a.id.localeCompare(b.id);
  const sorted = {
    modified: [...images].sort((a, b) => b.modifiedAt - a.modifiedAt || byName(a, b)),
    name: [...images].sort(byName),
    size: [...images].sort((a, b) => b.sizeBytes - a.sizeBytes || byName(a, b)),
  };
  return { images, byId, search, folders: [...folders].sort(([a], [b]) => a.localeCompare(b)), formats: [...formats].sort(([a], [b]) => a.localeCompare(b)), totalBytes, used, unused: images.length - used, sorted };
}

export function queryImageIndex(index: ReturnType<typeof buildImageIndex>, filter: ImageFilter): LibraryImage[] {
  const terms = normalize(filter.query.trim()).split(/\s+/).filter(Boolean);
  return index.sorted[filter.sort].filter((image) =>
    (filter.scope === "all" || (filter.scope === "used" ? image.usedBy.length > 0 : image.usedBy.length === 0)) &&
    (filter.folder === null || image.folder === filter.folder || image.usedBy.some((usage) => isImageNote(usage) && usage.folder === filter.folder)) &&
    (!filter.format || imageFormat(image.name) === filter.format) &&
    terms.every((term) => index.search.get(image.id)!.includes(term)),
  );
}
