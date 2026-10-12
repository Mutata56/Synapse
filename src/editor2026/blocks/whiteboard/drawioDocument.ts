/** The persisted block prop remains a string; migration never replaces unreadable data. */
export type DrawioDocument = {
  engine: "drawio";
  version: 1;
  xml: string;
  preview?: string;
  /** One recoverable previous document; imports and restores swap this slot. */
  importBackup?: DrawioDocument;
  viewport?: { scale: number; scroll?: { x: number; y: number }; pageId?: string };
  /** Exact original string, including whitespace and unknown legacy fields. */
  legacySnapshot?: string;
};

type RecordValue = Record<string, unknown>;
type Point = { x: number; y: number };
type XmlNode = { name: string; children: XmlNode[]; text: string };
// XML 1.0 names include custom non-Latin user-data properties, not just ASCII labels.
const XML_NAME_START = ":A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const XML_NAME = `[${XML_NAME_START}][${XML_NAME_START}0-9.\\-\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*`;
const OPENING_TAG = new RegExp(`^<(${XML_NAME})`, "u");
const CLOSING_TAG = new RegExp(`^</(${XML_NAME})[ \\t\\r\\n]*>`, "u");
const XML_ATTRIBUTE = new RegExp(`^(${XML_NAME})[ \\t\\r\\n]*=[ \\t\\r\\n]*(["'])`, "u");
const SUPPORTED_SHAPES = new Set(["rect", "ellipse", "arrow", "pen", "text", "db", "action", "process", "decision", "note", "sticky"]);
const SIDES = { top: [0.5, 0], right: [1, 0.5], bottom: [0.5, 1], left: [0, 0.5] } as const;

