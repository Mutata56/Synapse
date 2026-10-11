import { memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { FileText, Folder } from "lucide-react";
import { EMOJI_FONT_STACK } from "../lib/format";
import { resolveIcon, type IconKind } from "../lib/iconize";
import { builtinIcon, customIconUrl, emojiCodepoint, iconAsset, isEmojiIcon, sanitizeIconSvg } from "../lib/iconizeCatalog";
import { useIconizeStore } from "../store/iconize";
import type { NoteMeta } from "../lib/storage";
import "./iconize.css";

export const IconGlyph = memo(function IconGlyph({ value, color, size = 18, className = "", label }: { value: string; color?: string | null; size?: number | string; className?: string; label?: string }) {
  const custom = useIconizeStore(s => s.data.customIcons.find(icon => icon.id === value));
  const emojiStyle = useIconizeStore(s => s.data.settings.emojiStyle);
  const [failedEmoji, setFailedEmoji] = useState("");
  const svg = useMemo(() => custom ? sanitizeIconSvg(custom.svg) : null, [custom]);
  const style: CSSProperties = { width: size, height: size, color: color || undefined, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", verticalAlign: "-0.15em" };
  const accessible = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  if (custom?.png && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(custom.png)) return <img src={custom.png} className={className} style={style} alt={label ?? ""} />;
  if (svg) return <img src={customIconUrl(svg, color)} className={className} style={style} alt={label ?? ""} />;
  if (isEmojiIcon(value)) {
    if (emojiStyle === "twemoji" && failedEmoji !== value) return <img src={iconAsset(`twemoji/${emojiCodepoint(value)}.svg`)} alt={label ?? value} className={className} style={style} onError={() => setFailedEmoji(value)} />;
    return <span className={className} style={{ ...style, fontSize: size, fontFamily: EMOJI_FONT_STACK, lineHeight: 1 }} {...accessible}>{value}</span>;
  }
  const builtin = builtinIcon(value);
  if (!builtin) return <FileText className={className} style={style} {...accessible} />;
  return <svg className={className} style={style} {...accessible}><use href={iconAsset(`${builtin.pack}.svg#${builtin.id}`)} /></svg>;
});
export function NoteIcon({ note, path, kind = "file", size, fallback, className, surface }: { note?: Pick<NoteMeta, "id" | "icon" | "iconColor" | "frontmatterIcons">; path?: string; kind?: IconKind; size?: number; fallback?: ReactNode; className?: string; surface?: "tab" | "link" | "title" }) {
  const state = useIconizeStore(s => s.data);
  const assignment = resolveIcon(state, kind, path ?? `${note?.id ?? ""}.md`, note);
  const enabled = surface === "tab" ? state.settings.iconInTabsEnabled : surface === "link" ? state.settings.iconsInLinksEnabled : surface === "title" ? state.settings.iconInTitleEnabled : true;
  if (!enabled || !assignment?.icon) return <>{fallback !== undefined ? fallback : (kind === "folder" ? <Folder size={size ?? state.settings.fontSize} className={className} /> : <FileText size={size ?? state.settings.fontSize} className={className} />)}</>;
  const margin = state.settings.extraMargin;
  return <span style={{ display: "inline-flex", flexShrink: 0, marginTop: margin.top, marginRight: margin.right, marginBottom: margin.bottom, marginLeft: margin.left }}><IconGlyph value={assignment.icon} color={assignment.color} size={size ?? state.settings.fontSize} className={className} /></span>;
}
