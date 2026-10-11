import { parseCallout, parseNoteAst, type MarkdownNode } from "./noteBlockMarkdown";
/** Annotate Markdown for safe React rendering; raw HTML is never enabled. */
export function remarkNoteBlocks() {
  return (tree: MarkdownNode, file: { value: unknown }) => {
    let calloutIndex = 0, taskIndex = 0;
    const visit = (node: MarkdownNode, source: string) => {
      if (node.type === "code" || node.type === "inlineCode") return;
      const raw = source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
      const callout = node.type === "blockquote" ? parseCallout(raw) : null;
      if (callout) {
        const index = calloutIndex++;
        const title = parseNoteAst(callout.title).children?.[0]?.children ?? [];
        const body = parseNoteAst(callout.body);
        body.children?.forEach(child => visit(child, callout.body));
        node.data = { ...node.data, hName: "aside", hProperties: { "data-callout": callout.rawType, "data-callout-fold": callout.fold, "data-callout-index": index } };
        node.children = [{ type: "paragraph", data: { hName: "div", hProperties: { className: "note-callout-heading", "data-callout-heading": callout.variant } }, children: title }, ...(body.children ?? [])];
        return;
      }
      if (node.type === "listItem") {
        const match = /^(?:[ \t]*(?:[-+*]|\d+[.)])[ \t]+)\[([^\]\r\n])\][ \t]+/.exec(raw);
        if (match) {
          const marker = match[1];
          node.data = { ...node.data, hProperties: { "data-task-status": marker, "data-task-index": taskIndex++ } };
          if (node.checked == null) {
            const first = node.children?.[0]?.children?.[0];
            if (first?.type === "text") first.value = first.value?.replace(/^\[[^\]\r\n]\][ \t]+/, "");
          }
          node.checked = null;
        }
      }
      node.children?.forEach(child => visit(child, source));
    };
    visit(tree, String(file.value));
  };
}
