/** Host-side file dialogs and lossless draw.io carriers. Editor parsing stays in the iframe. */
import { invoke, isTauri } from "@tauri-apps/api/core";

export type DrawioExportFormat = "png" | "svg" | "xml" | "drawio" | "pdf" | "html" | "json" | "jpeg" | "jpg" | "csv";
export type DrawioSvgPage = { svg: string; width: number; height: number };
export type ImportedDrawioFile = { xml: string; name: string };

const MIME: Record<DrawioExportFormat, string> = {
  png: "image/png", svg: "image/svg+xml", xml: "application/vnd.jgraph.mxfile", drawio: "application/vnd.jgraph.mxfile", pdf: "application/pdf",
  html: "text/html", json: "application/json", jpeg: "image/jpeg", jpg: "image/jpeg", csv: "text/csv",
};
export function isDrawioExportFormat(value: unknown): value is DrawioExportFormat {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MIME, value);
}

function checkExportFormat(format: DrawioExportFormat): void {
  if (!isDrawioExportFormat(format)) throw new Error("Этот формат экспорта не поддерживается.");
}

const PNG_HEADER = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const UTF8 = new TextEncoder();
const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const startsWithBytes = (bytes: Uint8Array, prefix: readonly number[]) =>
  prefix.every((byte, index) => bytes[index] === byte);

function fromBase64(value: string): Uint8Array {
  const base64 = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
    throw new Error("Некорректные данные экспортированного файла.");
  }
  try { return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)); }
  catch { throw new Error("Некорректные данные экспортированного файла."); }
}

function fromPercentEncoded(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length;) {
    if (value[index] === "%") {
      const hex = value.slice(index + 1, index + 3);
      if (!/^[\da-f]{2}$/i.test(hex)) throw new Error("Некорректный data URL.");
      bytes.push(parseInt(hex, 16)); index += 3;
    } else {
      const char = String.fromCodePoint(value.codePointAt(index)!);
      bytes.push(...UTF8.encode(char)); index += char.length;
    }
  }
  return new Uint8Array(bytes);
}

/** Decode draw.io's raw XML/SVG, base64 and data-URI messages without corrupting UTF-8. */
export function decodeDrawioExport(data: string, format: DrawioExportFormat): Uint8Array {
  checkExportFormat(format);
  if (typeof data !== "string" || !data.trim()) throw new Error("Экспорт вернул пустой файл.");
  let bytes: Uint8Array;
  const value = data.trim();
  if (/^data:/i.test(value)) {
    const comma = value.indexOf(",");
    if (comma < 0) throw new Error("Некорректный data URL.");
    const header = value.slice(5, comma), mime = header.split(";")[0].toLowerCase();
    const allowed = format === "xml" || format === "drawio" ? [MIME.xml, "text/xml", "application/xml", "text/plain"] : [MIME[format]];
    if (!allowed.includes(mime)) throw new Error("Формат экспортированных данных не соответствует файлу.");
    bytes = /(?:^|;)base64(?:;|$)/i.test(header)
      ? fromBase64(value.slice(comma + 1)) : fromPercentEncoded(value.slice(comma + 1));
  } else if ((format === "xml" || format === "drawio" || format === "svg" || format === "html") && /^(?:\uFEFF)?\s*</.test(data)) {
    bytes = UTF8.encode(data.replace(/^\uFEFF/, ""));
  } else if ((format === "xml" || format === "drawio" || format === "svg" || format === "html") && /^%3c/i.test(value)) {
    bytes = fromPercentEncoded(value);
  } else if (format === "csv" || (format === "json" && (value[0] === "{" || value[0] === "["))) {
    bytes = UTF8.encode(data);
  } else if (format === "pdf" && value.startsWith("%PDF-")) {
    if ([...data].some((char) => char.charCodeAt(0) > 255)) throw new Error("Некорректные PDF-байты.");
    bytes = Uint8Array.from(data, (char) => char.charCodeAt(0));
  } else {
    bytes = fromBase64(value);
  }
  if (format === "png" && !startsWithBytes(bytes, PNG_HEADER)) throw new Error("Экспорт не содержит PNG.");
  if (format === "pdf" && !startsWithBytes(bytes, [37, 80, 68, 70, 45])) throw new Error("Экспорт не содержит PDF.");
  if (format === "svg" && parseXml(text(bytes)).documentElement.localName !== "svg") throw new Error("Экспорт не содержит SVG.");
  if ((format === "jpeg" || format === "jpg") && !startsWithBytes(bytes, [255, 216, 255])) throw new Error("Экспорт не содержит JPEG.");
  if (format === "json") JSON.parse(text(bytes));
  if (format === "xml" || format === "drawio") assertDrawioXml(text(bytes));
  return bytes;
}

