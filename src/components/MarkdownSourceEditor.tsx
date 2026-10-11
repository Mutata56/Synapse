import { ArrowLeft, Columns2, FileCode2, History, RefreshCw, Save } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  indexVaultFiles,
  normalizeSourceEdit,
  obsidianMarkdownPreview,
  resolveVaultReference,
  splitMarkdownSource,
  wikiTarget,
  type VaultFileIndex,
} from "../lib/obsidianImport";
import { getWorkspaceDir, listVaultFiles, readNote } from "../lib/storage";
import { confirmDialog } from "../store/confirm";
import { registerFlusher, useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { NoteHero } from "./NoteHero";

type Mode = "preview" | "source" | "split";
const REMARK_PLUGINS = [remarkGfm];
const EMPTY_INDEX = indexVaultFiles([]);
const draftKey = (id: string) => `synapse:markdown-draft:${id}`;
const anchorKey = (id: string) => `synapse:markdown-anchor:${id}`;

function loadDraft(id: string, source: string): { text: string; revision: string } {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(id)) ?? "null");
    if (typeof value?.text === "string" && typeof value?.revision === "string" && value.text !== source) return value;
  } catch { /* A draft is optional; the copied file remains the source of truth. */ }
  return { text: source, revision: source };
}

function persistDraft(id: string, text: string, revision: string): void {
  if (text === revision) localStorage.removeItem(draftKey(id));
  else localStorage.setItem(draftKey(id), JSON.stringify({ text, revision }));
}

