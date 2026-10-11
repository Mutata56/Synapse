import { builtinIcon, iconShortcodes } from "../lib/iconizeCatalog";
import { useIconizeStore } from "../store/iconize";
import { IconGlyph, NoteIcon } from "./NoteIcon";
import { resolveVaultReference, wikiTarget, type VaultFileIndex } from "../lib/obsidianImport";
import { flattenNotes } from "../lib/treeUtils";
import { useNotesStore } from "../store/notes";
import { useMemo, type ReactNode } from "react";

type Node = { type: string; value?: string; url?: string; data?: Record<string, unknown>; children?: Node[] };
/** Replace text nodes only: code blocks, inline code and raw HTML remain literal. */
export function remarkIconize(options: { identifier: string; enabled: boolean }) {
  return (tree: Node) => {
    if (!options.enabled) return;
    const walk = (parent: Node) => {
      if (!parent.children || ["code", "inlineCode", "html", "image"].includes(parent.type)) return;
      parent.children = parent.children.flatMap(child => {
        if (child.type === "text" && child.value) return iconShortcodes(child.value, options.identifier).map(part => part.icon ? { type: "link", url: "synapse-icon:" + part.icon, children: [{ type: "text", value: part.text }] } : { type: "text", value: part.text });
        walk(child); return [child];
      });
    };
    walk(tree);
  };
}
export function InlineIcon({ id, children }: { id: string; children?: ReactNode }) {
  const custom = useIconizeStore(state => state.data.customIcons.some(icon => icon.id === id));
  const color = useIconizeStore(state => state.data.settings.iconColor);
  const glyph = builtinIcon(id);
  if (!custom && (!glyph || glyph.id !== id)) return <>{children}</>;
  return <span className="iconize-inline" title={id}><IconGlyph value={id} size="1em" color={color} label={id} /></span>;
}
export function VaultLinkIcon({ href, noteId, files }: { href: string; noteId: string; files: VaultFileIndex }) {
  const tree = useNotesStore(state => state.tree);
  const notes = useMemo(() => new Map(flattenNotes(tree).map(note => [note.id, note])), [tree]);
  if (/^(?:https?:|mailto:|#)/i.test(href)) return null;
  const wiki = href.startsWith("synapse-note:");
  let reference: string;
  try { reference = wiki ? decodeURIComponent(href.slice("synapse-note:".length)) : href; } catch { return null; }
  const path = resolveVaultReference(wikiTarget(reference).path, noteId, files, { note: true, relativeFirst: !wiki });
  if (!path) return null;
  const id = path.slice(0, -3);
  return <NoteIcon note={notes.get(id)} path={id + ".md"} size={14} surface="link" fallback={null} />;
}