/** Inline the pinned viewer without interpreting dollar tokens in its JavaScript source. */
export function prepareDrawioHtml(data: string, viewerSource: string): string {
  const body = text(decodeDrawioExport(data, "html"));
  const viewer = viewerSource.replace(/<\/script/gi, (closing) => "<\\/" + closing.slice(2));
  return body.replace(
    /<script\b[^>]*src=["'][^"']*(?:viewer|embed)-static\.min\.js[^"']*["'][^>]*>\s*<\/script>/gi,
    () => `<script>${viewer}</script>`,
  );
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

/** A standalone viewer built from the full model, independent of an embed-mode editor URL. */
export function createDrawioHtml(xml: string, name: string, viewerSource: string): string {
  const model = assertDrawioXml(xml);
  const config = { xml: model, toolbar: "pages zoom layers lightbox", "toolbar-nohide": 1, page: 0, nav: true, resize: true };
  const html = '<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8"/>\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n' +
    '<title>' + escapeHtml(name.trim() || "Холст") + '</title>\n</head>\n<body>\n' +
    '<div class="mxgraph" style="max-width:100%;border:1px solid transparent;" data-mxgraph="' +
    escapeHtml(JSON.stringify(config)) + '"></div>\n' +
    '<script src="viewer-static.min.js"></script>\n</body>\n</html>\n';
  return prepareDrawioHtml(html, viewerSource);
}

export function drawioExportFilename(name: string, format: DrawioExportFormat): string {
  checkExportFormat(format);
  let base = (name.split(/[\\/]/).pop() || "").trim().replace(/[\x00-\x1f<>:"|?*]/g, "_").replace(/[. ]+$/g, "");
  if (!base || /^\.+$/.test(base)) base = "Холст";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = "drawing-" + base;
  const extensions = format === "xml" || format === "drawio" ? ["drawio", "xml"] : [format];
  if (extensions.some((extension) => base.toLowerCase().endsWith("." + extension))) {
    const dot = base.lastIndexOf(".");
    return base.slice(0, dot).slice(0, 175) + base.slice(dot);
  }
  base = base.replace(/(?:\.(?:drawio|xml|svg|png|pdf|html|json|jpeg|jpg|csv))+$/i, "").slice(0, 165) || "Холст";
  return base + "." + extensions[0];
}

function parseXml(value: string): Document {
  const doc = new DOMParser().parseFromString(value.replace(/^\uFEFF/, ""), "application/xml");
  if (!doc.documentElement || doc.getElementsByTagName("parsererror").length) throw new Error("Файл содержит некорректный XML.");
  return doc;
}

export function assertDrawioXml(value: string): string {
  const xml = value.replace(/^\uFEFF/, "").trim();
  const root = parseXml(xml).documentElement;
  if (root.localName === "mxfile") {
    if (!root.getElementsByTagName("diagram").length) throw new Error("В файле нет страниц draw.io.");
  } else if (root.localName !== "mxGraphModel" && root.localName !== "diagram") {
    throw new Error("Файл не содержит диаграмму draw.io.");
  }
  return xml;
}

function embeddedXml(value: string): string {
  let xml = value.trim();
  if (!xml.startsWith("<") && !xml.startsWith("%")) xml = text(fromBase64(xml));
  for (let pass = 0; pass < 2 && xml.startsWith("%"); pass++) {
    try { xml = decodeURIComponent(xml); } catch { throw new Error("Некорректная встроенная модель draw.io."); }
  }
  return assertDrawioXml(xml);
}

export function pngHasDrawioModel(bytes: Uint8Array): boolean {
  if (!startsWithBytes(bytes, PNG_HEADER)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT" || type === "IEND") return false;
    if (type === "tEXt" || type === "zTXt") {
      const payload = bytes.subarray(offset + 8, offset + 8 + length);
      const nul = payload.indexOf(0);
      if (nul > 0 && nul + (type === "zTXt" ? 2 : 1) < payload.length) {
        const keyword = String.fromCharCode(...payload.subarray(0, nul));
        if (keyword === "mxfile" || keyword === "mxGraphModel") return true;
      }
    }
    offset = end;
  }
  return false;
}

// Upstream Editor.blankImage (draw.io app.min.js; readable source line 89578).
// Its embed export handler substitutes this raster when Canvas/export service fails.
// Compare raster chunks, since xmlpng inserts an otherwise useful model tEXt chunk.
const DRAWIO_BLANK_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";
type PngRaster = { header: Uint8Array; imageParts: Uint8Array[]; imageLength: number; otherChunks: boolean };

function pngRaster(bytes: Uint8Array): PngRaster {
  const failed = () => new Error("PNG-экспорт повреждён. Выберите экспорт SVG.");
  if (!startsWithBytes(bytes, PNG_HEADER) || bytes.length < 33) throw failed();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, header: Uint8Array | undefined, imageLength = 0;
  let ended = false, otherChunks = false;
  const imageParts: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) throw failed();
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (!header) {
      if (kind !== "IHDR" || length !== 13 || !view.getUint32(offset + 8) || !view.getUint32(offset + 12)) throw failed();
      header = payload;
    } else if (kind === "IHDR") throw failed();
    else if (kind === "IDAT") { imageParts.push(payload); imageLength += length; }
    else if (kind === "IEND") {
      if (length !== 0) throw failed();
      ended = true; break;
    } else if (!["tEXt", "zTXt", "iTXt", "pHYs"].includes(kind)) otherChunks = true;
    offset = end;
  }
  if (!header || !ended || !imageLength) throw failed();
  return { header, imageParts, imageLength, otherChunks };
}

/** Reject the exact upstream failed-export raster, never every image measuring 1×1. */
export function assertRenderedDrawioPng(bytes: Uint8Array): void {
  const raster = pngRaster(bytes), blank = pngRaster(fromBase64(DRAWIO_BLANK_PNG));
  const headerMatches = raster.header.every((byte, index) => byte === blank.header[index]);
  if (!headerMatches || raster.otherChunks || raster.imageLength !== blank.imageLength) return;
  let index = 0;
  const blankPixels = blank.imageParts[0];
  for (const part of raster.imageParts) for (const byte of part) if (byte !== blankPixels[index++]) return;
  throw new Error("PNG-экспорт не был отрисован. Выберите экспорт SVG — он сохраняет диаграмму без потери качества.");
}

function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(chunks.join(""));
}

type PdfPage = {
  getWidth(): number; getHeight(): number; setSize(width: number, height: number): void;
  scaleContent(x: number, y: number): void; scaleAnnotations(x: number, y: number): void;
};
type PdfDocument = {
  getSubject(): string | undefined;
  getAttachments(): Array<{ name: string; data: Uint8Array; mimeType?: string }>;
  getPageCount(): number; copyPages(doc: PdfDocument, pages: number[]): Promise<PdfPage[]>;
  addPage(page: PdfPage): void; setTitle(title: string): void; setCreator(creator: string): void;
  setSubject(subject: string): void;
  attach(bytes: Uint8Array, name: string, options: { mimeType: string; description: string }): Promise<void>;
  save(options: { useObjectStreams: boolean }): Promise<Uint8Array>;
};
type PdfLibrary = { PDFDocument: { create(): Promise<PdfDocument>; load(bytes: Uint8Array): Promise<PdfDocument> } };
let pdfLibraryPromise: Promise<PdfLibrary> | undefined;

function pdfLibrary(): Promise<PdfLibrary> {
  const existing = (globalThis as typeof globalThis & { PDFLib?: PdfLibrary }).PDFLib;
  if (existing) return Promise.resolve(existing);
  if (!pdfLibraryPromise) pdfLibraryPromise = new Promise<PdfLibrary>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("drawio/pdf-lib.min.js", document.baseURI).href;
    script.onload = () => {
      const loaded = (globalThis as typeof globalThis & { PDFLib?: PdfLibrary }).PDFLib;
      if (loaded) resolve(loaded); else reject(new Error("Не удалось загрузить PDF-библиотеку."));
    };
    script.onerror = () => { script.remove(); reject(new Error("Не удалось загрузить PDF-библиотеку.")); };
    document.head.appendChild(script);
  }).catch((error: unknown) => { pdfLibraryPromise = undefined; throw error; });
  return pdfLibraryPromise;
}

