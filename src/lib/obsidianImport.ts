/** Helpers for copied vaults. Preview transformations never become file content. */
export type MarkdownSourceParts = { frontmatter: string; body: string };

export function splitMarkdownSource(source: string): MarkdownSourceParts {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(source);
  if (!opening) return { frontmatter: "", body: source };
  const remainder = source.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(remainder);
  if (!closing) return { frontmatter: "", body: source };
  const end = opening[0].length + closing.index + closing[0].length;
  return { frontmatter: source.slice(0, end), body: source.slice(end) };
}

/** A body edit keeps the entire original YAML, including comments and unknown keys. */
export function markdownSourceToWrite(
  revision: string,
  sourceText: string | undefined,
  body: string,
): string {
  if (sourceText !== undefined && sourceText !== revision) return sourceText;
  const frontmatter = splitMarkdownSource(revision).frontmatter;
  const bom = !frontmatter && revision.startsWith("\uFEFF") && !body.startsWith("\uFEFF") ? "\uFEFF" : "";
  return frontmatter + bom + body;
}

export class MarkdownSourceConflictError extends Error {
  constructor() {
    super("Файл изменён вне Synapse. Правки сохранены в черновике; перечитайте файл перед сохранением.");
    this.name = "MarkdownSourceConflictError";
  }
}

export function assertMarkdownSourceUnchanged(revision: string, disk: string): void {
  if (revision !== disk) throw new MarkdownSourceConflictError();
}

/** Textareas use LF. Preserve the original CRLF convention when the user edits. */
export function normalizeSourceEdit(text: string, revision: string): string {
  const hasCrLf = revision.includes("\r\n");
  const hasBareLf = /(?<!\r)\n/.test(revision);
  return hasCrLf && !hasBareLf ? text.replace(/\r?\n/g, "\r\n") : text;
}

/** Normalize relative paths without allowing a reference to escape the vault. */
export function boundedVaultPath(path: string, base = ""): string | null {
  if (!path || /[\x00-\x1F]/.test(path) || /^[\/\\]/.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  const parts = base ? base.split("/") : [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length ? parts.join("/") : null;
}

export function wikiTarget(value: string): { path: string; heading: string; label: string } {
  const pipe = value.indexOf("|");
  const target = (pipe < 0 ? value : value.slice(0, pipe)).trim();
  const hash = target.indexOf("#");
  return {
    path: hash < 0 ? target : target.slice(0, hash),
    heading: hash < 0 ? "" : target.slice(hash + 1),
    label: pipe < 0 ? target.replace(/\.md(?=#|$)/i, "") : value.slice(pipe + 1).trim(),
  };
}

export type VaultFileIndex = {
  paths: ReadonlyMap<string, string>;
  basenames: ReadonlyMap<string, readonly string[]>;
};

const pathKey = (path: string): string => path.normalize("NFC").toLowerCase();

export function indexVaultFiles(files: readonly string[]): VaultFileIndex {
  const paths = new Map<string, string>();
  const basenames = new Map<string, string[]>();
  for (const file of files) {
    const safe = boundedVaultPath(file);
    if (!safe || safe !== file) continue;
    // Keep ambiguous case-folded paths unresolved rather than choosing one.
    const key = pathKey(file);
    paths.set(key, paths.has(key) ? "" : file);
    const basename = pathKey(file.slice(file.lastIndexOf("/") + 1));
    const matches = basenames.get(basename) ?? [];
    matches.push(file);
    basenames.set(basename, matches);
  }
  return { paths, basenames };
}

/** Root/relative exact match, then unique basename. Every result is an inventory path. */
export function resolveVaultReference(
  reference: string,
  noteId: string,
  files: VaultFileIndex,
  options: { note?: boolean; relativeFirst?: boolean } = {},
): string | null {
  let value = reference.trim().replace(/^<|>$/g, "");
  try { value = decodeURIComponent(value); } catch { /* literal percent in a filename */ }
  if (!value) return options.note ? `${noteId}.md` : null;
  if (/^[\/\\]/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value) || /[\x00-\x1F]/.test(value)) return null;
  const target = options.note && !/\.md$/i.test(value) ? `${value}.md` : value;
  const parent = noteId.includes("/") ? noteId.slice(0, noteId.lastIndexOf("/")) : "";
  const root = boundedVaultPath(target);
  const relative = boundedVaultPath(target, parent);
  // A traversal outside the root is never eligible for basename fallback.
  if (!relative && !root) return null;
  const candidates = options.relativeFirst ? [relative, root] : [root, relative];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const found = files.paths.get(pathKey(candidate));
    if (found) return found;
  }
  // Explicit paths must not silently point at an unrelated file elsewhere.
  if (/[\/\\]/.test(target.replace(/^\.\//, ""))) return null;
  const matches = files.basenames.get(pathKey(target));
  return matches?.length === 1 ? matches[0] : null;
}

/** Run only outside fenced and inline code (including multi-backtick spans). */
export function mapMarkdownText(source: string, map: (text: string) => string): string {
  const lines = source.split(/(?<=\n)/);
  let fence: { marker: string; length: number } | null = null;
  let prose = "";
  let output = "";
  const flush = () => {
    if (!prose) return;
    // A backtick run closes only with a run of the same length.
    let cursor = 0;
    const ticks = /`+/g;
    let match: RegExpExecArray | null;
    while ((match = ticks.exec(prose))) {
      const opening = match.index;
      const size = match[0].length;
      const closeRe = new RegExp(`(?<!\u0060)\u0060{${size}}(?!\u0060)`, "g");
      closeRe.lastIndex = opening + size;
      const closing = closeRe.exec(prose);
      if (!closing) continue;
      output += map(prose.slice(cursor, opening)) + prose.slice(opening, closing.index + size);
      cursor = closing.index + size;
      ticks.lastIndex = cursor;
    }
    output += map(prose.slice(cursor));
    prose = "";
  };
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
    if (fence) {
      output += line;
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    } else if (marker) {
      flush();
      fence = { marker: marker[1][0], length: marker[1].length };
      output += line;
    } else if (/^(?: {4}|\t)/.test(line)) {
      flush();
      output += line;
    } else {
      prose += line;
    }
  }
  flush();
  return output;
}

/** Custom preview URLs are resolved against the copied vault, never written to disk. */
export function obsidianMarkdownPreview(body: string): string {
  return mapMarkdownText(body, (text) => text.replace(/(!?)\[\[([^\]\n]+)\]\]/g, (_all, embed: string, value: string) => {
    const target = wikiTarget(value);
    const label = target.label.replace(/[\[\]\\]/g, "\\$&");
    if (embed) {
      const width = /^\d+(?:x\d+)?$/.test(target.label) ? ` "${target.label}"` : "";
      return `![${label}](synapse-embed:${encodeURIComponent(target.path)}${width})`;
    }
    return `[${label}](synapse-note:${encodeURIComponent(target.path + (target.heading ? `#${target.heading}` : ""))})`;
  }));
}