function scrollToHeading(heading: string): void {
  if (!heading) return;
  const wanted = heading.replace(/^#/, "").trim().toLowerCase();
  const elements = document.querySelectorAll<HTMLElement>(".markdown-source-preview h1,.markdown-source-preview h2,.markdown-source-preview h3,.markdown-source-preview h4,.markdown-source-preview h5,.markdown-source-preview h6");
  Array.from(elements).find((element) => element.textContent?.trim().toLowerCase() === wanted)?.scrollIntoView({ block: "start" });
}

function previewUrl(url: string): string {
  return /^synapse-(?:note|embed):/.test(url) ? url : defaultUrlTransform(url);
}

/** The imported source is never parsed and then serialized by BlockNote. */
export function MarkdownSourceEditor() {
  const note = useNotesStore((s) => s.activeNote)!;
  const saveNote = useNotesStore((s) => s.saveNote);
  const goBack = useNotesStore((s) => s.goBack);
  const canGoBack = useNotesStore((s) => s.backStack.length > 0);
  const openVersionHistory = useNotesStore((s) => s.openVersionHistory);
  const initial = useMemo(() => loadDraft(note.id, note.sourceRevision ?? ""), [note.id]);
  const [text, setText] = useState(initial.text);
  const [mode, setMode] = useState<Mode>(initial.text === initial.revision ? "preview" : "source");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(initial.text !== initial.revision);
  const [files, setFiles] = useState<VaultFileIndex>(EMPTY_INDEX);
  const [workspace, setWorkspace] = useState("");
  const textRef = useRef(initial.text);
  const revisionRef = useRef(initial.revision);
  const editedRef = useRef(false);
  const errorRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flightRef = useRef<Promise<void> | null>(null);
  const aliveRef = useRef(true);
  const id = note.id;

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listVaultFiles(), getWorkspaceDir()]).then(([paths, root]) => {
      if (!cancelled) { setFiles(indexVaultFiles(paths)); setWorkspace(root.replace(/[\\/]+$/, "")); }
    }).catch((e) => { if (!cancelled) setError(`Не удалось загрузить вложения: ${String(e)}`); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    let heading: string | null = null;
    try { heading = sessionStorage.getItem(anchorKey(id)); sessionStorage.removeItem(anchorKey(id)); } catch { /* optional scroll hint */ }
    if (!heading) return;
    const frame = requestAnimationFrame(() => scrollToHeading(heading!));
    return () => cancelAnimationFrame(frame);
  }, [id]);

  // Metadata updates and external reloads may provide fresh disk text. A dirty
  // draft retains its baseline so a later save will detect the external change.
  useEffect(() => {
    const incoming = note.sourceRevision;
    if (incoming === undefined || textRef.current !== revisionRef.current) return;
    textRef.current = incoming;
    revisionRef.current = incoming;
    setText(incoming);
  }, [note.sourceRevision]);

  const save = useCallback(async (explicit = false): Promise<void> => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (flightRef.current) return flightRef.current;
    if (textRef.current === revisionRef.current || (!explicit && !editedRef.current) || (!explicit && errorRef.current)) return;
    const output = textRef.current;
    const revision = revisionRef.current;
    const run = (async () => {
      if (aliveRef.current) { setSaving(true); setError(null); }
      try {
        if (useNotesStore.getState().activeId !== id) throw new Error("Заметка закрыта. Черновик сохранён для следующего открытия.");
        await saveNote({ sourceText: output, sourceRevision: revision });
        const current = useNotesStore.getState().activeNote;
        const saved = current?.id === id ? current : await readNote(id);
        if (saved?.sourceRevision !== output) throw new Error("Не удалось проверить сохранение. Черновик сохранён.");
        revisionRef.current = output;
        errorRef.current = null;
        persistDraft(id, textRef.current, output);
        if (aliveRef.current) setDirty(textRef.current !== output);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errorRef.current = message;
        if (aliveRef.current) { setError(message); setDirty(true); }
        throw e;
      } finally {
        if (aliveRef.current) setSaving(false);
      }
    })();
    flightRef.current = run;
    try { await run; } finally {
      flightRef.current = null;
      if (aliveRef.current && editedRef.current && !errorRef.current && textRef.current !== revisionRef.current) {
        timerRef.current = setTimeout(() => { void save().catch(() => undefined); }, 600);
      }
    }
  }, [id, saveNote]);

  useEffect(() => {
    const unregister = registerFlusher(async () => {
      // Wait for an in-flight save, then include the keystrokes made during it.
      if (flightRef.current) await flightRef.current;
      await save();
    });
    return () => {
      if (useNotesStore.getState().activeId === id) void save().catch(() => undefined);
      unregister();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [save]);

  const changeSource = (value: string) => {
    const next = normalizeSourceEdit(value, revisionRef.current);
    textRef.current = next;
    editedRef.current = true;
    setText(next);
    setDirty(next !== revisionRef.current);
    try { persistDraft(id, next, revisionRef.current); } catch {
      errorRef.current = "Не удалось сохранить черновик. Сохраните файл кнопкой «Сохранить».";
      setError(errorRef.current);
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!errorRef.current) timerRef.current = setTimeout(() => { void save().catch(() => undefined); }, 600);
  };

  const reload = async () => {
    if (textRef.current !== revisionRef.current && !(await confirmDialog(
      "Перечитать файл? Текущий черновик будет заменён Markdown с диска. Скопируйте нужные правки перед этим действием.",
      { confirmLabel: "Перечитать" },
    ))) return;
    const fresh = await readNote(id);
    if (fresh?.sourceRevision === undefined) return;
    textRef.current = fresh.sourceRevision;
    revisionRef.current = fresh.sourceRevision;
    editedRef.current = false;
    errorRef.current = null;
    persistDraft(id, fresh.sourceRevision, fresh.sourceRevision);
    setText(fresh.sourceRevision); setDirty(false); setError(null);
    useNotesStore.setState({ activeNote: fresh });
  };

  const deferredText = useDeferredValue(text);
  const preview = useMemo(() => obsidianMarkdownPreview(splitMarkdownSource(deferredText).body), [deferredText]);
  const navigate = useCallback((reference: string, relativeFirst = false) => {
    const target = wikiTarget(reference);
    const path = resolveVaultReference(target.path, id, files, { note: true, relativeFirst });
    if (!path) { useToastStore.getState().push(`Ссылка не найдена или неоднозначна: ${reference}`); return; }
    const nextId = path.slice(0, -3);
    if (nextId === id) { setMode("preview"); requestAnimationFrame(() => scrollToHeading(target.heading)); return; }
    try { if (target.heading) sessionStorage.setItem(anchorKey(nextId), target.heading); } catch { /* optional scroll hint */ }
    useNotesStore.getState().openLinkMatch(nextId);
  }, [id, files]);

  const components = useMemo(() => ({
    a: ({ href = "", children }: { href?: string; children?: React.ReactNode }) => {
      const wiki = href.startsWith("synapse-note:");
      const external = /^(?:https?:|mailto:)/i.test(href);
      return <a href={href || undefined} onClick={(event) => {
        event.preventDefault();
        if (wiki) { navigate(decodeURIComponent(href.slice("synapse-note:".length))); return; }
        if (href.startsWith("#")) { scrollToHeading(decodeURIComponent(href.slice(1))); return; }
        if (external) { void openUrl(href).catch((e) => useToastStore.getState().push(String(e))); return; }
        const target = wikiTarget(href);
        if (/\.md$/i.test(target.path)) { navigate(href, true); return; }
        const path = resolveVaultReference(target.path, id, files, { relativeFirst: true });
        if (path && workspace) void openPath(`${workspace}/${path}`).catch((e) => useToastStore.getState().push(String(e)));
        else useToastStore.getState().push(`Файл не найден: ${href}`);
      }}>{children}</a>;
    },
    img: ({ src = "", alt = "", title }: { src?: string; alt?: string; title?: string }) => <VaultPreviewImage source={src} alt={alt} title={title} files={files} noteId={id} workspace={workspace} navigate={navigate} />,
  }), [files, id, workspace, navigate]);

  return <div className="markdown-source-editor">
    <div className="markdown-source-toolbar">
      {canGoBack ? <button type="button" onClick={goBack} title="Назад" aria-label="Назад"><ArrowLeft size={16} /></button> : null}
      <div className="markdown-source-modes" aria-label="Режим просмотра">
        <button type="button" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Чтение</button>
        <button type="button" aria-pressed={mode === "source"} onClick={() => setMode("source")}><FileCode2 size={14} /> Markdown</button>
        <button type="button" aria-pressed={mode === "split"} onClick={() => setMode("split")}><Columns2 size={14} /> Рядом</button>
      </div>
      <span className="markdown-source-status" role="status">{saving ? "Сохраняю…" : dirty ? "Черновик" : "Markdown сохранён"}</span>
      <button type="button" onClick={() => openVersionHistory(id)} title="История версий" aria-label="История версий"><History size={16} /></button>
      <button type="button" disabled={saving} onClick={() => { void reload().catch((e) => setError(String(e))); }} title="Перечитать файл" aria-label="Перечитать файл"><RefreshCw size={16} /></button>
      <button type="button" onClick={() => { void save(true).catch(() => undefined); }} disabled={!dirty || saving}><Save size={14} /> Сохранить</button>
    </div>
    {error ? <div className="markdown-source-error" role="alert">{error}</div> : null}
    <div className="markdown-source-location" title={id}>{id}.md</div>
    <div className={`markdown-source-panes markdown-source-${mode}`}>
      {mode !== "preview" ? <textarea className="markdown-source-input" aria-label="Исходный Markdown включая свойства YAML" spellCheck={false} value={text} onChange={(event) => changeSource(event.target.value)} onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(true).catch(() => undefined); }
      }} /> : null}
      {mode !== "source" ? <div className="markdown-source-preview group/hero" data-editor-scroll>
        <NoteHero key={id} />
        <div className="md-content markdown-source-body"><ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components} urlTransform={previewUrl}>{preview}</ReactMarkdown></div>
      </div> : null}
    </div>
  </div>;
}