export async function readDrawioFileData(bytes: Uint8Array, name: string): Promise<ImportedDrawioFile> {
  if (!bytes.length) throw new Error("Выбранный файл пуст.");
  if (bytes.length > MAX_FILE_BYTES) throw new Error("Файл draw.io превышает 100 МБ.");
  if (startsWithBytes(bytes, PNG_HEADER)) {
    if (!pngHasDrawioModel(bytes)) throw new Error("В PNG нет встроенной диаграммы draw.io.");
    // Keep compressed zTXt data intact for the vendored editor's decoder.
    return { xml: "data:image/png;base64," + toBase64(bytes), name };
  }
  if (startsWithBytes(bytes, [37, 80, 68, 70, 45])) {
    const lib = await pdfLibrary(), pdf = await lib.PDFDocument.load(bytes);
    const candidates = [pdf.getSubject(), ...pdf.getAttachments()
      .filter((entry) => /\.(drawio|xml)$/i.test(entry.name) || entry.mimeType === MIME.xml)
      .map((entry) => text(entry.data))];
    for (const candidate of candidates) if (candidate) {
      try { return { xml: embeddedXml(candidate), name }; } catch { /* try the next model carrier */ }
    }
    throw new Error("В PDF нет встроенной диаграммы draw.io.");
  }
  const value = text(bytes), root = parseXml(value).documentElement;
  if (root.localName === "svg") {
    const content = root.getAttribute("content");
    if (!content) throw new Error("В SVG нет встроенной диаграммы draw.io.");
    return { xml: embeddedXml(content), name };
  }
  return { xml: assertDrawioXml(value), name };
}