function fail(message: string): never {
  throw new Error(`Cannot read canvas: ${message}`);
}
function record(value: unknown, description: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${description} must be an object`);
  return value as RecordValue;
}
function finite(value: unknown, description: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${description} must be a finite number`);
  return value;
}
function numberOr(value: unknown, fallback: number, description: string): number {
  return value === undefined ? fallback : finite(value, description);
}
function string(value: unknown, description: string): string {
  if (typeof value !== "string") fail(`${description} must be a string`);
  return value;
}
function optionalString(value: unknown, fallback: string, description: string): string {
  return value === undefined ? fallback : string(value, description);
}
function validXmlCharacter(cp: number): boolean {
  return cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
}
function checkXmlCharacters(value: string): void {
  for (const ch of value) if (!validXmlCharacter(ch.codePointAt(0)!)) fail("a value contains a character that XML cannot represent");
}
function escapeXml(value: string): string {
  checkXmlCharacters(value);
  // XML normalizes literal attribute whitespace. Character references preserve SQL and backups exactly.
  return value.replace(/[&<>"'\t\n\r]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;", "\t": "&#9;", "\n": "&#10;", "\r": "&#13;" })[ch]!);
}
function attrs(values: Record<string, string | number | undefined>): string {
  return Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => {
    if (typeof value === "number" && !Number.isFinite(value)) fail(`${key} cannot be represented as finite XML geometry`);
    return ` ${key}="${escapeXml(String(value))}"`;
  }).join("");
}
function entities(text: string): void {
  for (let offset = text.indexOf("&"); offset !== -1; offset = text.indexOf("&", offset + 1)) {
    const entity = /^&(?:amp|lt|gt|quot|apos|#([0-9]+)|#x([0-9a-fA-F]+));/.exec(text.slice(offset));
    if (!entity) fail("invalid XML entity");
    if (entity[1] || entity[2]) {
      const cp = Number.parseInt(entity[1] || entity[2], entity[1] ? 10 : 16);
      if (!validXmlCharacter(cp)) fail("invalid XML character reference");
    }
    offset += entity[0].length - 1;
  }
}

/** A nonexecuting XML well-formedness/plausibility check, also usable in Node tests. */
function validateXml(xml: string): void {
  if (!xml.trim()) fail("draw.io XML is empty");
  checkXmlCharacters(xml);
  const source = xml.replace(/^\uFEFF/, "");
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let position = 0;
  while (position < source.length) {
    if (source[position] !== "<") {
      const next = source.indexOf("<", position);
      const text = source.slice(position, next < 0 ? source.length : next);
      entities(text);
      if (text.includes("]]>")) fail("invalid XML text");
      if (stack.length) stack[stack.length - 1].text += text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, entity: string) => entity.startsWith("#") ? String.fromCodePoint(parseInt(entity.slice(entity[1] === "x" ? 2 : 1), entity[1] === "x" ? 16 : 10)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[entity]);
      else if (text.trim()) fail("text outside the XML root");
      position = next < 0 ? source.length : next;
      continue;
    }
    if (source.startsWith("<!--", position)) {
      const end = source.indexOf("-->", position + 4);
      if (end < 0 || source.slice(position + 4, end).includes("--") || source[end - 1] === "-") fail("invalid XML comment");
      position = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", position)) {
      const end = source.indexOf("]]>", position + 9);
      if (end < 0 || !stack.length) fail("invalid XML CDATA");
      stack[stack.length - 1].text += source.slice(position + 9, end);
      position = end + 3;
      continue;
    }
    if (source.startsWith("<?", position)) {
      const end = source.indexOf("?>", position + 2);
      const declaration = /^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(["'])1\.0\1(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(["'])[A-Za-z][A-Za-z0-9_.-]*\2)?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(["'])(?:yes|no)\3)?[ \t\r\n]*\?>$/;
      if (end < 0 || !declaration.test(source.slice(position, end + 2)) || root || position !== 0) fail("unsupported XML declaration");
      position = end + 2;
      continue;
    }
    if (source.startsWith("<!", position)) fail("XML declarations and external entities are unsupported");
    const closing = CLOSING_TAG.exec(source.slice(position));
    if (closing) {
      if (!stack.length || stack.pop()!.name !== closing[1]) fail("mismatched XML tags");
      position += closing[0].length;
      continue;
    }
    const opening = OPENING_TAG.exec(source.slice(position));
    if (!opening) fail("invalid XML tag");
    position += opening[0].length;
    const attributeNames = new Set<string>();
    let selfClosing = false;
    let tagClosed = false;
    while (position < source.length) {
      const whitespace = /^[ \t\r\n]*/.exec(source.slice(position))![0];
      position += whitespace.length;
      if (source.startsWith("/>", position)) { selfClosing = true; tagClosed = true; position += 2; break; }
      if (source[position] === ">") { tagClosed = true; position++; break; }
      if (!whitespace.length) fail("XML attributes need whitespace");
      const attribute = XML_ATTRIBUTE.exec(source.slice(position));
      if (!attribute || attributeNames.has(attribute[1])) fail("invalid or repeated XML attribute");
      attributeNames.add(attribute[1]);
      position += attribute[0].length;
      const end = source.indexOf(attribute[2], position);
      if (end < 0) fail("unterminated XML attribute");
      const value = source.slice(position, end);
      if (value.includes("<")) fail("invalid XML attribute value");
      entities(value);
      position = end + 1;
    }
    if (!tagClosed) fail("unterminated XML tag");
    const node: XmlNode = { name: opening[1], children: [], text: "" };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (root) fail("multiple XML roots");
    else root = node;
    if (!selfClosing) stack.push(node);
  }
  if (stack.length || !root) fail("incomplete XML");
  const isModel = (node: XmlNode) => node.name === "mxGraphModel" && node.children.some(child => child.name === "root");
  if (root.name === "mxGraphModel") {
    if (!isModel(root)) fail("mxGraphModel has no root");
  } else if (root.name === "mxfile") {
    const diagrams = root.children.filter(node => node.name === "diagram");
    const isCompressed = (node: XmlNode) => {
      const payload = node.text.replace(/\s/g, "");
      return /^[A-Za-z0-9+/]+={0,2}$/.test(payload) && payload.length % 4 !== 1 && (!payload.endsWith("=") || payload.length % 4 === 0);
    };
    if (!diagrams.length || diagrams.some(diagram => !diagram.children.some(isModel) && !isCompressed(diagram))) fail("mxfile has no plausible diagram");
  } else fail("expected mxfile or mxGraphModel");
}

function checkedDocument(value: unknown): DrawioDocument {
  const doc = record(value, "draw.io document");
  if (doc.engine !== "drawio" || doc.version !== 1) fail("unsupported draw.io engine or document version");
  const xml = string(doc.xml, "draw.io XML");
  validateXml(xml);
  // Keep unknown data fields too; validation must not silently strip a future metadata field.
  const result = { ...doc, engine: "drawio", version: 1, xml } as DrawioDocument;
  if (doc.preview !== undefined) {
    result.preview = string(doc.preview, "preview");
    if (result.preview.length > 16 * 1024 * 1024) fail("preview is too large");
  }
  if (doc.legacySnapshot !== undefined) result.legacySnapshot = string(doc.legacySnapshot, "legacySnapshot");
  if (doc.viewport !== undefined) {
    const viewport = record(doc.viewport, "viewport");
    const scale = finite(viewport.scale, "viewport scale");
    if (scale <= 0) fail("viewport scale must be positive");
    result.viewport = { ...viewport, scale };
    if (viewport.scroll !== undefined) {
      const scroll = record(viewport.scroll, "viewport scroll");
      result.viewport.scroll = { ...scroll, x: finite(scroll.x, "viewport scroll x"), y: finite(scroll.y, "viewport scroll y") };
    }
    if (viewport.pageId !== undefined) result.viewport.pageId = string(viewport.pageId, "viewport page id");
  }
  return result;
}

