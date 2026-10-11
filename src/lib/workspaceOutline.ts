import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { splitMarkdownSource } from "./obsidianImport";

export type WorkspaceHeading = { depth: number; title: string; sourceOffset: number };
type MarkdownNode = {
  type: string;
  value?: string;
  alt?: string | null;
  depth?: number;
  children?: MarkdownNode[];
  position?: { start: { offset?: number } };
};
const parser = unified().use(remarkParse).use(remarkGfm);
function plainText(node: MarkdownNode): string {
  if (node.type === "html") return "";
  return node.value ?? node.alt ?? node.children?.map(plainText).join("") ?? "";
}

/** Keep heading order and source positions, including repeated and formatted titles. */
export function extractWorkspaceHeadings(source: string): WorkspaceHeading[] {
  const { frontmatter, body } = splitMarkdownSource(source);
  const headings: WorkspaceHeading[] = [];
  function walk(node: MarkdownNode) {
    if (node.type === "heading") headings.push({
      depth: node.depth ?? 1,
      title: plainText(node),
      sourceOffset: frontmatter.length + (node.position?.start.offset ?? 0),
    });
    node.children?.forEach(walk);
  }
  walk(parser.parse(body));
  return headings;
}