export async function importDrawioFile(): Promise<ImportedDrawioFile | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ multiple: false, directory: false,
      filters: [{ name: "Диаграммы draw.io", extensions: ["drawio", "xml", "png", "svg", "pdf"] }] });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return null;
    const { readFile } = await import("@tauri-apps/plugin-fs");
    return readDrawioFileData(await readFile(path), path.split(/[\\/]/).pop() || "Холст.drawio");
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".drawio,.xml,.png,.svg,.pdf"; input.style.display = "none";
    const finish = (file: ImportedDrawioFile | null) => { input.remove(); resolve(file); };
    input.addEventListener("cancel", () => finish(null), { once: true });
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { finish(null); return; }
      file.arrayBuffer().then((buffer) => readDrawioFileData(new Uint8Array(buffer), file.name))
        .then(finish, (error: unknown) => { input.remove(); reject(error); });
    };
    document.body.appendChild(input); input.click();
  });
}

async function saveBytes(bytes: Uint8Array, format: DrawioExportFormat, name: string): Promise<void> {
  if (format === "png") assertRenderedDrawioPng(bytes);
  const filename = drawioExportFilename(name, format);
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: filename, filters: [{ name: format === "xml" || format === "drawio" ? "Диаграмма draw.io" : format.toUpperCase(),
      extensions: format === "xml" || format === "drawio" ? ["drawio", "xml"] : [format] }] });
    if (!path) return;
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, bytes); return;
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: MIME[format] }));
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveDrawioExport(data: string, format: DrawioExportFormat, name: string): Promise<void> {
  await saveBytes(decodeDrawioExport(data, format), format, name);
}

