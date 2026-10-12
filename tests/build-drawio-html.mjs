/** Build a disposable HTML export using the real host helper and pinned standalone viewer. */
import { build } from "esbuild";
import { DOMParser } from "@xmldom/xmldom";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(project, "tests/fixtures/drawio-html-validation.html");
globalThis.DOMParser = DOMParser;
const bundled = await build({
  entryPoints: [path.join(project, "src/lib/drawioFiles.ts")],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { createDrawioHtml } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
const xml = '<mxfile host="Synapse">' +
  '<diagram id="validation-first" name="Page One"><mxGraphModel><root>' +
  '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="first" value="Page One — Привет" vertex="1" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;">' +
  '<mxGeometry x="30" y="30" width="220" height="90" as="geometry"/></mxCell>' +
  '</root></mxGraphModel></diagram>' +
  '<diagram id="validation-second" name="Page Two"><mxGraphModel><root>' +
  '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="second" value="Page Two — distinct shape" vertex="1" parent="1" style="ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;">' +
  '<mxGeometry x="30" y="30" width="240" height="110" as="geometry"/></mxCell>' +
  '</root></mxGraphModel></diagram></mxfile>';
const viewer = await fs.readFile(path.join(project, "public/drawio/js/viewer-static.min.js"), "utf8");
const html = createDrawioHtml(xml, 'Portable viewer — Привет & "two pages"', viewer);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, html);
console.log(JSON.stringify({
  output, bytes: Buffer.byteLength(html), pages: 2,
  viewerSha256: createHash("sha256").update(viewer).digest("hex"),
  htmlSha256: createHash("sha256").update(html).digest("hex"),
}));

