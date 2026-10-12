import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import vm from "node:vm";
import { deflateSync, inflateSync } from "node:zlib";
import { build } from "esbuild";
import { DOMParser } from "@xmldom/xmldom";

globalThis.DOMParser = DOMParser;
const fixture = { native: false, selected: null, destination: null, files: new Map(), writes: [], saves: [], invokes: [] };
globalThis.drawioFileFixture = fixture;
const compiled = await build({ entryPoints: ["src/lib/drawioFiles.ts"], bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "native-file-dialogs", setup(builder) {
    builder.onResolve({ filter: /^@tauri-apps\// }, (args) => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
      if (args.path.endsWith("/core")) return { contents:
        'export const isTauri=()=>globalThis.drawioFileFixture.native;export const invoke=(name,args)=>{globalThis.drawioFileFixture.invokes.push({name,args});return Promise.resolve([])};' };
      if (args.path.endsWith("plugin-dialog")) return { contents:
        'export const open=async()=>globalThis.drawioFileFixture.selected;export const save=async options=>{globalThis.drawioFileFixture.saves.push(options);return globalThis.drawioFileFixture.destination;};' };
      return { contents:
        'export const readFile=async path=>globalThis.drawioFileFixture.files.get(path);export const writeFile=async(path,bytes)=>{globalThis.drawioFileFixture.writes.push({path,bytes:new Uint8Array(bytes)});};' };
    });
  } }] });
const files = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
vm.runInThisContext(await fs.readFile("public/drawio/pdf-lib.min.js", "utf8"));
const lib = globalThis.PDFLib;
const xml = '<mxfile><diagram id="first" name="Страница 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="hello" value="Привет 100% &amp; café" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram><diagram id="second" name="Страница 2"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><text x="5" y="10">Привет + café</text></svg>';
const utf8 = (value) => new TextEncoder().encode(value);
const base64 = (value) => Buffer.from(value).toString("base64");

test("exports preserve Unicode across raw text, base64 and percent data URLs", () => {
  for (const data of [svg, base64(utf8(svg)), "data:image/svg+xml;base64," + base64(utf8(svg)), "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)]) {
    assert.equal(new TextDecoder().decode(files.decodeDrawioExport(data, "svg")), svg);
  }
  assert.equal(new TextDecoder().decode(files.decodeDrawioExport(xml, "xml")), xml);
  assert.equal(new TextDecoder().decode(files.decodeDrawioExport(xml, "drawio")), xml);
});

test("binary data URI decoding keeps PNG bytes and literal plus signs", () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 43, 255]);
  assert.deepEqual(files.decodeDrawioExport("data:image/png;base64," + base64(png), "png"), new Uint8Array(png));
  assert.deepEqual(files.decodeDrawioExport("data:image/png,%89PNG%0D%0A%1A%0A+%FF", "png"), new Uint8Array(png));
  assert.throws(() => files.decodeDrawioExport("data:image/png;base64," + base64(png), "pdf"), /не соответствует/);
  assert.throws(() => files.decodeDrawioExport("not a PNG", "png"));
  assert.throws(() => files.decodeDrawioExport("", "xml"), /пустой/);
});

test("text and JPEG export formats stay within the explicit whitelist", () => {
  assert.equal(files.isDrawioExportFormat("svg"), true);
  assert.equal(files.isDrawioExportFormat("__proto__"), false);
  assert.equal(files.isDrawioExportFormat("exe"), false);
  assert.throws(() => files.decodeDrawioExport("text", "exe"), /не поддерживается/);
  assert.throws(() => files.drawioExportFilename("text", "exe"), /не поддерживается/);
  const json = JSON.stringify({ title: "Привет", pages: 2 }), csv = 'id,label\n1,"café + 100%"';
  assert.equal(new TextDecoder().decode(files.decodeDrawioExport(json, "json")), json);
  assert.equal(new TextDecoder().decode(files.decodeDrawioExport(csv, "csv")), csv);
  assert.equal(new TextDecoder().decode(files.decodeDrawioExport("<!doctype html><html><body>Привет</body></html>", "html")).includes("Привет"), true);
  assert.deepEqual(files.decodeDrawioExport(base64([255, 216, 255, 0]), "jpg"), new Uint8Array([255, 216, 255, 0]));
  assert.throws(() => files.decodeDrawioExport(base64([137, 80]), "jpeg"));
});