export function emptyDrawioXml(): string {
  return '<mxfile host="Synapse"><diagram id="synapse-page-1" name="Холст"><mxGraphModel grid="1" page="0" connect="1" arrows="1"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
}

export function readDrawioDocument(raw: string): DrawioDocument {
  if (typeof raw !== "string") fail("snapshot must be a string");
  if (!raw.trim()) return { engine: "drawio", version: 1, xml: emptyDrawioXml() };
  if (raw.trimStart().startsWith("<")) { validateXml(raw); return { engine: "drawio", version: 1, xml: raw }; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail("snapshot is not valid JSON or draw.io XML"); }
  const value = record(parsed, "snapshot");
  if ("engine" in value || "xml" in value || ("version" in value && !Array.isArray(value.shapes))) return checkedDocument(value);
  return { engine: "drawio", version: 1, xml: legacyBoardToDrawioXml(raw), legacySnapshot: raw };
}

export function serializeDrawioDocument(doc: DrawioDocument): string {
  return JSON.stringify(checkedDocument(doc));
}

function style(values: Record<string, string | number | undefined>): string {
  return Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => {
    if (typeof value === "number" && !Number.isFinite(value)) fail(`${key} cannot be represented as a finite style value`);
    if (/[;=]/.test(String(value))) fail(`unsupported ${key} style value`);
    return `${key}=${String(value)};`;
  }).join("");
}
function appearance(shape: RecordValue, defaultColor = "#000000", defaultFill = "none", defaultSw = 1.5): Record<string, string | number> {
  const opacity = numberOr(shape.opacity, 1, "opacity");
  if (opacity < 0 || opacity > 1) fail("opacity must be between 0 and 1");
  if (shape.locked !== undefined && typeof shape.locked !== "boolean") fail("locked must be boolean");
  const sw = numberOr(shape.sw, defaultSw, "stroke width");
  if (sw < 0) fail("stroke width must not be negative");
  const result: Record<string, string | number> = {
    strokeColor: optionalString(shape.color, defaultColor, "color"), strokeWidth: sw,
    fillColor: optionalString(shape.fill, defaultFill, "fill"), opacity: opacity * 100,
    html: 0, linecap: "round", linejoin: "round",
  };
  if (shape.locked) Object.assign(result, { locked: 1, movable: 0, resizable: 0, rotatable: 0, deletable: 0, editable: 0 });
  return result;
}
function ink(fill: string): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fill);
  if (!match) return "#e5e7eb";
  const hex = match[1].length === 3 ? match[1].split("").map(ch => ch + ch).join("") : match[1];
  const luma = (0.299 * parseInt(hex.slice(0, 2), 16) + 0.587 * parseInt(hex.slice(2, 4), 16) + 0.114 * parseInt(hex.slice(4, 6), 16)) / 255;
  return luma > 0.6 ? "#1f2937" : "#f3f4f6";
}
function userCell(shape: RecordValue, id: string, label: string, cell: string, extra: Record<string, string> = {}): string {
  return `<UserObject${attrs({ id, label, synapseLegacyType: string(shape.type, "shape type"), synapseLegacyId: typeof shape.id === "string" ? shape.id : undefined, synapseLegacyData: JSON.stringify(shape), ...extra })}>${cell}</UserObject>`;
}
function point(p: Point, role?: string): string {
  return `<mxPoint${attrs({ x: p.x, y: p.y, as: role })}/>`;
}
function lineGeometry(points: Point[], labelT = 0.5): string {
  const terminals = points.length ? point(points[0], "sourcePoint") + point(points[points.length - 1], "targetPoint") : "";
  const bends = points.length > 2 ? `<Array as="points">${points.slice(1, -1).map(p => point(p)).join("")}</Array>` : "";
  return `<mxGeometry${attrs({ x: labelT * 2 - 1, relative: "1", as: "geometry" })}>${terminals}${bends}</mxGeometry>`;
}
function vertexCell(shape: RecordValue, id: string): string {
  const type = string(shape.type, "shape type");
  const sticky = type === "sticky";
  const x = numberOr(shape.x, sticky ? 0 : NaN, "x"), y = numberOr(shape.y, sticky ? 0 : NaN, "y");
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail("shape coordinates are missing");
  const isNote = sticky || type === "note";
  const base = appearance(shape, isNote ? "rgba(0,0,0,0.22)" : type === "db" || type === "action" || type === "process" || type === "decision" ? "#818cf8" : "#000000", isNote ? "#fde68a" : type === "db" ? "#1e1b4b" : ["action", "process", "decision"].includes(type) ? "#111827" : "none", sticky ? 1.25 : 1.5);
  let label = "", width: number, height: number;
  const properties: Record<string, string | number> = { ...base };
  const extra: Record<string, string> = {};
  if (type === "text") {
    label = string(shape.text, "text");
    const size = finite(shape.size, "font size");
    if (size < 0) fail("font size must not be negative");
    const lines = label.split("\n");
    width = Math.max(20, lines.reduce((max, line) => Math.max(max, line.length), 0) * size * 0.58);
    height = Math.max(size * 1.3 * lines.length, 1);
    Object.assign(properties, { shape: "text", strokeColor: "none", fillColor: "none", fontColor: base.strokeColor, fontSize: size, align: "left", verticalAlign: "top", whiteSpace: "nowrap", spacing: 0 });
  } else {
    width = numberOr(shape.w, sticky ? 200 : NaN, "width"); height = numberOr(shape.h, sticky ? 120 : NaN, "height");
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) fail("shape dimensions must be finite and nonnegative");
    if (type === "db") {
      label = string(shape.title, "database title");
      extra.query = string(shape.query, "SQL query");
      Object.assign(properties, { shape: "cylinder3", boundedLbl: 1, backgroundOutline: 1, size: 15, fontSize: Math.max(11, Math.min(22, height * 0.2)), fontStyle: 1 });
    } else if (type === "action" || type === "process" || type === "decision") {
      const variant = type === "action" ? shape.variant : type;
      if (variant !== "process" && variant !== "decision") fail("unsupported action variant");
      label = shape.label === undefined ? optionalString(shape.text, "", "action text") : string(shape.label, "action label");
      Object.assign(properties, { shape: variant === "decision" ? "rhombus" : "rectangle", rounded: variant === "process" ? 1 : 0, arcSize: 15, fontSize: Math.max(11, Math.min(20, Math.min(width, height) * 0.16)) });
    } else if (isNote) {
      label = optionalString(shape.text, "", "note text");
      Object.assign(properties, { shape: "note", size: 15, align: "left", verticalAlign: "top", spacing: 12, fontSize: Math.max(12, Math.min(18, width * 0.075)) });
    } else Object.assign(properties, { shape: type === "ellipse" ? "ellipse" : "rectangle", rounded: 0 });
    if (type === "db" || type === "action" || type === "process" || type === "decision" || isNote) Object.assign(properties, { fontColor: optionalString(shape.textColor, ink(String(base.fillColor)), "text color"), whiteSpace: "wrap" });
  }
  const cell = `<mxCell${attrs({ parent: "1", vertex: "1", style: style(properties) })}><mxGeometry${attrs({ x, y, width, height, as: "geometry" })}/></mxCell>`;
  return userCell(shape, id, label, cell, extra);
}
function strokeCell(shape: RecordValue, id: string): string {
  const type = string(shape.type, "shape type");
  const base = appearance(shape);
  let points: Point[];
  if (type === "arrow") points = [{ x: finite(shape.x1, "x1"), y: finite(shape.y1, "y1") }, { x: finite(shape.x2, "x2"), y: finite(shape.y2, "y2") }];
  else {
    if (!Array.isArray(shape.points)) fail("pen points must be an array");
    points = shape.points.map((value, index) => { const p = record(value, `point ${index}`); return { x: finite(p.x, "point x"), y: finite(p.y, "point y") }; });
  }
  if (type === "pen" && points.length === 1) {
    const diameter = Math.max(Number(base.strokeWidth), 0.02);
    const cell = `<mxCell${attrs({ parent: "1", vertex: "1", style: style({ ...base, shape: "ellipse", strokeColor: "none", fillColor: base.strokeColor }) })}><mxGeometry${attrs({ x: points[0].x - diameter / 2, y: points[0].y - diameter / 2, width: diameter, height: diameter, as: "geometry" })}/></mxCell>`;
    return userCell(shape, id, "", cell);
  }
  const properties = { ...base, shape: "connector", edgeStyle: "none", noEdgeStyle: 1, curved: type === "pen" ? 1 : 0, startArrow: "none", endArrow: type === "arrow" ? "block" : "none", endFill: 1 };
  return userCell(shape, id, "", `<mxCell${attrs({ parent: "1", edge: "1", style: style(properties) })}>${lineGeometry(points)}</mxCell>`);
}