function VaultPreviewImage({ source, alt, title, files, noteId, workspace, navigate }: {
  source: string; alt: string; title?: string; files: VaultFileIndex; noteId: string;
  workspace: string; navigate: (reference: string, relativeFirst?: boolean) => void;
}) {
  const embed = source.startsWith("synapse-embed:");
  const reference = embed ? decodeURIComponent(source.slice("synapse-embed:".length)) : source;
  const remote = /^(?:https?:|data:image\/(?:png|jpe?g|gif|webp);)/i.test(source);
  const path = remote ? null : resolveVaultReference(reference, noteId, files, { relativeFirst: !embed });
  if (!remote && (!path || !workspace)) return <span className="markdown-source-missing">Вложение: {reference || alt}</span>;
  if (path && !/\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(path)) {
    return <button type="button" className="markdown-source-attachment" onClick={() => {
      if (/\.md$/i.test(path)) navigate(path);
      else void openPath(`${workspace}/${path}`).catch((e) => useToastStore.getState().push(String(e)));
    }}>{alt || path}</button>;
  }
  const size = title && /^(\d+)(?:x(\d+))?$/.exec(title);
  return <img src={remote ? source : convertFileSrc(`${workspace}/${path}`)} alt={alt || reference} title={size ? undefined : title} loading="lazy" width={size ? Math.min(Number(size[1]), 4096) : undefined} height={size?.[2] ? Math.min(Number(size[2]), 4096) : undefined} />;
}
