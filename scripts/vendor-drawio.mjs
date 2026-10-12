#!/usr/bin/env node
/**
 * Rebuild the pinned, local draw.io editor from a verified desktop extraction.
 * Does not execute upstream JavaScript, fetch dependencies, or touch other assets.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "32.4.1";
const ASAR_SHA256 = "e4245dea2cc2325dab61fcd2aa578e0a4bc539559d9c96160369cdb42eb19cc0";
const VIEWER_SHA256 = "bc7586cb62eec98018c13b78619078d3a7179cc7bfc711c566dda19527520a30";
const VIEWER_COMMIT = "9034053fba80a435e27d68d374bc564b83917ae9";
const VIEWER_BLOB_SHA = "1567641947042e5817b749e7193885ad5075041b";
const VIEWER_BEGIN = `/* SYNAPSE_UPSTREAM_VIEWER_BEGIN ${VIEWER_SHA256} */\n`;
const VIEWER_END = "\n/* SYNAPSE_UPSTREAM_VIEWER_END */\n";
const SOURCE_PREFIX = "drawio/src/main/webapp/";
const REPOSITORY_URL = "https://github.com/jgraph/drawio";
const MANIFEST_NAME = "vendor-manifest.json";
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const options = {};
for (let i = 0; i < argv.length; i++) {
  const key = argv[i];
  if (key === "--check") options.check = true;
  else if (["--source", "--manifest", "--viewer", "--out"].includes(key) && argv[i + 1] && !argv[i + 1].startsWith("--")) options[key.slice(2)] = argv[++i];
  else throw new Error(`Unknown or incomplete argument: ${key}`);
}
const out = resolve(options.out || join(scriptRoot, "public/drawio"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const targetPath = (name) => {
  const path = resolve(out, name);
  if (!path.startsWith(`${out}${sep}`)) throw new Error(`Unsafe output path: ${name}`);
  return path;
};
const protectedFiles = new Set(["pdf-lib.min.js", "pdf-lib.LICENSE", "js/pdf-lib.min.js", "js/pdf-lib.LICENSE"]);

if (options.check) {
  const manifest = JSON.parse(readFileSync(join(out, MANIFEST_NAME), "utf8"));
  if (manifest.upstream.version !== VERSION || manifest.upstream.asarSha256 !== ASAR_SHA256) throw new Error("The vendor manifest does not describe the pinned draw.io artifact");
  let bytes = 0;
  for (const file of manifest.files) {
    const contents = readFileSync(targetPath(file.path));
    if (hash(contents) !== file.sha256 || contents.length !== file.bytes) throw new Error(`Published file changed: ${file.path}`);
    bytes += contents.length;
  }
  const bootstrap = readFileSync(join(out, "js/bootstrap.js"), "utf8");
  const config = readFileSync(join(out, "js/PreConfig.js"), "utf8");
  if (!bootstrap.includes("var mxIsElectron = false;") || !config.includes("window.EXPORT_URL = null;") || !config.includes("urlParams['offline'] = '1';")) throw new Error("Local bootstrap policy is missing");
  console.log(JSON.stringify({ verified: true, version: VERSION, files: manifest.files.length, bytes }));
  process.exit(0);
}

if (!options.source || !options.manifest) throw new Error("Usage: node scripts/vendor-drawio.mjs --source <verified drawio/src/main/webapp> --manifest <package-manifest.json> [--viewer <official v32.4.1 viewer-static.min.js>] [--out public/drawio]; --check verifies a published copy without the extraction");
const source = resolve(options.source);
const packageManifest = JSON.parse(readFileSync(resolve(options.manifest), "utf8"));
if (packageManifest.subject_sha256 !== ASAR_SHA256 || packageManifest.executed_target_code !== false) throw new Error("The extraction must match the pinned ASAR digest and must be recorded as inert extraction");
const upstreamMembers = new Map(packageManifest.members.filter((file) => file.kind === "file").map((file) => [file.path, file]));
let upstreamViewer;
if (options.viewer) upstreamViewer = readFileSync(resolve(options.viewer));
else if (existsSync(join(out, "js/viewer-static.min.js"))) {
  // Reuse the exact retained upstream bytes for repeatable offline rebuilds.
  const existing = readFileSync(join(out, "js/viewer-static.min.js"));
  const begin = existing.indexOf(Buffer.from(VIEWER_BEGIN));
  const end = existing.indexOf(Buffer.from(VIEWER_END));
  if (begin >= 0 && end > begin) upstreamViewer = existing.subarray(begin + Buffer.byteLength(VIEWER_BEGIN), end);
}
if (!upstreamViewer || hash(upstreamViewer) !== VIEWER_SHA256) throw new Error(`Supply the exact pinned official viewer with --viewer. Expected SHA-256 ${VIEWER_SHA256}; source https://raw.githubusercontent.com/jgraph/drawio/${VIEWER_COMMIT}/src/main/webapp/js/viewer-static.min.js`);
const viewerBlobSha = createHash("sha1").update(Buffer.from(`blob ${upstreamViewer.length}\0`)).update(upstreamViewer).digest("hex");
if (viewerBlobSha !== VIEWER_BLOB_SHA) throw new Error("The official viewer does not match its pinned Git blob");
const files = [];
const exclusions = [];
const modified = new Map();
const skip = new Map([
  ["js/diagramly/ElectronApp.js", "Desktop Electron runtime adapter; the host uses the browser embed protocol"],
  ["js/diagramly/DesktopLibrary.js", "Desktop filesystem library adapter"],
  ["js/libavoid-js/CLAUDE.md", "Non-runtime repository agent instructions"],
  ["dropbox.html", "Cloud authentication callback; cloud integrations are disabled"],
  ["github.html", "Cloud authentication callback; cloud integrations are disabled"],
  ["gitlab.html", "Cloud authentication callback; cloud integrations are disabled"],
  ["onedrive3.html", "Cloud authentication callback; cloud integrations are disabled"],
  ["teams.html", "Cloud host adapter"],
  ["monday-app-association.json", "Cloud host association"],
]);

