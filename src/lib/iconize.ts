/** Iconize 2.14.7 compatible IDs, rules and metadata. No filesystem or React here. */
export type IconKind = "file" | "folder";
export type IconAssignment = { icon: string | null; color?: string | null; inherit?: boolean };
export type IconRule = { id: string; rule: string; icon: string; order: number; color?: string | null; useFilePath?: boolean; for?: "everything" | "files" | "folders"; enabled?: boolean };
export type IconizeSettings = {
  fontSize: number; iconColor: string | null; emojiStyle: "native" | "twemoji";
  extraMargin: { top: number; right: number; bottom: number; left: number };
  recentlyUsedIcons: string[]; recentlyUsedIconsSize: number; rules: IconRule[];
  iconInTabsEnabled: boolean; iconInTitleEnabled: boolean; iconInTitlePosition: "above" | "inline";
  iconInFrontmatterEnabled: boolean; iconInFrontmatterFieldName: string; iconColorInFrontmatterFieldName: string;
  iconsInNotesEnabled: boolean; iconsInLinksEnabled: boolean; iconIdentifier: string;
};
export type CustomIcon = { id: string; name: string; pack: string; svg: string; png?: string };
export type IconizeState = { version: 1; settings: IconizeSettings; assignments: Record<string, IconAssignment>; customIcons: CustomIcon[]; imported: boolean };
export const DEFAULT_ICONIZE_SETTINGS: IconizeSettings = {
  fontSize: 16, iconColor: null, emojiStyle: "native", extraMargin: { top: 0, right: 4, bottom: 0, left: 0 },
  recentlyUsedIcons: [], recentlyUsedIconsSize: 12, rules: [], iconInTabsEnabled: true,
  iconInTitleEnabled: true, iconInTitlePosition: "above", iconInFrontmatterEnabled: true,
  iconInFrontmatterFieldName: "icon", iconColorInFrontmatterFieldName: "iconColor",
  iconsInNotesEnabled: true, iconsInLinksEnabled: true, iconIdentifier: ":",
};
export function emptyIconizeState(): IconizeState {
  return { version: 1, settings: coerceIconizeSettings({}), assignments: {}, customIcons: [], imported: false };
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function number(value: unknown, fallback: number, min: number, max: number): number { return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback; }
export function iconColor(value: unknown): string | null { return typeof value === "string" && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value) ? value : null; }
export function validIconPath(path: string): boolean { return !!path && !/[\\\u0000-\u001f]/.test(path) && !path.startsWith("/") && path.split("/").every(p => p && p !== "." && p !== ".."); }
export const iconKey = (kind: IconKind, path: string) => `${kind}:${path}`;
export function coerceIconizeSettings(value: unknown): IconizeSettings {
  const raw = record(value), defaults = DEFAULT_ICONIZE_SETTINGS;
  const result = { ...defaults, extraMargin: { ...defaults.extraMargin }, recentlyUsedIcons: [], rules: [] } as IconizeSettings;
  for (const key of ["iconInTabsEnabled", "iconInTitleEnabled", "iconInFrontmatterEnabled", "iconsInNotesEnabled", "iconsInLinksEnabled"] as const) if (typeof raw[key] === "boolean") result[key] = raw[key];
  result.fontSize = number(raw.fontSize, defaults.fontSize, 10, 48);
  result.recentlyUsedIconsSize = number(raw.recentlyUsedIconsSize, defaults.recentlyUsedIconsSize, 0, 100);
  result.iconColor = iconColor(raw.iconColor);
  if (raw.emojiStyle === "twemoji") result.emojiStyle = "twemoji";
  if (raw.iconInTitlePosition === "inline") result.iconInTitlePosition = "inline";
  for (const key of ["iconInFrontmatterFieldName", "iconColorInFrontmatterFieldName"] as const) if (typeof raw[key] === "string" && /^[\w-]{1,64}$/.test(raw[key])) result[key] = raw[key];
  if (typeof raw.iconIdentifier === "string" && raw.iconIdentifier.length > 0 && raw.iconIdentifier.length <= 8 && !/\s/.test(raw.iconIdentifier)) result.iconIdentifier = raw.iconIdentifier;
  const margin = record(raw.extraMargin);
  for (const side of ["top", "right", "bottom", "left"] as const) result.extraMargin[side] = number(margin[side], defaults.extraMargin[side], 0, 24);
  if (Array.isArray(raw.recentlyUsedIcons)) result.recentlyUsedIcons = [...new Set(raw.recentlyUsedIcons.filter((v): v is string => typeof v === "string" && v.length <= 128))].slice(0, 100);
  if (Array.isArray(raw.rules)) result.rules = raw.rules.slice(0, 200).flatMap((v, index) => {
    const r = record(v);
    if (typeof r.rule !== "string" || r.rule.length > 512 || typeof r.icon !== "string") return [];
    return [{ id: typeof r.id === "string" ? r.id : `import-${index}`, rule: r.rule, icon: r.icon.slice(0, 128), order: number(r.order, index, -10000, 10000), color: iconColor(r.color), useFilePath: r.useFilePath === true, for: r.for === "files" || r.for === "folders" ? r.for : "everything", enabled: r.enabled !== false }];
  });
  return result;
}
export function coerceIconAssignment(value: unknown): IconAssignment | null {
  if (typeof value === "string") return { icon: value.slice(0, 128) };
  const v = record(value), icon = Object.prototype.hasOwnProperty.call(v, "icon") ? v.icon : v.iconName;
  if (icon !== null && typeof icon !== "string") return null;
  return { icon: typeof icon === "string" ? icon.slice(0, 128) : null, color: iconColor(v.color), inherit: v.inherit === true };
}
export function coerceIconizeState(value: unknown): IconizeState {
  const raw = record(value), state = emptyIconizeState();
  state.settings = coerceIconizeSettings(raw.settings); state.imported = raw.imported === true;
  for (const [key, value] of Object.entries(record(raw.assignments))) {
    const split = key.indexOf(":");
    if (!["file", "folder"].includes(key.slice(0, split)) || !validIconPath(key.slice(split + 1))) continue;
    const assignment = coerceIconAssignment(value); if (assignment) state.assignments[key] = assignment;
  }
  // SVG content is validated separately before being installed and rendered.
  if (Array.isArray(raw.customIcons)) state.customIcons = raw.customIcons.slice(0, 5000).flatMap(v => {
    const icon = record(v);
    return typeof icon.id === "string" && /^[A-Za-z][\w-]{0,127}$/.test(icon.id) && typeof icon.name === "string" && typeof icon.pack === "string" && typeof icon.svg === "string" && icon.svg.length <= 200000
      ? [{ id: icon.id, name: icon.name.slice(0, 128), pack: icon.pack.slice(0, 64), svg: icon.svg, png: typeof icon.png === "string" && icon.png.length < 2800000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(icon.png) ? icon.png : undefined }] : [];
  });
  return state;
}
export function importIconizeData(value: unknown, current = emptyIconizeState()): IconizeState {
  const raw = record(value), state = { ...current, imported: true, settings: coerceIconizeSettings(raw.settings), assignments: { ...current.assignments } };
  for (const [path, value] of Object.entries(raw)) {
    if (path === "settings" || !validIconPath(path)) continue;
    const entry = coerceIconAssignment(value); if (!entry) continue;
    const key = iconKey(path.endsWith(".md") ? "file" : "folder", path);
    // A user's Synapse choice wins over a later re-import.
    if (!(key in state.assignments)) state.assignments[key] = entry;
    const v = record(value);
    if (typeof v.inheritanceIcon === "string") state.settings.rules.push({ id: `inherit-${path}`, rule: `^${escapeRegex(path)}/`, icon: v.inheritanceIcon, order: 1000, useFilePath: true, color: iconColor(v.inheritanceIconColor), for: "everything" });
  }
  return state;
}
export function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
type IconMeta = { icon?: string | null; iconColor?: string | null; frontmatterIcons?: Record<string, string> };
const compiledRules = new WeakMap<IconRule[], { rule: IconRule; regex: RegExp | null }[]>();
function rules(settings: IconizeSettings) {
  let result = compiledRules.get(settings.rules);
  if (!result) { result = [...settings.rules].sort((a, b) => a.order - b.order).map(rule => { let regex = null; try { regex = new RegExp(rule.rule); } catch { /* Iconize falls back to substring matching. */ } return { rule, regex }; }); compiledRules.set(settings.rules, result); }
  return result;
}
export function resolveIcon(state: IconizeState, kind: IconKind, path: string, meta?: IconMeta): IconAssignment | null {
  const settings = state.settings, explicit = state.assignments[iconKey(kind, path)];
  if (explicit) return explicit.icon ? { ...explicit, color: explicit.color ?? settings.iconColor } : null;
  const frontmatter = meta?.frontmatterIcons;
  const field = settings.iconInFrontmatterFieldName, colorField = settings.iconColorInFrontmatterFieldName;
  const fmIcon = frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, field) ? frontmatter[field] : undefined;
  const ownIcon = settings.iconInFrontmatterEnabled ? field === "icon" ? meta?.icon ?? fmIcon : fmIcon : undefined;
  if (typeof ownIcon === "string" && ownIcon) return { icon: ownIcon, color: colorField === "iconColor" ? iconColor(meta?.iconColor) ?? iconColor(frontmatter?.[colorField]) ?? settings.iconColor : iconColor(frontmatter?.[colorField]) ?? settings.iconColor };
  const parts = path.split("/"); parts.pop();
  while (parts.length) {
    const parent = state.assignments[iconKey("folder", parts.join("/"))];
    if (parent?.inherit && parent.icon) return { icon: parent.icon, color: parent.color ?? settings.iconColor };
    parts.pop();
  }
  for (const { rule, regex } of rules(settings)) {
    if (rule.enabled === false || rule.for === (kind === "file" ? "folders" : "files")) continue;
    const target = rule.useFilePath ? path : path.split("/").pop()!;
    if (regex ? regex.test(target) : target.includes(rule.rule)) return { icon: rule.icon, color: rule.color ?? settings.iconColor };
  }
  return null;
}
export function rebaseIconAssignments(state: IconizeState, from: string, to: string, folder: boolean): IconizeState {
  const assignments = { ...state.assignments }; let changed = false;
  for (const [key, value] of Object.entries(state.assignments)) {
    const split = key.indexOf(":"), path = key.slice(split + 1), kind = key.slice(0, split);
    const match = folder ? path === from && kind === "folder" || path.startsWith(`${from}/`) : kind === "file" && path === `${from}.md`;
    if (!match) continue;
    const destination = folder ? to + path.slice(from.length) : `${to}.md`;
    delete assignments[key]; assignments[`${kind}:${destination}`] = value; changed = true;
  }
  return changed ? { ...state, assignments } : state;
}
export function recentIconSettings(settings: IconizeSettings, icon: string): IconizeSettings {
  return { ...settings, recentlyUsedIcons: [icon, ...settings.recentlyUsedIcons.filter(id => id !== icon)].slice(0, settings.recentlyUsedIconsSize) };
}
