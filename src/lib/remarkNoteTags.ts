type Node = { type: string; value?: string; children?: Node[]; url?: string };
const TAG = /(?<![\p{L}\p{N}_/\\])#([\p{L}][\p{L}\p{N}_/-]{0,40})(?![\p{L}\p{N}_/-])/gu;
/** Decorate prose only. Code, links, image labels and the original Markdown stay untouched. */
export function remarkNoteTags() {
  return (tree: Node) => {
    const visit = (node: Node) => {
      if (!node.children || ["code", "inlineCode", "link", "image", "linkReference"].includes(node.type)) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== "text" || !child.value) { visit(child); return [child]; }
        const output: Node[] = [];
        let cursor = 0;
        for (const match of child.value.matchAll(TAG)) {
          const start = match.index!;
          if (start > cursor) output.push({ type: "text", value: child.value.slice(cursor, start) });
          output.push({ type: "link", url: `synapse-tag:${encodeURIComponent(match[1].toLowerCase())}`, children: [{ type: "text", value: match[0] }] });
          cursor = start + match[0].length;
        }
        if (!output.length) return [child];
        if (cursor < child.value.length) output.push({ type: "text", value: child.value.slice(cursor) });
        return output;
      });
    };
    visit(tree);
  };
}