test("filenames retain usable extensions and remove filesystem control characters", () => {
  assert.equal(files.drawioExportFilename("План.drawio", "xml"), "План.drawio");
  assert.equal(files.drawioExportFilename("План.XML", "xml"), "План.XML");
  assert.equal(files.drawioExportFilename("/tmp/План.drawio.svg", "png"), "План.png");
  assert.equal(files.drawioExportFilename('A:*?<>.xml', "pdf"), "A_____.pdf");
  assert.equal(files.drawioExportFilename("CON", "svg"), "drawing-CON.svg");
  assert.equal(files.drawioExportFilename("", "xml"), "Холст.drawio");
  assert.ok(files.drawioExportFilename("a".repeat(300) + ".svg", "svg").endsWith(".svg"));
});

test("XML and SVG import guards reject unrelated files before editor replacement", async () => {
  const imported = await files.readDrawioFileData(utf8(xml), "original.drawio");
  assert.deepEqual(imported, { xml, name: "original.drawio" });
  await assert.rejects(files.readDrawioFileData(utf8("<other/>"), "broken.drawio"), /не содержит/);
  await assert.rejects(files.readDrawioFileData(utf8("<mxfile/>"), "empty.drawio"), /нет страниц/);
  await assert.rejects(files.readDrawioFileData(new Uint8Array(), "empty.drawio"), /пуст/);
  await assert.rejects(files.readDrawioFileData(utf8(svg), "flat.svg"), /нет встроенной/);
  const carrier = '<svg xmlns="http://www.w3.org/2000/svg" content="' + encodeURIComponent(xml) + '"></svg>';
  assert.equal((await files.readDrawioFileData(utf8(carrier), "editable.svg")).xml, xml);
});

function pngWithModel(model) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const result = Buffer.alloc(12 + data.length);
    result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8);
    return result; // Only the carrier reader is under test, independent of rendering or CRC validation.
  };
  return Buffer.concat([header, chunk("IHDR", Buffer.alloc(13)), ...(model ? [chunk("tEXt", Buffer.from("mxfile\0" + encodeURIComponent(model)))] : []),
    chunk("IDAT", Buffer.from([0])), chunk("IEND", Buffer.alloc(0))]);
}

test("PNG imports require an actual model carrier and leave compressed payloads intact", async () => {
  const png = pngWithModel(xml);
  assert.equal(files.pngHasDrawioModel(png), true);
  const imported = await files.readDrawioFileData(png, "editable.PNG");
  assert.equal(imported.xml, "data:image/png;base64," + base64(png));
  await assert.rejects(files.readDrawioFileData(pngWithModel(null), "flat.png"), /нет встроенной/);
  assert.equal(files.pngHasDrawioModel(png.subarray(0, 30)), false);
});

test("native dialog cancellation does not read or write files; saves use decoded bytes", async () => {
  fixture.native = true; fixture.selected = null; fixture.destination = null; fixture.writes.length = 0;
  assert.equal(await files.importDrawioFile(), null);
  await files.saveDrawioExport(xml, "xml", "model");
  assert.equal(fixture.writes.length, 0);
  fixture.selected = "/chosen/model.drawio"; fixture.files.set(fixture.selected, utf8(xml));
  assert.deepEqual(await files.importDrawioFile(), { xml, name: "model.drawio" });
  fixture.destination = "/chosen/model.svg";
  await files.saveDrawioExport("data:image/svg+xml;base64," + base64(utf8(svg)), "svg", "model.drawio");
  assert.equal(fixture.saves.at(-1).defaultPath, "model.svg");
  assert.equal(new TextDecoder().decode(fixture.writes.at(-1).bytes), svg);
  fixture.native = false; fixture.selected = null; fixture.destination = null;
});

test("SVG page dimensions honor CSS units and viewBox fallbacks", () => {
  assert.deepEqual(files.getDrawioSvgPage(svg), { svg, width: 200, height: 100 });
  const points = '<svg xmlns="http://www.w3.org/2000/svg" width="144pt" height="72pt"></svg>';
  assert.equal(files.getDrawioSvgPage(points).width, 192);
  const viewBox = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 640 480"></svg>';
  assert.equal(files.getDrawioSvgPage(viewBox).height, 480);
  assert.throws(() => files.getDrawioSvgPage('<svg xmlns="http://www.w3.org/2000/svg"/>'), /размер/);
});

