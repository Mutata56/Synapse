import { escapeRegex } from "./iconize";
export type IconPack = { id: string; name: string; prefix: string; count?: number; version?: string };
export type CatalogIcon = { id: string; name: string; pack: string };
export const ICON_PACKS: readonly IconPack[] = [
  { id: "lucide-icons", name: "Lucide", prefix: "Li" },
  { id: "simple-icons", name: "Simple Icons · Logos", prefix: "Si" },
  { id: "font-awesome-brands", name: "Font Awesome · Brands", prefix: "Fab" },
  { id: "font-awesome-regular", name: "Font Awesome · Regular", prefix: "Far" },
  { id: "font-awesome-solid", name: "Font Awesome · Solid", prefix: "Fas" },
  { id: "remix-icons", name: "Remix Icons", prefix: "Ri" },
  { id: "tabler-icons", name: "Tabler Icons", prefix: "Ti" },
  { id: "boxicons", name: "Boxicons", prefix: "Bo" },
  { id: "icon-brew", name: "Icon Brew", prefix: "Ib" },
  { id: "rpg-awesome", name: "RPG Awesome", prefix: "Ra" },
  { id: "coolicons", name: "Coolicons", prefix: "Co" },
  { id: "feather-icons", name: "Feather Icons", prefix: "Fi" },
  { id: "octicons", name: "Octicons", prefix: "Oc" },
];
const catalog = new Map<string, Promise<CatalogIcon[]>>();
export function loadEmojiCatalog(): Promise<CatalogIcon[]> {
  let promise = catalog.get("emoji");
  if (!promise) {
    promise = fetch(iconAsset("emojis.json")).then(async response => {
      if (!response.ok) throw new Error("Emoji catalog unavailable");
      const rows: [string, string][] = await response.json(); return rows.map(([id, name]) => ({ id, name, pack: "emoji" }));
    }).catch(error => { catalog.delete("emoji"); throw error; });
    catalog.set("emoji", promise);
  }
  return promise;
}
const SEARCH_ALIASES: Record<string, string[]> = { склад: ["warehouse"], папка: ["folder"], код: ["code"], база: ["database"], работа: ["briefcase", "work"], учёба: ["school", "graduation", "university"], учеба: ["school", "graduation", "university"], деньги: ["money", "bank", "cash"], часы: ["clock"], сердце: ["heart"], звезда: ["star"], поиск: ["search"], книга: ["book"], заметка: ["note", "file", "memo"] };
export function searchIcons(icons: CatalogIcon[], query: string): CatalogIcon[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return icons.filter(icon => { const haystack = (icon.id + " " + icon.name + " " + icon.pack).toLocaleLowerCase(); return tokens.every(token => [token, ...(SEARCH_ALIASES[token] ?? [])].some(term => haystack.includes(term))); });
}
export const iconAsset = (path: string) => `${import.meta.env.BASE_URL}iconize/${path}`;
export function loadIconCatalog(pack: string): Promise<CatalogIcon[]> {
  if (pack === "all") return Promise.all(ICON_PACKS.map(p => loadIconCatalog(p.id))).then(packs => packs.flat());
  let promise = catalog.get(pack);
  if (!promise) {
    promise = fetch(iconAsset(`${pack}.json`)).then(async response => {
      if (!response.ok) throw new Error("Icon catalog unavailable");
      const rows: [string, string][] = await response.json();
      return rows.map(([id, name]) => ({ id, name, pack }));
    }).catch(error => { catalog.delete(pack); throw error; });
    catalog.set(pack, promise);
  }
  return promise;
}
export const isEmojiIcon = (value: string) => /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(value);
export function builtinIcon(value: string): { id: string; pack: string } | null {
  const id = value.replace(/^:|:$/g, "");
  if (!/^[A-Za-z][\w-]{0,127}$/.test(id)) return null;
  const pack = ICON_PACKS.find(p => id.startsWith(p.prefix) && /[A-Z0-9]/.test(id[p.prefix.length] ?? ""));
  if (pack) return { id, pack: pack.id };
  // Obsidian's native icon aliases may appear in a frontmatter field.
  if (id.startsWith("lucide-") || /^[a-z][a-z0-9-]*$/.test(id)) return { id: "Li" + id.replace(/^lucide-/, "").split("-").map(p => p[0]?.toUpperCase() + p.slice(1)).join(""), pack: "lucide-icons" };
  return null;
}
const SAFE_ELEMENTS = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "clipPath", "mask", "linearGradient", "radialGradient", "stop", "title", "desc", "use"]);
const SAFE_ATTRIBUTES = new Set(["xmlns", "viewBox", "fill", "fill-rule", "clip-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "fill-opacity", "stroke-opacity", "d", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "points", "transform", "id", "clip-path", "mask", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "fx", "fy", "href"]);
/** Custom SVGs are images: strip code, foreignObject, handlers, remote references and CSS. */
export function sanitizeIconSvg(source: string): string | null {
  if (source.length > 200000 || /<!DOCTYPE|<!ENTITY/i.test(source)) return null;
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.localName !== "svg" || doc.querySelector("parsererror")) return null;
  for (const element of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    if (!SAFE_ELEMENTS.has(element.localName)) { element.remove(); continue; }
    for (const attr of Array.from(element.attributes)) {
      if (!SAFE_ATTRIBUTES.has(attr.name) || /(?:javascript:|https?:|data:|@import|expression|\/\/)/i.test(attr.value) || /url\(/i.test(attr.value) && !/^url\(#[\w-]+\)$/.test(attr.value) || attr.name === "href" && !/^#[\w-]+$/.test(attr.value)) element.removeAttribute(attr.name);
    }
  }
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(svg);
}
export function customIconUrl(svg: string, color?: string | null): string {
  // Only currentColor is replaced; multicolor custom artwork retains its colors.
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/currentColor/g, color || "#d4d4d8"))}`;
}
export function iconShortcodes(text: string, identifier: string): { text: string; icon?: string }[] {
  const regex = new RegExp(`${escapeRegex(identifier)}([A-Za-z][\\w-]{0,127})${escapeRegex(identifier)}`, "g");
  let from = 0; const parts: { text: string; icon?: string }[] = [];
  for (const match of text.matchAll(regex)) {
    parts.push({ text: text.slice(from, match.index) }, { text: match[0], icon: match[1] }); from = match.index! + match[0].length;
  }
  parts.push({ text: text.slice(from) }); return parts;
}
export function emojiCodepoint(value: string): string {
  const sequence = Array.from(value).map(c => c.codePointAt(0)!);
  return sequence.filter(cp => cp !== 0xfe0f || sequence.includes(0x200d)).map(cp => cp.toString(16)).join("-");
}
