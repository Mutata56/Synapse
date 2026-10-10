import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { mapMarkdownText } from "./obsidianImport";
import type { GraphReference } from "./graphTypes";

const parser = unified().use(remarkParse).use(remarkGfm);
type AstNode = { type: string; url?: string; identifier?: string; children?: AstNode[] };

/** Links come from inert Markdown syntax; fenced/inline code cannot create graph edges. */
export function collectGraphReferences(body: string): GraphReference[] {
  const references: GraphReference[] = [];
  const seen = new Set<string>();
  const add = (target: string, embedded: boolean) => {
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) return;
    const key = `${embedded}:${target}`;
    if (!seen.has(key)) { seen.add(key); references.push({ target, embedded }); }
  };
  mapMarkdownText(body, (text) => {
    const pattern = /(!?)\[\[([^\]\n]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      let escaped = 0;
      for (let i = match.index - 1; i >= 0 && text[i] === "\\"; i--) escaped++;
      if (escaped % 2 === 0) add(match[2], match[1] === "!");
    }
    return text;
  });
  const root = parser.parse(body) as AstNode;
  const definitions = new Map<string, string>();
  const visit = (node: AstNode, callback: (node: AstNode) => void) => {
    callback(node);
    for (const child of node.children ?? []) visit(child, callback);
  };
  visit(root, (node) => {
    if (node.type === "definition" && node.identifier && node.url) definitions.set(node.identifier.toLowerCase(), node.url);
  });
  visit(root, (node) => {
    if ((node.type === "link" || node.type === "image") && node.url) add(node.url, node.type === "image");
    if ((node.type === "linkReference" || node.type === "imageReference") && node.identifier) {
      const target = definitions.get(node.identifier.toLowerCase());
      if (target) add(target, node.type === "imageReference");
    }
  });
  return references;
}