async function vectorPage(width, height, label) {
  const document = await lib.PDFDocument.create(), page = document.addPage([width, height]);
  page.drawText(label, { x: 10, y: 10, size: 10 });
  page.drawRectangle({ x: 20, y: 25, width: 50, height: 20, borderWidth: 1 });
  return { bytes: await document.save({ useObjectStreams: false }), width, height };
}

test("real PDF assembly retains every vector page and the complete editable model", async () => {
  const pages = [await vectorPage(400, 200, "Page 1"), await vectorPage(600, 300, "Page 2")];
  const bytes = await files.assembleDrawioPdf(pages, xml, "Две страницы");
  assert.ok(Buffer.from(bytes).subarray(0, 5).equals(Buffer.from("%PDF-")));
  const reopened = await lib.PDFDocument.load(bytes);
  assert.equal(reopened.getPageCount(), 2);
  assert.deepEqual(reopened.getPages().map((page) => [page.getWidth(), page.getHeight()]), [[300, 150], [450, 225]]);
  assert.equal(decodeURIComponent(reopened.getSubject()), xml);
  assert.equal(reopened.getAttachments()[0].mimeType, "application/vnd.jgraph.mxfile");
  assert.equal(new TextDecoder().decode(reopened.getAttachments()[0].data), xml);
  assert.equal((await files.readDrawioFileData(bytes, "editable.pdf")).xml, xml);
  await assert.rejects(files.assembleDrawioPdf([], xml, "empty"), /нет страниц/);
});

test("PDF imports recover attachments when Subject is absent and reject flat PDFs", async () => {
  const document = await lib.PDFDocument.create(); document.addPage([200, 100]);
  const flat = await document.save({ useObjectStreams: false });
  await assert.rejects(files.readDrawioFileData(flat, "flat.pdf"), /нет встроенной/);
  await document.attach(utf8(xml), "model.drawio", { mimeType: "application/vnd.jgraph.mxfile" });
  const attached = await document.save({ useObjectStreams: false, rewrite: true });
  assert.equal((await files.readDrawioFileData(attached, "attached.pdf")).xml, xml);
});

test("browser PDF request reports vector capability instead of saving SVG or raster bytes as PDF", async () => {
  fixture.native = false;
  await assert.rejects(files.exportDrawioPdf([files.getDrawioSvgPage(svg)], xml, "model"), /macOS/);
  assert.equal(fixture.invokes.length, 0);
});


test("browser fallback imports selected bytes and downloads a correctly typed Unicode SVG", async () => {
  fixture.native = false;
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const createObjectURL = URL.createObjectURL, revokeObjectURL = URL.revokeObjectURL;
  const downloads = [], blobs = [], revoked = [];
  let cancel = false;
  globalThis.document = {
    baseURI: "https://synapse.test/",
    body: { appendChild() {} },
    createElement(tag) {
      const handlers = new Map();
      return { style: {}, files: [{ name: "browser.drawio", arrayBuffer: async () => utf8(xml).buffer }],
        addEventListener(event, handler) { handlers.set(event, handler); },
        remove() {}, click() {
          if (tag === "input") { if (cancel) handlers.get("cancel")?.(); else this.onchange?.(); }
          else downloads.push({ href: this.href, download: this.download });
        } };
    },
  };
  globalThis.window = { setTimeout: (callback) => { callback(); return 0; } };
  URL.createObjectURL = (blob) => { blobs.push(blob); return "blob:fixture"; };
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  try {
    assert.deepEqual(await files.importDrawioFile(), { xml, name: "browser.drawio" });
    cancel = true;
    assert.equal(await files.importDrawioFile(), null);
    await files.saveDrawioExport(svg, "svg", "browser.drawio");
    assert.deepEqual(downloads, [{ href: "blob:fixture", download: "browser.svg" }]);
    assert.equal(blobs[0].type, "image/svg+xml");
    assert.equal(await blobs[0].text(), svg);
    assert.deepEqual(revoked, ["blob:fixture"]);
  } finally {
    globalThis.document = previousDocument; globalThis.window = previousWindow;
    URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL;
  }
});


const upstreamBlankPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";
const upstreamBlankPng = Buffer.from(upstreamBlankPngBase64, "base64");

function pngChunk(type, payload) {
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length); chunk.write(type, 4); payload.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 8 + payload.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + payload.length);
  return chunk;
}

function renderedPng(width = 1, height = 1, carrier = false) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  // Opaque coloured pixels are a legitimate 1×1 image, unlike the known error substitute.
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const index = row * (width * 4 + 1) + 1 + column * 4;
    rows[index] = 220; rows[index + 1] = 38; rows[index + 2] = 38; rows[index + 3] = 255;
  }
  return Buffer.concat([upstreamBlankPng.subarray(0, 8), pngChunk("IHDR", header),
    ...(carrier ? [pngChunk("tEXt", Buffer.from("mxfile\0" + encodeURIComponent(xml)))] : []),
    pngChunk("IDAT", deflateSync(rows)), pngChunk("IEND", Buffer.alloc(0))]);
}

test("the exact shipped blankImage is a transparent 1×1 failed-export carrier", () => {
  assert.equal(upstreamBlankPng.readUInt32BE(16), 1);
  assert.equal(upstreamBlankPng.readUInt32BE(20), 1);
  // IHDR is 25 bytes including its wrapper; the next chunk is the source's IDAT.
  assert.equal(upstreamBlankPng.toString("ascii", 37, 41), "IDAT");
  const pixels = inflateSync(upstreamBlankPng.subarray(41, 51));
  assert.deepEqual([...pixels], [0, 0, 0, 0, 0]);
  assert.throws(() => files.assertRenderedDrawioPng(upstreamBlankPng), /не был отрисован.*SVG/);
  assert.throws(() => files.assertRenderedDrawioPng(upstreamBlankPng.subarray(0, 44)), /повреждён.*SVG/);
});

test("failed PNG exports stop before opening a native save dialog", async () => {
  fixture.native = true; fixture.destination = "/chosen/not-written.png";
  const beforeSaves = fixture.saves.length, beforeWrites = fixture.writes.length;
  try {
    await assert.rejects(files.saveDrawioExport("data:image/png;base64," + upstreamBlankPngBase64, "png", "failed"), /SVG/);
    assert.equal(fixture.saves.length, beforeSaves);
    assert.equal(fixture.writes.length, beforeWrites);
  } finally { fixture.native = false; fixture.destination = null; }
});

test("xmlpng metadata does not disguise the placeholder, while import still recovers its model", async () => {
  const withModel = Buffer.concat([upstreamBlankPng.subarray(0, 33),
    pngChunk("tEXt", Buffer.from("mxfile\0" + encodeURIComponent(xml))), upstreamBlankPng.subarray(33)]);
  assert.equal(files.pngHasDrawioModel(withModel), true);
  assert.throws(() => files.assertRenderedDrawioPng(withModel), /не был отрисован.*SVG/);
  assert.equal((await files.readDrawioFileData(withModel, "recoverable.png")).xml, "data:image/png;base64," + base64(withModel));
});

test("valid single-pixel and larger rendered PNGs preserve their original bytes and XML carriers", async () => {
  for (const bytes of [renderedPng(), renderedPng(2, 3), renderedPng(2, 3, true)]) {
    assert.doesNotThrow(() => files.assertRenderedDrawioPng(bytes));
    fixture.native = true; fixture.destination = "/chosen/rendered.png";
    try {
      await files.saveDrawioExport("data:image/png;base64," + base64(bytes), "png", "rendered");
      assert.deepEqual(fixture.writes.at(-1).bytes, new Uint8Array(bytes));
    } finally { fixture.native = false; fixture.destination = null; }
  }
  assert.equal(files.pngHasDrawioModel(renderedPng(2, 3, true)), true);
});

