import { createContext, useContext, useMemo, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { indexVaultFiles, obsidianMarkdownPreview, resolveVaultReference, splitMarkdownSource, wikiTarget, type VaultFileIndex } from "../lib/obsidianImport";
import { useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { remarkNoteTags } from "../lib/remarkNoteTags";
import { remarkNoteBlocks } from "../lib/remarkNoteBlocks";
import { MarkdownCallout, MarkdownTask } from "./NoteBlockUI";
import { CALLOUT_LABELS, calloutType } from "../lib/noteBlockTypes";
import { t } from "../lib/i18n";

import { useIconizeStore } from "../store/iconize";
import { InlineIcon, VaultLinkIcon, remarkIconize } from "./IconizeMarkdown";

export const VaultMarkdownContext = createContext<{ files: VaultFileIndex; workspace: string; id: string; navigate: (ref: string, relative?: boolean, newTab?: boolean) => void }>({ files: indexVaultFiles([]), workspace: "", id: "", navigate: () => undefined });
const urlTransform = (url: string) => /^synapse-(?:note|embed|tag|icon):/.test(url) ? url : defaultUrlTransform(url);

export function scrollToMarkdownHeading(heading: string): void {
  if (!heading) return;
  const wanted = heading.replace(/^#/, "").trim().toLowerCase();
  const elements = document.querySelectorAll<HTMLElement>(".markdown-source-preview h1,.markdown-source-preview h2,.markdown-source-preview h3,.markdown-source-preview h4,.markdown-source-preview h5,.markdown-source-preview h6");
  Array.from(elements).find(element => element.textContent?.trim().toLowerCase() === wanted)?.scrollIntoView({ block: "start" });
}

export function VaultMarkdown({ source, onMarkerChange }: { source: string; onMarkerChange?: (kind: "callout" | "task", index: number, value: string) => void }) {
  const iconSettings = useIconizeStore(state => state.data.settings);
  const plugins = useMemo(() => [remarkGfm, remarkNoteBlocks, remarkNoteTags, [remarkIconize, { identifier: iconSettings.iconIdentifier, enabled: iconSettings.iconsInNotesEnabled }]] as import("unified").PluggableList, [iconSettings.iconIdentifier, iconSettings.iconsInNotesEnabled]);
  const { files, workspace, id, navigate } = useContext(VaultMarkdownContext);
  const preview = useMemo(() => obsidianMarkdownPreview(splitMarkdownSource(source).body), [source]);
  const components = useMemo(() => ({
    aside: ({ children, ...props }: any) => <MarkdownCallout kind={String(props["data-callout"] ?? "note")} fold={String(props["data-callout-fold"] ?? "none")} index={Number(props["data-callout-index"])} onPick={onMarkerChange}>{children}</MarkdownCallout>,
    div: ({ node: _node, children, ...props }: any) => props.className === "note-callout-heading" ? <span>{Array.isArray(children) ? children.length ? children : t(CALLOUT_LABELS[calloutType(props["data-callout-heading"])]) : children || t(CALLOUT_LABELS[calloutType(props["data-callout-heading"])])}</span> : <div {...props}>{children}</div>,
    li: ({ node: _node, children, ...props }: any) => props["data-task-status"] !== undefined ? <MarkdownTask marker={String(props["data-task-status"])} index={Number(props["data-task-index"])} onPick={onMarkerChange}>{children}</MarkdownTask> : <li {...props}>{children}</li>,
    a: ({ href = "", children }: { href?: string; children?: ReactNode }) => {
      if (href.startsWith("synapse-icon:")) return <InlineIcon id={href.slice("synapse-icon:".length)}>{children}</InlineIcon>;
      if (href.startsWith("synapse-tag:")) {
        const tag = decodeURIComponent(href.slice("synapse-tag:".length));
        return <button type="button" className="note-inline-tag" onClick={() => { const store = useNotesStore.getState(); store.setCurrentTag(tag); store.setView("tags"); }}>{children}</button>;
      }
      return <a href={href || undefined} onClick={event => {
        event.preventDefault();
        if (href.startsWith("synapse-note:")) { navigate(decodeURIComponent(href.slice("synapse-note:".length)), false, event.metaKey); return; }
        if (href.startsWith("#")) { scrollToMarkdownHeading(decodeURIComponent(href.slice(1))); return; }
        if (/^(?:https?:|mailto:)/i.test(href)) { void openUrl(href).catch(e => useToastStore.getState().push(String(e))); return; }
        const target = wikiTarget(href);
        if (/\.md$/i.test(target.path)) { navigate(href, true, event.metaKey); return; }
        const path = resolveVaultReference(target.path, id, files, { relativeFirst: true });
        if (path && workspace) void openPath(`${workspace}/${path}`).catch(e => useToastStore.getState().push(String(e)));
        else useToastStore.getState().push(`Файл не найден: ${href}`);
      }}><VaultLinkIcon href={href} noteId={id} files={files} />{children}</a>;
    },
    img: ({ src = "", alt = "", title }: { src?: string; alt?: string; title?: string }) => {
      const embed = src.startsWith("synapse-embed:");
      const reference = embed ? decodeURIComponent(src.slice("synapse-embed:".length)) : src;
      const remote = /^(?:https?:|data:image\/(?:png|jpe?g|gif|webp);)/i.test(src);
      const path = remote ? null : resolveVaultReference(reference, id, files, { relativeFirst: !embed });
      if (!remote && (!path || !workspace)) return <span className="markdown-source-missing">Вложение: {reference || alt}</span>;
      if (path && !/\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(path)) return <button type="button" className="markdown-source-attachment" onClick={() => {
        if (/\.md$/i.test(path)) navigate(path);
        else void openPath(`${workspace}/${path}`).catch(e => useToastStore.getState().push(String(e)));
      }}>{alt || path}</button>;
      const size = title && /^(\d+)(?:x(\d+))?$/.exec(title);
      return <img src={remote ? src : convertFileSrc(`${workspace}/${path}`)} alt={alt || reference} title={size ? undefined : title} loading="lazy" width={size ? Math.min(Number(size[1]), 4096) : undefined} height={size?.[2] ? Math.min(Number(size[2]), 4096) : undefined} />;
    },
  }), [files, workspace, id, navigate, onMarkerChange]);
  return <ReactMarkdown remarkPlugins={plugins} components={components} urlTransform={urlTransform}>{preview}</ReactMarkdown>;
}
