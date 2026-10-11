import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const result = await build({ entryPoints: [new URL("../src/lib/workspaceOutline.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm" });
const { extractWorkspaceHeadings } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

test("outline strips inline formatting while retaining repeated heading occurrences", () => {
  const source = "# **Important**\n\n## [Link](https://example.com) and `code`\n\n# **Important**\n";
  const headings = extractWorkspaceHeadings(source);
  assert.deepEqual(headings.map(({ depth, title }) => ({ depth, title })), [
    { depth: 1, title: "Important" }, { depth: 2, title: "Link and code" }, { depth: 1, title: "Important" },
  ]);
  assert.equal(headings[2].sourceOffset, source.lastIndexOf("# **Important**"));
});

test("outline ignores YAML and fenced code; source offsets retain CRLF and frontmatter", () => {
  const source = "---\r\ntitle: Example\r\n---\r\n\r\n```md\r\n# fake\r\n~~~\r\n```\r\n\r\n## Real\r\n";
  const headings = extractWorkspaceHeadings(source);
  assert.deepEqual(headings, [{ depth: 2, title: "Real", sourceOffset: source.indexOf("## Real") }]);
});

test("outline supports setext and nested headings in document order", () => {
  const source = "Title\n=====\n\n> ## Quoted\n\n- ### Nested\n";
  assert.deepEqual(extractWorkspaceHeadings(source).map(({ depth, title }) => ({ depth, title })), [
    { depth: 1, title: "Title" }, { depth: 2, title: "Quoted" }, { depth: 3, title: "Nested" },
  ]);
});