export function getDrawioSvgPage(data: string): DrawioSvgPage {
  const svg = text(decodeDrawioExport(data, "svg")), root = parseXml(svg).documentElement;
  const viewBox = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const dimension = (value: string | null) => {
    if (!value || /%/.test(value)) return NaN;
    const match = value.trim().match(/^([\d.]+)(px|pt|in|cm|mm)?$/);
    if (!match) return NaN;
    return Number(match[1]) * ({ px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 }[match[2] || "px"] ?? 1);
  };
  const width = dimension(root.getAttribute("width")), height = dimension(root.getAttribute("height"));
  const page = { svg, width: Number.isFinite(width) ? width : viewBox[2], height: Number.isFinite(height) ? height : viewBox[3] };
  if (!(page.width > 0) || !(page.height > 0) || !Number.isFinite(page.width) || !Number.isFinite(page.height)) {
    throw new Error("В SVG не определён размер страницы.");
  }
  return page;
}

/** Assemble native vector page PDFs and keep the original editable model in two standard carriers. */
export async function assembleDrawioPdf(
  pagePdfs: Array<{ bytes: Uint8Array; width: number; height: number }>, xml: string, name: string,
): Promise<Uint8Array> {
  const model = assertDrawioXml(xml);
  if (!pagePdfs.length) throw new Error("В диаграмме нет страниц для PDF.");
  const lib = await pdfLibrary(), document = await lib.PDFDocument.create();
  for (const input of pagePdfs) {
    const source = await lib.PDFDocument.load(input.bytes);
    if (source.getPageCount() !== 1) throw new Error("Нативный PDF-экспорт вернул неверное число страниц.");
    const [page] = await document.copyPages(source, [0]);
    const width = input.width * 72 / 96, height = input.height * 72 / 96;
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error("Некорректный размер PDF-страницы.");
    const sx = width / page.getWidth(), sy = height / page.getHeight();
    page.scaleContent(sx, sy); page.scaleAnnotations(sx, sy); page.setSize(width, height);
    document.addPage(page);
  }
  document.setTitle(name); document.setCreator("Synapse • draw.io");
  document.setSubject(encodeURIComponent(model));
  await document.attach(UTF8.encode(model), drawioExportFilename(name, "xml"),
    { mimeType: MIME.xml, description: "Editable draw.io diagram" });
  // Direct Info/Subject is readable by draw.io Desktop's PDF recovery wrapper.
  return document.save({ useObjectStreams: false });
}

export async function exportDrawioPdf(pages: DrawioSvgPage[], xml: string, name: string): Promise<void> {
  assertDrawioXml(xml);
  if (!pages.length) throw new Error("В диаграмме нет страниц для PDF.");
  if (!isTauri()) throw new Error("Векторный PDF с редактируемой моделью доступен в приложении Synapse для macOS.");
  const nativePages: Array<{ bytes: Uint8Array; width: number; height: number }> = [];
  for (const page of pages) {
    // Validate SVG and never pass the visible workspace content to the native renderer.
    const checked = getDrawioSvgPage(page.svg);
    if (!Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0 || page.width > 50_000 || page.height > 50_000) {
      throw new Error("Некорректный размер SVG-страницы для PDF.");
    }
    const bytes = await invoke<number[]>("canvas_render_pdf_page", { svg: checked.svg, width: page.width, height: page.height });
    nativePages.push({ bytes: new Uint8Array(bytes), width: page.width, height: page.height });
  }
  await saveBytes(await assembleDrawioPdf(nativePages, xml, name), "pdf", name);
}