/** Converts only representable data. Errors leave the caller's original snapshot untouched. */
export function legacyBoardToDrawioXml(raw: string): string {
  if (typeof raw !== "string") fail("legacy snapshot must be a string");
  if (!raw.trim()) return emptyDrawioXml();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail("legacy board is not valid JSON"); }
  const board = record(parsed, "legacy board");
  if (!Array.isArray(board.shapes)) fail("legacy shapes must be an array");
  if (board.edges !== undefined && !Array.isArray(board.edges)) fail("legacy edges must be an array");
  const camera = board.camera === undefined ? { x: 0, y: 0, zoom: 1 } : record(board.camera, "camera");
  const cameraX = finite(camera.x, "camera x"), cameraY = finite(camera.y, "camera y"), zoom = finite(camera.zoom, "camera zoom");
  if (zoom <= 0) fail("camera zoom must be positive");
  const shapes = board.shapes.map((value, index) => record(value, `shape ${index}`));
  const edges = (board.edges ?? []) as unknown[];
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const reserve = (value: unknown, description: string): string => {
    const id = string(value, description);
    if (!id || used.has(id)) fail(`${description} is empty or duplicated`);
    used.add(id);
    return id;
  };
  for (let index = 0; index < shapes.length; index++) {
    const shape = shapes[index], type = string(shape.type, "shape type");
    if (!SUPPORTED_SHAPES.has(type)) fail(`unsupported legacy shape ${type}`);
    if (type !== "sticky" || shape.id !== undefined) ids.set(reserve(shape.id, "shape id"), `synapse-shape-${index}`);
  }
  const cells = shapes.map((shape, index) => shape.type === "arrow" || shape.type === "pen" ? strokeCell(shape, `synapse-shape-${index}`) : vertexCell(shape, `synapse-shape-${index}`));
  for (let index = 0; index < edges.length; index++) {
    const edge = record(edges[index], `edge ${index}`);
    reserve(edge.id, "edge id");
    const from = string(edge.from, "edge source"), to = string(edge.to, "edge target");
    const source = ids.get(from), target = ids.get(to);
    if (!source || !target) fail(`edge ${String(edge.id)} refers to a missing shape`);
    const fromSide = string(edge.fromSide, "source anchor side"), toSide = string(edge.toSide, "target anchor side");
    if (!Object.prototype.hasOwnProperty.call(SIDES, fromSide) || !Object.prototype.hasOwnProperty.call(SIDES, toSide)) fail("unsupported edge anchor side");
    if (edge.routing !== "orthogonal" && edge.routing !== "bezier") fail("unsupported edge routing");
    const start = SIDES[fromSide as keyof typeof SIDES], end = SIDES[toSide as keyof typeof SIDES];
    const labelT = numberOr(edge.labelT, 0.5, "edge label position");
    if (labelT < 0 || labelT > 1) fail("edge label position must be between 0 and 1");
    const properties = { ...appearance(edge, "#818cf8", "none", 2 / zoom), shape: "connector", edgeStyle: "orthogonalEdgeStyle", rounded: 0, curved: edge.routing === "bezier" ? 1 : 0, startArrow: "none", endArrow: "block", endFill: 1, exitX: start[0], exitY: start[1], exitPerimeter: 1, entryX: end[0], entryY: end[1], entryPerimeter: 1, fontColor: "#e5e7eb", fontSize: 12, labelBackgroundColor: "#0e0e10" };
    const cell = `<mxCell${attrs({ parent: "1", edge: "1", source, target, style: style(properties) })}><mxGeometry${attrs({ x: labelT * 2 - 1, relative: "1", as: "geometry" })}/></mxCell>`;
    cells.push(userCell({ ...edge, type: "link" }, `synapse-edge-${index}`, optionalString(edge.label, "", "edge label"), cell));
  }
  // Root UserObject metadata survives draw.io codecs and native-file exports, unlike unknown model attributes.
  const root = `<UserObject${attrs({ id: "0", label: "", synapseCamera: JSON.stringify(camera), synapseLegacySnapshot: raw })}><mxCell/></UserObject><mxCell id="1" parent="0"/>`;
  return `<mxfile host="Synapse"><diagram id="synapse-page-1" name="Холст"><mxGraphModel${attrs({ dx: cameraX / zoom, dy: cameraY / zoom, grid: "1", gridSize: "10", guides: "1", tooltips: "1", connect: "1", arrows: "1", fold: "1", page: "0" })}><root>${root}${cells.join("")}</root></mxGraphModel></diagram></mxfile>`;
}