function walk(path) {
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en")).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${entryPath}`);
    return entry.isDirectory() ? walk(entryPath) : entry.isFile() ? [entryPath] : [];
  });
}
function verifiedMember(member, path) {
  const record = upstreamMembers.get(member);
  const contents = readFileSync(path);
  if (!record || record.sha256 !== hash(contents) || record.size !== contents.length || record.declared_integrity_verified !== true) throw new Error(`Unverified upstream member: ${member}`);
  return { contents, record };
}
function publish(name, contents, provenance) {
  if (protectedFiles.has(name)) throw new Error(`Another worker owns ${name}`);
  const path = targetPath(name);
  mkdirSync(dirname(path), { recursive: true });
  // Avoid touching unchanged resources on subsequent runs (and avoid Vite reloads).
  if (!existsSync(path) || !readFileSync(path).equals(contents)) {
    const temporary = `${path}.vendor-${process.pid}`;
    writeFileSync(temporary, contents);
    renameSync(temporary, path);
  }
  files.push({ path: name, bytes: contents.length, sha256: hash(contents), ...provenance });
}
function replaceExactly(input, match, replacement, name) {
  if (input.split(match).length !== 2) throw new Error(`Upstream ${name} changed; review its local adaptation`);
  return input.replace(match, replacement);
}