test("standalone HTML preserves viewer dollar tokens and safely escapes script terminators", () => {
  const tokens = ["$&", "$$", "$`", "$'", "</script>", "</SCRIPT>"];
  const viewer = "globalThis.viewerTokens = " + JSON.stringify(tokens) + ";";
  const tag = '<script type="text/javascript" src="https://www.drawio.com/js/viewer-static.min.js"></script>';
  const before = '<!doctype html><html><body><p>Before 👋</p>';
  const after = '<p>After Привет</p></body></html>';
  const html = files.prepareDrawioHtml(before + tag + after, viewer);
  const escaped = viewer.replace("</script>", "<\\/script>").replace("</SCRIPT>", "<\\/SCRIPT>");
  assert.equal(html, before + "<script>" + escaped + "</script>" + after);
  assert.equal(html.includes("viewer-static.min.js"), false);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const context = {}; vm.runInNewContext(script, context);
  assert.deepEqual(Array.from(context.viewerTokens), tokens, "script execution sees the unchanged literals");
});

test("standalone HTML decodes Unicode data URIs and replaces only upstream viewer tags", () => {
  const upstream = '<div class="mxgraph" data-mxgraph="{&quot;xml&quot;:&quot;Привет + café&quot;}"></div>' +
    '<script src="https://embed.diagrams.net/js/embed-static.min.js?version=pinned"></script>' +
    '<script src="local-extra.js"></script>';
  const viewer = 'globalThis.example = "$$ $&";';
  const expected = '<div class="mxgraph" data-mxgraph="{&quot;xml&quot;:&quot;Привет + café&quot;}"></div>' +
    '<script>globalThis.example = "$$ $&";</script><script src="local-extra.js"></script>';
  for (const carrier of [upstream, "data:text/html;base64," + base64(utf8(upstream)), "data:text/html;charset=utf-8," + encodeURIComponent(upstream)]) {
    assert.equal(files.prepareDrawioHtml(carrier, viewer), expected);
  }
  assert.equal(files.prepareDrawioHtml('<html><body>Без внешнего viewer</body></html>', viewer),
    '<html><body>Без внешнего viewer</body></html>');
});

test("direct standalone HTML preserves all mxfile pages and escapes model JSON and title", () => {
  const title = 'План <script>"&\'</script> 👋';
  const html = files.createDrawioHtml(xml, title, 'globalThis.testViewer = true;');
  const document = new DOMParser().parseFromString(html, "text/html");
  assert.equal(document.getElementsByTagName("title")[0].textContent, title);
  const diagram = document.getElementsByTagName("div")[0];
  assert.equal(diagram.getAttribute("class"), "mxgraph");
  const config = JSON.parse(diagram.getAttribute("data-mxgraph"));
  assert.equal(config.xml, xml);
  assert.equal(config.nav, true); assert.equal(config.resize, true); assert.equal(config.page, 0);
  assert.equal(config["toolbar-nohide"], 1);
  assert.equal(config.toolbar, "pages zoom layers lightbox");
  const model = new DOMParser().parseFromString(config.xml, "application/xml");
  assert.equal(model.getElementsByTagName("diagram").length, 2);
  assert.equal(model.getElementsByTagName("diagram")[1].getAttribute("name"), "Страница 2");
  assert.equal(model.getElementById("hello")?.getAttribute("value") ?? model.getElementsByTagName("mxCell")[2].getAttribute("value"),
    "Привет 100% & café");
  assert.equal(document.getElementsByTagName("script").length, 1, "model/title text cannot create script elements");
  assert.equal(document.getElementsByTagName("script")[0].hasAttribute("src"), false);
  assert.equal([...Array(document.getElementsByTagName("meta").length)].some((_, index) =>
    document.getElementsByTagName("meta")[index].getAttribute("http-equiv") === "refresh"), false);
});

test("direct HTML builder keeps executable viewer dollars and rejects unrelated models", () => {
  const tokens = ["$&", "$$", "$`", "$'", "</script>"];
  const viewer = "globalThis.viewerTokens = " + JSON.stringify(tokens) + ";";
  const html = files.createDrawioHtml(xml, "", viewer);
  const document = new DOMParser().parseFromString(html, "text/html");
  assert.equal(document.getElementsByTagName("title")[0].textContent, "Холст");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const context = {}; vm.runInNewContext(script, context);
  assert.deepEqual(Array.from(context.viewerTokens), tokens);
  assert.throws(() => files.createDrawioHtml("<other/>", "Wrong", viewer), /не содержит/);
});
