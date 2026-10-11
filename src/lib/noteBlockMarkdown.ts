import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { calloutType, taskMarker } from "./noteBlockTypes";
import { splitMarkdownSource } from "./obsidianImport";

export type MarkdownNode = { type: string; value?: string; checked?: boolean | null; lang?: string; children?: MarkdownNode[]; data?: Record<string, any>; position?: { start: { offset?: number }; end: { offset?: number } } };
const parser = unified().use(remarkParse).use(remarkGfm);
export const parseNoteAst = (source: string) => parser.parse(source) as MarkdownNode;
export type CalloutHeader = { rawType: string; variant: string; fold: string; title: string; body: string };
const HEADER = /^[ \t]*>[ \t]*\[!([a-z0-9_-]+)\]([+-]?)([^\r\n]*)/i;
const TASK = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)\[([^\]\r\n])\]([ \t]+)/;
export function parseCallout(raw: string): CalloutHeader | null {
  const match = HEADER.exec(raw);
  if (!match) return null;
  const lines = raw.split(/\r?\n/);
  return { rawType: match[1], variant: calloutType(match[1]), fold: match[2] === "+" ? "open" : match[2] === "-" ? "closed" : "none", title: match[3].trim(), body: lines.slice(1).map(line => line.replace(/^[ \t]*>[ \t]?/, "")).join("\n") };
}
export type NoteMarker = { kind: "callout" | "task"; value: string; start: number; end: number };
/** Source positions come from Markdown nodes; code and inline examples are never edited. */
export function noteMarkers(source: string): NoteMarker[] {
  const body = splitMarkdownSource(source).body;
  const prefix = source.length - body.length;
  const markers: NoteMarker[] = [];
  const walk = (node: MarkdownNode) => {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      const raw = body.slice(start, end);
      if (node.type === "blockquote") {
        const match = HEADER.exec(raw);
        if (match) { const at = prefix + start + match[0].indexOf("[!") + 2; markers.push({ kind: "callout", value: match[1], start: at, end: at + match[1].length }); }
      } else if (node.type === "listItem") {
        const match = TASK.exec(raw);
        if (match) { const at = prefix + start + match[1].length + 1; markers.push({ kind: "task", value: match[2], start: at, end: at + 1 }); }
      }
    }
    if (node.type !== "code" && node.type !== "inlineCode") node.children?.forEach(walk);
  };
  walk(parseNoteAst(body));
  return markers;
}
export function changeNoteMarker(source: string, kind: NoteMarker["kind"], index: number, value: string): string {
  if (kind === "task" ? value.length !== 1 || /[\]\r\n]/.test(value) : !/^[a-z0-9_-]+$/i.test(value)) return source;
  const marker = noteMarkers(source).filter(marker => marker.kind === kind)[index];
  return marker ? source.slice(0, marker.start) + value + source.slice(marker.end) : source;
}

export type MarkdownBlock = { id?: string; type: string; props?: Record<string, any>; content?: any; children?: MarkdownBlock[] };
export type MarkdownExporter = { blocksToMarkdownLossy: (blocks: any) => Promise<string> | string };
/** Preserve custom checkbox characters while using BlockNote for inline formatting and list nesting. */
export async function blocksToNoteMarkdown(editor: MarkdownExporter, blocks: MarkdownBlock[]): Promise<string> {
  const parts: string[] = [];
  let ordinary: MarkdownBlock[] = [];
  const flush = async () => {
    if (!ordinary.length) return;
    const statuses = new Map<string, string>();
    let sequence = 0;
    const prepare = (block: MarkdownBlock): MarkdownBlock => {
      const result = { ...block, children: block.children?.map(prepare) };
      if (block.type === "checkListItem") {
        const token = `SYNAPSETASK${sequence++}MARKER${String(block.id ?? "").replace(/[^a-z0-9]/gi, "")}END`;
        statuses.set(token, taskMarker(block.props));
        const content = Array.isArray(block.content) ? block.content : typeof block.content === "string" ? [{ type: "text", text: block.content, styles: {} }] : [];
        result.content = [{ type: "text", text: token + " ", styles: {} }, ...content];
      }
      return result;
    };
    let output = await editor.blocksToMarkdownLossy(ordinary.map(prepare));
    for (const [token, marker] of statuses) {
      // The injected token precedes the body, so literal checkbox text in prose cannot match.
      output = output.replace(new RegExp(`(^[ \\t>]*(?:[-+*]|\\d+[.)])[ \\t]+)\\[[ xX]\\]([ \\t]+)${token}[ \\t]*`, "gm"), (_all, prefix, gap) => `${prefix}[${marker}]${gap}`);
    }
    parts.push(output.replace(/\r?\n$/, ""));
    ordinary = [];
  };
  for (const block of blocks) {
    if (block.type !== "callout" && block.type !== "sourceMarkdown") { ordinary.push(block); continue; }
    await flush();
    if (block.type === "sourceMarkdown") { parts.push(String(block.props?.markdown ?? "")); continue; }
    const props = block.props ?? {};
    const kind = String(props.calloutType || props.variant || "info");
    const title = String(props.title ?? "").replace(/[\r\n]+/g, " ");
    const fold = props.fold === "open" ? "+" : props.fold === "closed" ? "-" : "";
    const body = await blocksToNoteMarkdown(editor, [{ type: "paragraph", content: block.content ?? [] }, ...(block.children ?? [])]);
    parts.push(`> [!${kind}]${fold}${title ? " " + title : ""}` + (body.trim() ? "\n" + body.replace(/\r?\n$/, "").split(/\r?\n/).map(line => line ? "> " + line : ">").join("\n") : ""));
  }
  await flush();
  return parts.join("\n\n") + (parts.length ? "\n" : "");
}

/** A style-only edit patches markers without reformatting the containing list/callout. */
export function patchBlockStyles(source: string, fingerprints: string[], blocks: MarkdownBlock[]): string | null {
  let before: MarkdownBlock[];
  try { before = fingerprints.map(value => JSON.parse(value)); } catch { return null; }
  const strip = (block: MarkdownBlock): any => {
    const props = { ...block.props };
    if (block.type === "checkListItem") { delete props.checked; delete props.taskStatus; }
    if (block.type === "callout") { delete props.variant; delete props.calloutType; delete props.emoji; }
    return { type: block.type, props, content: block.content, children: block.children?.map(strip) };
  };
  if (before.length !== blocks.length || JSON.stringify(before.map(strip)) !== JSON.stringify(blocks.map(strip))) return null;
  const changes: Array<{ kind: NoteMarker["kind"]; value: string }> = [];
  const walk = (block: MarkdownBlock) => {
    if (block.type === "sourceMarkdown") changes.push(...noteMarkers(String(block.props?.markdown ?? "")).map(marker => ({ kind: marker.kind, value: marker.value })));
    if (block.type === "callout") changes.push({ kind: "callout", value: String(block.props?.calloutType || block.props?.variant || "info") });
    if (block.type === "checkListItem") changes.push({ kind: "task", value: taskMarker(block.props) });
    block.children?.forEach(walk);
  };
  blocks.forEach(walk);
  const markers = noteMarkers(source);
  if (!changes.length || markers.length !== changes.length || changes.some((change, index) => change.kind !== markers[index].kind)) return null;
  let output = source;
  for (let index = markers.length - 1; index >= 0; index--) {
    const marker = markers[index], value = changes[index].value;
    output = output.slice(0, marker.start) + value + output.slice(marker.end);
  }
  return output;
}