const policy = [
  "default-src 'self' data: blob:",
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https: http:",
  "img-src 'self' data: blob: asset: http: https:",
  "font-src 'self' data: blob: asset: http: https:",
  "connect-src 'self' data: blob: asset: http: https:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "media-src 'self' data: blob: asset: http: https:",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join("; ") + ";";
const originalIndex = verifiedMember(`${SOURCE_PREFIX}index.html`, join(source, "index.html")).contents.toString();
let index = replaceExactly(originalIndex, "    <meta charset=\"utf-8\">", `    <meta charset="utf-8">\n    <!-- Modified for Synapse: scoped local editor policy; upstream diagram/editor code is unchanged. -->\n    <meta http-equiv="Content-Security-Policy" content="${policy}">\n    <meta name="referrer" content="no-referrer">`, "index.html charset");
index = replaceExactly(index, "    <title>Flowchart Maker &amp; Online Diagram Software</title>", "    <title>Схема — Synapse</title>", "index.html title");
index = index.replace(/^\s*<link rel="canonical"[^\n]+\n/m, "").replace(/^\s*<link rel="manifest"[^\n]+\n/m, "");
index = replaceExactly(index, '<link rel="stylesheet" type="text/css" href="styles/grapheditor.css">', '<link rel="stylesheet" type="text/css" href="styles/grapheditor.css">\n    <link rel="stylesheet" href="styles/local-fonts.css">\n    <link rel="stylesheet" href="styles/synapse.css">', "index.html stylesheet");
modified.set("index.html", { bytes: Buffer.from(index), changes: ["Scoped iframe CSP and no-referrer", "Local shell styling/font", "Local document title; disabled public canonical/PWA links"] });

const originalBootstrap = verifiedMember(`${SOURCE_PREFIX}js/bootstrap.js`, join(source, "js/bootstrap.js")).contents.toString();
let bootstrap = replaceExactly(originalBootstrap, "var mxIsElectron = navigator.userAgent != null && navigator.userAgent.toLowerCase().indexOf(' electron/') > -1 && \n                    navigator.userAgent.indexOf(' draw.io/') > -1;", "// Modified for Synapse: always use the browser editor, including inside a native webview.\nvar mxIsElectron = false;\n// The extracted package does not contain the source-development loader tree.\nurlParams['dev'] = '0';", "bootstrap Electron detection");
bootstrap = replaceExactly(bootstrap, "var supportedDomain = (hostName.substring(hostName.length - 8, hostName.length) === '.draw.io') ||\n            (hostName.substring(hostName.length - 13, hostName.length) === '.diagrams.net');", "// Modified for Synapse: load our local PreConfig/PostConfig on every host.\n        var supportedDomain = false;", "bootstrap supportedDomain");
modified.set("js/bootstrap.js", { bytes: Buffer.from(bootstrap), changes: ["Browser-only runtime and production loader", "Always apply local PreConfig/PostConfig"] });

const preconfig = `/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 * Modified for Synapse: local, pinned browser-embed configuration.
 * Local assets may render user-imported external images/fonts; diagram storage
 * and cloud/export services are owned by Synapse and never selected here.
 */
(function () {
  var base = new URL('../', document.currentScript.src).href;
  window.DRAWIO_PUBLIC_BUILD = true;
  window.EXPORT_URL = null;
  window.DRAWIO_BASE_URL = base.replace(/\\/$/, '');
  window.DRAWIO_SERVER_URL = base;
  window.DRAWIO_VIEWER_URL = base + 'js/viewer-static.min.js';
  window.DRAWIO_LIGHTBOX_URL = base + 'index.html';
  window.DRAW_MATH_URL = base + 'math4/es5';
  window.DRAWIO_CONFIG = null;
  urlParams['embed'] = '1';
  urlParams['proto'] = 'json';
  urlParams['offline'] = '1';
  urlParams['stealth'] = '1';
  urlParams['local'] = '1';
  urlParams['lockdown'] = '1';
  urlParams['plugins'] = '0';
  urlParams['pwa'] = '0';
  urlParams['sync'] = 'manual';
  urlParams['embedRT'] = '0';
  urlParams['rt'] = '0';
  urlParams['gapi'] = '0';
  urlParams['picker'] = '0';
  urlParams['db'] = '0';
  urlParams['od'] = '0';
  urlParams['gh'] = '0';
  urlParams['gl'] = '0';
  urlParams['tr'] = '0';
  urlParams['ms365'] = '0';
  urlParams['suppressNewWindows'] = '1';
  if (urlParams['saveAndExit'] == null) urlParams['saveAndExit'] = '0';
})();
`;
modified.set("js/PreConfig.js", { bytes: Buffer.from(preconfig), changes: ["Local resource paths before editor initialization", "Embedded/offline/private feature gates", "Disabled cloud services, plugins, service worker and public export server"] });
const originalPostconfig = verifiedMember(`${SOURCE_PREFIX}js/PostConfig.js`, join(source, "js/PostConfig.js")).contents.toString();
let postconfig = `${originalPostconfig}\n// Modified for Synapse: host owns persistence, navigation and service lifecycle.\nEditor.enableServiceWorker = false;\nEditor.enableRealtime = false;\nEditor.enableRealtimeCache = false;\nEditor.enableAi = false;\nEditor.enableExportUrl = false;\nEditor.suppressNewWindows = true;\nEditor.popupsAllowed = false;\nmxStencilRegistry.allowEval = false;\nEditor.sketchFontSource = new URL('../styles/local-fonts.css', document.currentScript.src).href;\n`;
postconfig += "\n// Keep migration recovery metadata out of the user's shape-properties form.\n// Rows stay in the dialog/model, so Apply retains their original values.\nvar SynapseOriginalEditDataDialog = EditDataDialog;\nEditDataDialog = function () {\n  SynapseOriginalEditDataDialog.apply(this, arguments);\n  var reserved = ['synapseLegacyData','synapseLegacyId','synapseLegacyType','synapseLegacySnapshot','synapseCamera'];\n  this.container.querySelectorAll('.geDialogFormRow').forEach(function (row) {\n    var label = row.querySelector('.geDialogFormLabel');\n    if (label && reserved.indexOf(label.textContent.trim().replace(/:$/, '')) !== -1) row.style.display = 'none';\n  });\n};\nObject.setPrototypeOf(EditDataDialog, SynapseOriginalEditDataDialog);\nEditDataDialog.prototype = SynapseOriginalEditDataDialog.prototype;\n";
postconfig += "\n// Recovery attributes stay in the model but never crowd shape tooltips.\nGraph.prototype.builtInProperties = Graph.prototype.builtInProperties.concat(['synapseLegacyData','synapseLegacyId','synapseLegacyType','synapseLegacySnapshot','synapseCamera']);\n";
modified.set("js/PostConfig.js", { bytes: Buffer.from(postconfig), changes: ["Preserved upstream icon-service disablement", "Disabled app-owned network/navigation runtime features", "Local sketch font source"] });

// Metadata alone is changed. Compressed raster pixels, color profiles and all
// other upstream PNG chunks remain byte-identical. The key is readable by the
// Impeccable provenance tool; unsupported raster formats receive its sidecar shape.
let crcTable;
function crc32(bytes) {
  crcTable ||= Array.from({ length: 256 }, (_, i) => {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngWithOrigin(input, origin) {
  if (!input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Expected PNG signature");
  let offset = 8;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    if (input.subarray(offset + 4, offset + 8).toString() === "IEND") {
      const payload = Buffer.from(`impeccable:prompt\0${origin}`, "latin1");
      const chunk = Buffer.alloc(payload.length + 12);
      chunk.writeUInt32BE(payload.length, 0);
      chunk.write("tEXt", 4);
      payload.copy(chunk, 8);
      chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
      return Buffer.concat([input.subarray(0, offset), chunk, input.subarray(offset)]);
    }
    offset += length + 12;
  }
  throw new Error("PNG has no IEND chunk");
}

for (const path of walk(source)) {
  const name = relative(source, path).split(sep).join("/");
  const member = `${SOURCE_PREFIX}${name}`;
  const { contents: upstream, record } = verifiedMember(member, path);
  if (skip.has(name)) {
    exclusions.push({ member, sha256: record.sha256, reason: skip.get(name) });
    continue;
  }
  const raster = [".png", ".gif", ".ico"].includes(extname(name).toLowerCase());
  const origin = raster ? `Origin: draw.io Desktop ${VERSION}; repository ${REPOSITORY_URL}; ASAR SHA-256 ${ASAR_SHA256}; member ${member}; upstream SHA-256 ${record.sha256}; raster pixels unchanged.` : null;
  let output = modified.get(name)?.bytes || upstream;
  if (extname(name).toLowerCase() === ".png") output = pngWithOrigin(upstream, origin);
  publish(name, output, {
    upstream: { repository: REPOSITORY_URL, member, sha256: record.sha256, bytes: record.size, asarOffset: record.asar_file_offset },
    modifications: modified.get(name)?.changes || (extname(name).toLowerCase() === ".png" ? ["Added origin tEXt metadata; upstream image chunks unchanged"] : []),
    ...(raster ? { rasterProvenance: { origin, storage: extname(name).toLowerCase() === ".png" ? "PNG tEXt impeccable:prompt" : `${name}.json sidecar; source raster bytes unchanged` } } : {}),
  });
  if (raster && extname(name).toLowerCase() !== ".png") publish(`${name}.json`, json({ prompt: origin }), { generatedBy: "Synapse vendor script", modifications: ["Provenance sidecar for format without supported embedded text metadata"] });
}

const drawioRoot = resolve(source, "../../..");
const packageRoot = dirname(drawioRoot);
for (const [member, sourcePath, name] of [
  ["drawio/LICENSE", join(drawioRoot, "LICENSE"), "LICENSE"],
  ["drawio/README.md", join(drawioRoot, "README.md"), "UPSTREAM-README.md"],
  ["LICENSE", join(packageRoot, "LICENSE"), "licenses/drawio-desktop-GPL-3.0-only.txt"],
]) {
  const { contents, record } = verifiedMember(member, sourcePath);
  publish(name, contents, { upstream: { repository: member.startsWith("drawio/") ? REPOSITORY_URL : "https://github.com/jgraph/drawio-desktop", member, sha256: record.sha256, bytes: record.size, asarOffset: record.asar_file_offset }, modifications: [] });
}

publish("styles/local-fonts.css", Buffer.from(`/* Synapse local font registration. The font itself is the unmodified upstream asset. */\n@font-face { font-family: 'Architects Daughter'; src: url('fonts/ArchitectsDaughter-Regular.ttf') format('truetype'); font-style: normal; font-weight: 400; font-display: swap; }\n`), { generatedBy: "Synapse vendor script" });
publish("styles/synapse.css", Buffer.from(`/* Synapse iframe chrome only. Diagram colors and the surrounding app are untouched. */\n:root {\n  --dark-color: #0e0e10;\n  --ge-dark-panel-color: #16161b;\n  --dark-toolbar-color: #16161b;\n  --dark-dialog-color: #16161b;\n  --dark-header-color: #16161b;\n  --dark-field-color: #0e0e10;\n  --dark-card-color: #16161b;\n  --dark-border-color: #303039;\n  --dark-field-border-color: #303039;\n  --dark-strong-border-color: #484853;\n  --dark-text-color: #d4d4d8;\n  --dark-strong-text-color: #f4f4f5;\n  --dark-secondary-text-color: #a0a0ac;\n  --dark-faint-text-color: #9a9aa6;\n  --dark-accent-text-color: #818cf8;\n}\n.geEditor { font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }\n.geEditor input, .geEditor textarea, .geEditor select { caret-color: var(--dark-accent-text-color); }\n.geEditor :focus-visible { outline: 2px solid var(--dark-accent-text-color); outline-offset: 2px; }\n.geEditor ::selection { background: color-mix(in srgb, var(--dark-accent-text-color) 40%, transparent); color: var(--dark-strong-text-color); }\n@media (prefers-reduced-motion: reduce) { .geSplashLogo { animation: none; } }\n`), { generatedBy: "Synapse vendor script", modifications: ["Scoped existing Synapse dark semantic tokens; host customCss may override for AnuPpuccin"] });

const viewerPrefix = `/**
 * Synapse local wrapper around the official draw.io ${VERSION} viewer.
 * Upstream bytes are retained below without changes; local initialization and
 * compatibility for legacy compressed-div HTML are authored by Synapse.
 */
(function () {
  var script = document.currentScript;
  var base = window.SYNAPSE_DRAWIO_ASSET_BASE || (script && script.src ? new URL('../', script.src).href : new URL('./drawio/', window.location.href).href);
  if (base.charAt(base.length - 1) !== '/') base += '/';
  window.urlParams = Object.assign({}, window.urlParams, {offline: '1', local: '1', stealth: '1', lockdown: '1', pwa: '0', plugins: '0', gapi: '0', db: '0', od: '0', gh: '0', gl: '0', tr: '0', ms365: '0'});
  window.DRAWIO_BASE_URL = base.replace(/\\/$/, '');
  window.DRAWIO_SERVER_URL = base;
  window.DRAWIO_LIGHTBOX_URL = base + 'index.html';
  window.DRAWIO_VIEWER_URL = base + 'js/viewer-static.min.js';
  window.EXPORT_URL = null;
  window.PROXY_URL = base + 'proxy';
  window.STYLE_PATH = base + 'styles';
  window.SHAPES_PATH = base + 'shapes';
  window.STENCIL_PATH = base + 'stencils';
  window.DRAW_MATH_URL = base + 'math4/es5';
  window.GRAPH_IMAGE_PATH = base + 'img';
  window.mxImageBasePath = base + 'mxgraph/images';
  window.mxBasePath = base + 'mxgraph/';
  window.mxLoadStylesheets = false;
  var previousHook = window.onDrawioViewerLoad;
  function render() {
    var elements = document.getElementsByClassName('mxgraph');
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (!element.hasAttribute('data-mxgraph')) {
        var child = element.getElementsByTagName('div')[0];
        if (!child) continue;
        try {
          var payload = (child.textContent || '').trim();
          var xml = payload.charAt(0) === '<' ? payload : payload.charAt(0) === '%' ? decodeURIComponent(payload) : Graph.decompress(payload);
          if (!xml) continue;
          var root = mxUtils.parseXml(xml).documentElement;
          var config = {xml: xml, toolbar: 'pages zoom layers lightbox', nav: 1, resize: 0};
          ['pan', 'zoom', 'resize', 'fit', 'border', 'links', 'edit'].forEach(function (key) {
            var value = root.getAttribute(key);
            if (value != null && value !== '') config[key] = value;
          });
          element.setAttribute('data-mxgraph', JSON.stringify(config));
        } catch (error) {
          element.textContent = 'Не удалось прочитать встроенную схему.';
          if (window.console) console.error(error);
        }
      }
    }
    GraphViewer.processElements();
  }
  window.SYNAPSE_DRAWIO_RENDER_VIEWERS = render;
  window.onDrawioViewerLoad = function () {
    Editor.enableServiceWorker = false;
    Editor.enableRealtime = false;
    Editor.enableRealtimeCache = false;
    Editor.enableAi = false;
    mxStencilRegistry.allowEval = false;
    GraphViewer.prototype.editBlankUrl = base + 'index.html';
    if (previousHook) previousHook(); else render();
  };
})();
`;
const localViewer = Buffer.concat([Buffer.from(viewerPrefix + VIEWER_BEGIN), upstreamViewer, Buffer.from(VIEWER_END)]);
const viewerSource = {
  repository: REPOSITORY_URL, tag: `v${VERSION}`, tagObject: "ea90828c83b7a9c43208b9e3b9cc62036b518eb7",
  commit: VIEWER_COMMIT, gitBlobSha: VIEWER_BLOB_SHA,
  member: "src/main/webapp/js/viewer-static.min.js",
  url: `https://raw.githubusercontent.com/jgraph/drawio/${VIEWER_COMMIT}/src/main/webapp/js/viewer-static.min.js`,
  sha256: VIEWER_SHA256, bytes: upstreamViewer.length,
  verification: "Official exact-tag commit resolved via GitHub API; SHA-256 and Git blob SHA matched. This is an additional official source, not an ASAR member.",
};
publish("js/viewer-static.min.js", localViewer, { upstream: viewerSource, modifications: ["Prepended local resource/privacy globals and legacy compressed-div compatibility", "Official viewer byte range between explicit markers is unchanged"] });
publish("js/embed-static.min.js", Buffer.from(`/** Synapse compatibility entry point. The official v32.4.1 embed-static.min.js path returns HTTP 404. */\n(function () {\n  if (window.SYNAPSE_DRAWIO_RENDER_VIEWERS && window.GraphViewer) { window.SYNAPSE_DRAWIO_RENDER_VIEWERS(); return; }\n  var current = document.currentScript;\n  var script = document.createElement('script');\n  script.src = current && current.src ? new URL('viewer-static.min.js', current.src).href : new URL('js/viewer-static.min.js', window.SYNAPSE_DRAWIO_ASSET_BASE || new URL('./drawio/', window.location.href).href).href;\n  document.head.appendChild(script);\n})();\n`), { generatedBy: "Synapse vendor script", modifications: ["Legacy HTML alias to the one pinned viewer runtime; no duplicated 4 MB engine"], dependencies: ["js/viewer-static.min.js"], upstreamLookup: { url: `https://raw.githubusercontent.com/jgraph/drawio/v${VERSION}/src/main/webapp/js/embed-static.min.js`, httpStatus: 404 } });
publish("viewer-origin.json", json(viewerSource), { generatedBy: "Synapse vendor script" });
publish("NOTICE", Buffer.from(`Synapse local draw.io browser editor\n\nUpstream: draw.io Desktop ${VERSION}, ${REPOSITORY_URL} and https://github.com/jgraph/drawio-desktop.\nExact app.asar SHA-256: ${ASAR_SHA256}.\nCopyright (c) JGraph Holdings Ltd and draw.io AG; original inline copyright notices are retained.\n\nThe nested drawio source is distributed with its Apache License 2.0 (LICENSE).\nThe source desktop distribution declares GPL-3.0-only; its license is retained in licenses/drawio-desktop-GPL-3.0-only.txt.\nTemplates carry templates/LICENSE (CC BY 4.0). Icon/stencil assets retain their respective img/LICENSE, images notices and stencils/LICENSE, including the upstream Atlassian ecosystem restriction and its end-user output exception.\nlibavoid-js retains its LGPL 2.1 license and README in js/libavoid-js. Other libraries retain the notices included in their shipped files.\n\nOnly browser bootstrap, local configuration and iframe chrome are adapted. Electron adapters and cloud authentication callbacks are excluded. Raster PNGs receive origin metadata without changing pixel streams; GIF/ICO origins are retained in adjacent JSON sidecars. Every copied member has its upstream and published checksums in vendor-manifest.json.\nThe HTML viewer is an additional official v${VERSION} source from commit ${VIEWER_COMMIT}, not a member of the ASAR. Its SHA-256 is ${VIEWER_SHA256}; its Git blob SHA and origin are retained in viewer-origin.json. Its unchanged bytes are marked inside js/viewer-static.min.js, preceded by a local resource/legacy-HTML wrapper. The official embed-static path is absent at this tag; js/embed-static.min.js is an authored alias to the same viewer.\nNo upstream instructions were executed. This artifact uses Synapse's postMessage host for persistence and exports; it does not use a public export or storage server. External media requested by a user-imported diagram may still be fetched to render or embed that media.\n\nRebuild from the verified extraction (the existing retained viewer is reused offline):\nnode scripts/vendor-drawio.mjs --source <drawio/src/main/webapp> --manifest <package-manifest.json>\nFor a fresh destination, also supply --viewer <official viewer-static.min.js> from the exact pinned commit above. Its expected checksum is enforced.\nVerify the published copy:\nnode scripts/vendor-drawio.mjs --check\n`), { generatedBy: "Synapse vendor script" });

const contract = {
  version: VERSION,
  editorUrl: "/drawio/index.html?embed=1&proto=json&configure=1&lang=ru&dark=1&noSaveBtn=1&noExitBtn=1&spin=1&keepmodified=1&saveAndExit=0",
  defaultHostConfig: { compressXml: false, enableExportUrl: false, enableNativeClipboard: true, enableCustomLibraries: true, fitDiagramOnLoad: true, preserveViewState: true, suppressNewWindows: true, sidebarWidth: 200, darkColor: "#0e0e10", defaultDarkPageBackgroundColor: "#0e0e10" },
  handshake: ["editor event:configure -> host action:configure config", "editor event:init -> host action:load xml/autosave=1/exportProtocol=1", "editor event:load -> ready"],
  wireEncoding: "JSON.stringify, parsed as event.data in both directions",
  validateIncoming: "event.source must equal the chosen iframe.contentWindow, and event.origin must equal new URL(iframe.src).origin after actual runtime verification; do not hard-code a development origin or permit remote navigation",
  correlation: "Add requestId to each request; export responses echo the complete request in response.message (response.message.requestId)",
  exports: {
    xml: { request: { action: "export", format: "xml" }, response: "event:export format:xml xml=<all mxfile pages>" },
    svg: { request: { action: "export", format: "xmlsvg", asText: true, embedImages: true, embedFonts: true, border: 16 }, response: "event:export format:svg data=<SVG text> xml=<whole source file>", pageScope: "Active graph only; pageId/currentPage are not honored by SVG branch. Send a single-page mxfile as xml, or switch the editor page through an explicit host adapter." },
    png: { request: { action: "export", format: "xmlpng", currentPage: true, scale: 2, border: 16, embedImages: true }, response: "event:export format:xmlpng data=<data:image/png;base64> xml=<whole source file>", pageScope: "pageId selects a page; currentPage=true selects active page; otherwise first page. Embedded XML retains all supplied pages. Test viewState/background fidelity for non-active page; one-page XML gives a stable host export boundary." },
    multiPage: "XML retains all pages. For separate SVG/PNG pages use serialized one-page XML snapshots and separate requestIds, restoring the live document after export; for PDF the host owns pagination. No action:export PDF branch is present.",
    html: {"request": {"action": "export", "format": "xml", "requestId": "portable-html-1"}, "response": "event:export format:xml xml=<all mxfile pages>, message=<original request>; host builds the portable viewer document from this XML.", "hostBuild": "Create a .mxgraph element with data-mxgraph JSON containing xml, nav:true, resize:true, toolbar:\"pages zoom layers lightbox\" and desired initial page. Inline the complete published js/viewer-static.min.js as a classic script. Do not keep core html2 meta-refresh/editor logo link.", "viewer": "js/viewer-static.min.js contains the pinned official viewer plus a local bootstrap and legacy compressed-div compatibility. js/embed-static.min.js is its small legacy alias.", "coreHtml2": {"request": {"action": "export", "format": "html2"}, "response": "event:export format:html2 data=<HTML with editor meta-refresh in EmbedFile mode> xml=<whole mxfile>", "portable": false, "cause": "Export handler calls getFileData(...html=true). createFileData assigns its redirect URL to window.location.href for EmbedFile MODE_EMBED; getHtml2 emits meta-refresh and logo link instead of viewer script when redirect URL is non-null.", "options": "No JSON export option to suppress this redirect is read by the shipped handler. allPages is not read by either HTML branch."}, "legacySinglePage": {"request": {"action": "export", "format": "html"}, "requires": "Editor URL pages=0 AND this.pages absent or length <= 1. For >1 pages, html takes the same redirected html2 branch.", "response": "event:export format:html data=<legacy compressed-div HTML with local embed-static script> xml=<active mxGraphModel>", "scope": "Single active graph only; not the portable multi-page export contract."}, "standalone": "Host owns portable document assembly and embedded images/fonts/math resources. Private Tauri or development URLs are not portable dependencies.", "evidence": {"member": "drawio/src/main/webapp/js/app.min.js", "sha256": "6b459480290f96a8c345ee636523a86e6de6ef5ffb62532cfc04a5b4a896b7e0", "analystReadableSource": "readable/app.js (formatting aid linked to the exact minified member)", "ranges": {"exportHtmlBranch": [105532, 105541], "getFileDataForwarding": [96937, 96958], "fileModeRedirectDecision": [96792, 96799], "getHtml2Output": [96982, 96993], "legacyGetHtmlOutput": [96961, 96980]}, "runtimeConfirmation": "Synthetic fixture-export.html contains a local editor meta-refresh and no viewer script, matching this EmbedFile path.", "viewer": {"officialSource": "src/main/webapp/js/viewer-static.min.js", "commit": "9034053fba80a435e27d68d374bc564b83917ae9", "sha256": "bc7586cb62eec98018c13b78619078d3a7179cc7bfc711c566dda19527520a30", "lineRanges": {"toolbarAndInitialPage": [5432, 5435], "diagramCollectionAndPageChange": [5442, 5444], "navFolding": [5445, 5445], "pagesToolbarControls": [5477, 5479]}, "basis": "Exact official source before local wrapper, classic-script static reads only."}}, "dataMxgraphExample": {"xml": "<mxfile>...all diagram pages...</mxfile>", "toolbar": "pages zoom layers lightbox", "page": 0, "nav": true, "resize": true}, "viewerKeys": {"toolbar": "Space-separated item names. The pages token creates previous/next controls and an n / total counter, visible only when diagram count > 1. zoom/layers/lightbox add those tools.", "page": "Zero-based initial page index; parsed with parseInt(config.page) || 0.", "pageId": "Optional diagram ID read by the viewer initialization; page remains the simple initial index contract.", "nav": "Controls editor folding/navigation behavior via urlParams.nav; it is not the page-switcher flag.", "resize": "Controls viewer/container sizing; it is not the page-switcher flag.", "pages_or_pageSwitcher": "No graphConfig.pages or pageSwitcher option is read by this exact viewer. Use the pages token in toolbar and retain all <diagram> nodes in xml."}},
  },
  runtimeLimits: ["PNG depends on the browser foreignObject-to-canvas probe. With no remote export server a failed probe yields the upstream blank image fallback; host should detect failure rather than claim success.", "Passing export.xml replaces the live editor file data. Run host exports serially in a dedicated export iframe, or snapshot and restore the live document; do not overwrite accepted edits.", "save clears modified immediately unless keepmodified=1; durable-write acknowledgment belongs to host and may set status.modified=false.", "Standalone HTML must inline its viewer dependency and any required media/fonts/math resource; a Tauri-hosted resource URL cannot be assumed accessible outside the application.", "Core action:export html2 in EmbedFile mode yields an editor-redirect HTML, not a portable viewer. Portable multi-page HTML must be assembled by the host from XML; there is no noRedirect JSON option in the shipped export handler."],
};
publish("embed-contract.json", json(contract), { generatedBy: "Synapse vendor script", modifications: ["Static host contract derived from exact shipped editor bodies; browser/native behavior must be tested by host"] });
files.sort((a, b) => a.path.localeCompare(b.path, "en"));
const manifest = {
  schemaVersion: 1,
  upstream: { name: "draw.io Desktop browser editor", version: VERSION, repository: REPOSITORY_URL, desktopRepository: "https://github.com/jgraph/drawio-desktop", asarSha256: ASAR_SHA256, sourcePrefix: SOURCE_PREFIX, sourceVerified: "Every copied source byte was checked against package-manifest.json before publishing" },
  generation: { script: "scripts/vendor-drawio.mjs", deterministic: true, upstreamCodeExecuted: false, packageDownloadRequired: false, startup: "Loaded only when the host mounts its lazy editor iframe" },
  exclusions,
  hostOwnedExtrasPreserved: [...protectedFiles],
  files,
};
const manifestPath = join(out, MANIFEST_NAME);
const manifestBytes = json(manifest);
if (!existsSync(manifestPath) || !readFileSync(manifestPath).equals(manifestBytes)) writeFileSync(manifestPath, manifestBytes);
console.log(JSON.stringify({ vendored: true, version: VERSION, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), exclusions: exclusions.length, manifest: relative(scriptRoot, manifestPath).split(sep).join("/") }));
