import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { mapMarkdownText, normalizeSourceEdit, splitMarkdownSource } from "../lib/obsidianImport";

export type ImportedBlock = { id: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: ImportedBlock[] };
type Chunk = { ids: string[]; fingerprints: string[]; text: string; gap: string };
export type ImportedSourceMap = { version: 1; source: string; prefix: string; suffix: string; chunks: Chunk[] };
type MarkdownEditor = {
  tryParseMarkdownToBlocks: (text: string) => Promise<unknown[]> | unknown[];
  blocksToMarkdownLossy: (blocks: any) => Promise<string> | string;
};
type AstNode = { type: string; lang?: string; children?: AstNode[]; position?: { start: { offset?: number }; end: { offset?: number } } };
const parser = unified().use(remarkParse).use(remarkGfm);
const supported = new Set(["heading", "paragraph", "list", "listItem", "text", "strong", "emphasis", "delete", "inlineCode", "break", "link", "image", "code", "thematicBreak", "table", "tableRow", "tableCell"]);

export function importedFingerprint(block: ImportedBlock): string {
  // Block IDs are tracked separately; default props are bound after BlockNote normalizes them.
  return JSON.stringify({ type: block.type, props: block.props, content: block.content, children: block.children });
}
function editable(node: AstNode): boolean {
  return supported.has(node.type) && node.lang !== "mermaid" && (node.children ?? []).every(editable);
}
export function decodeImportedMap(value: string | null | undefined): ImportedSourceMap | null {
  try {
    const map = JSON.parse(value ?? "null");
    if (map?.version !== 1 || typeof map.source !== "string" || typeof map.prefix !== "string" || typeof map.suffix !== "string" || !Array.isArray(map.chunks)) return null;
    if (!map.chunks.every((chunk: Chunk) => Array.isArray(chunk.ids) && chunk.ids.every(id => typeof id === "string") && Array.isArray(chunk.fingerprints) && chunk.fingerprints.every(f => typeof f === "string") && chunk.ids.length === chunk.fingerprints.length && typeof chunk.text === "string" && typeof chunk.gap === "string")) return null;
    if (map.prefix + map.chunks.map((chunk: Chunk) => chunk.gap + chunk.text).join("") + map.suffix !== map.source) return null;
    return map;
  } catch { return null; }
}

/** Opening a file does not convert or write it. Only changed chunks are exported. */
export async function loadImportedMarkdown(editor: MarkdownEditor, source: string, blocknote?: string | null, sourceMap?: string | null): Promise<{ blocks: ImportedBlock[]; map: ImportedSourceMap; cached?: boolean }> {
  const cached = decodeImportedMap(sourceMap);
  if (cached?.source === source && blocknote) {
    try {
      const blocks = JSON.parse(blocknote);
      if (Array.isArray(blocks) && blocks.length && blocks.every(b => typeof b.id === "string" && typeof b.type === "string") && new Set(blocks.map(b => b.id)).size === blocks.length) return { blocks, map: cached, cached: true };
    } catch { /* Reconstruct from the unchanged Markdown when a cache is malformed. */ }
  }
  const parts = splitMarkdownSource(source);
  const bom = !parts.frontmatter && parts.body.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = parts.body.slice(bom.length);
  const ast = parser.parse(body) as AstNode;
  const nodes = ast.children ?? [];
  const chunks: Chunk[] = [];
  const blocks: ImportedBlock[] = [];
  let cursor = 0;
  for (const node of nodes) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) throw new Error("Не удалось определить границы Markdown. Откройте режим Markdown.");
    const raw = body.slice(start, end);
    let parsed: ImportedBlock[] = [];
    if (editable(node) && !/!\[\[/.test(raw)) {
      try { parsed = await editor.tryParseMarkdownToBlocks(raw) as ImportedBlock[]; } catch { /* Unsupported syntax stays in an editable source block. */ }
    }
    if (!parsed.length) parsed = [{ id: crypto.randomUUID(), type: "sourceMarkdown", props: { markdown: raw }, children: [] }];
    for (const block of parsed) block.id ||= crypto.randomUUID();
    chunks.push({ ids: parsed.map(b => b.id), fingerprints: parsed.map(importedFingerprint), text: raw, gap: body.slice(cursor, start) });
    blocks.push(...parsed);
    cursor = end;
  }
  if (!blocks.length) blocks.push({ id: crypto.randomUUID(), type: "paragraph", content: [] });
  return { blocks, map: { version: 1, source, prefix: parts.frontmatter + bom, suffix: body.slice(cursor), chunks } };
}

/** Bind generated defaults and the editor's trailing empty paragraph without touching source. */
export function bindImportedMap(map: ImportedSourceMap, blocks: ImportedBlock[]): ImportedSourceMap {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const chunks = map.chunks.map(c => ({ ...c, fingerprints: c.ids.map(id => importedFingerprint(byId.get(id)!)) }));
  const known = new Set(chunks.flatMap(c => c.ids));
  for (const b of blocks) if (!known.has(b.id)) chunks.push({ ids: [b.id], fingerprints: [importedFingerprint(b)], text: "", gap: "" });
  return { ...map, chunks };
}

export async function saveImportedMarkdown(editor: MarkdownEditor, map: ImportedSourceMap, blocks: ImportedBlock[]): Promise<{ source: string; map: ImportedSourceMap }> {
  const fingerprints = blocks.map(importedFingerprint);
  const originalIds = map.chunks.flatMap(c => c.ids);
  if (originalIds.length === blocks.length && originalIds.every((id, i) => id === blocks[i].id) && map.chunks.flatMap(c => c.fingerprints).every((f, i) => f === fingerprints[i])) return { source: map.source, map };
  const owners = new Map<string, Chunk>();
  for (const c of map.chunks) for (const id of c.ids) owners.set(id, c);
  const chunks: Chunk[] = [];
  let index = 0;
  let previous: Chunk | undefined;
  while (index < blocks.length) {
    const first = blocks[index];
    const owner = owners.get(first.id);
    const run = [first];
    index++;
    // Preserve a whole list/table chunk while its members remain adjacent.
    if (owner) while (index < blocks.length && owners.get(blocks[index].id) === owner) run.push(blocks[index++]);
    const ids = run.map(b => b.id);
    const fp = run.map(importedFingerprint);
    const same = owner && ids.length === owner.ids.length && ids.every((id, i) => id === owner.ids[i] && fp[i] === owner.fingerprints[i]);
    let text: string;
    if (same) text = owner.text;
    else if (run.length === 1 && first.type === "sourceMarkdown") text = normalizeSourceEdit(String(first.props?.markdown ?? ""), map.source);
    else {
      text = await editor.blocksToMarkdownLossy(run);
      // BlockNote escapes the plain-text wiki syntax; restore it outside code only.
      text = mapMarkdownText(text, prose => prose.replace(/\\\[\\\[([^\n]*?)\\\]\\\]/g, "[[$1]]"));
      text = normalizeSourceEdit(text.replace(/\r?\n$/, ""), map.source);
    }
    const adjacent = owner && (previous ? map.chunks.indexOf(owner) === map.chunks.indexOf(previous) + 1 : map.chunks.indexOf(owner) === 0);
    const gap = chunks.length === 0 ? (owner && map.chunks.indexOf(owner) === 0 ? owner.gap : "") : (adjacent ? owner.gap : normalizeSourceEdit("\n\n", map.source));
    chunks.push({ ids, fingerprints: fp, text, gap });
    previous = owner;
  }
  const source = map.prefix + chunks.map(c => c.gap + c.text).join("") + map.suffix;
  return { source, map: { ...map, source, chunks } };
}
