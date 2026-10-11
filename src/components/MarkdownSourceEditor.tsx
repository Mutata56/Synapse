import { ArrowLeft, Blocks, FileCode2, History, RefreshCw, Save } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  indexVaultFiles,
  normalizeSourceEdit,
  resolveVaultReference,
  wikiTarget,
  type VaultFileIndex,
} from "../lib/obsidianImport";
import { getWorkspaceDir, listVaultFiles, readNote } from "../lib/storage";
import { confirmDialog } from "../store/confirm";
import { registerFlusher, useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { NoteHero } from "./NoteHero";
import { Editor2026 } from "../editor2026/Editor2026";
import { decodeImportedMap, type ImportedBlock, type ImportedSourceMap } from "../editor2026/importedMarkdown";
import { changeNoteMarker } from "../lib/noteBlockMarkdown";
import { VaultMarkdown, VaultMarkdownContext, scrollToMarkdownHeading as scrollToHeading } from "./VaultMarkdown";

type Mode = "blocks" | "preview" | "source";
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

/** Block edits retain unchanged source chunks; Markdown remains directly editable. */
export function MarkdownSourceEditor() {
  const note = useNotesStore((s) => s.activeNote)!;
  const saveNote = useNotesStore((s) => s.saveNote);
  const goBack = useNotesStore((s) => s.goBack);
  const canGoBack = useNotesStore((s) => s.backStack.length > 0);
  const openVersionHistory = useNotesStore((s) => s.openVersionHistory);
  const initial = useMemo(() => loadDraft(note.id, note.sourceRevision ?? ""), [note.id]);
  const blockDraft = useMemo(() => {
    try { const value = JSON.parse(localStorage.getItem(`synapse:block-draft:${note.id}`) ?? "null");
      if (decodeImportedMap(value?.sourceMap) && typeof value.blocknote === "string") return value as { sourceMap: string; blocknote: string };
    } catch { /* The file and its persisted rich state remain available. */ }
    return null;
  }, [note.id]);
  const startingSource = blockDraft ? decodeImportedMap(blockDraft.sourceMap)!.source : initial.text;
  const [text, setText] = useState(startingSource);
  const [mode, setMode] = useState<Mode>("blocks");
  const [blockGeneration, setBlockGeneration] = useState(0);
  const blockFlushRef = useRef<(() => Promise<void>) | null>(null);
  const blockCacheRef = useRef<{ blocknote: string; sourceMap: string } | null>(blockDraft ?? (note.blocknote && note.sourceMap ? { blocknote: note.blocknote, sourceMap: note.sourceMap } : null));
  const blocksDirtyRef = useRef(Boolean(blockDraft));
  const blockOutputReadyRef = useRef(false);
  const latestBlockJson = useRef(blockDraft?.blocknote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(initial.text !== initial.revision || Boolean(blockDraft));
  const [files, setFiles] = useState<VaultFileIndex>(EMPTY_INDEX);
  const [workspace, setWorkspace] = useState("");
  const textRef = useRef(startingSource);
  const revisionRef = useRef(blockDraft ? startingSource : initial.revision);
  const editedRef = useRef(Boolean(blockDraft));
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
    if (incoming === undefined || blocksDirtyRef.current || textRef.current !== revisionRef.current) return;
    textRef.current = incoming;
    revisionRef.current = incoming;
    setText(incoming);
  }, [note.sourceRevision]);

  const save = useCallback(async (explicit = false): Promise<void> => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (flightRef.current) { await flightRef.current; return save(explicit); }
    if ((textRef.current === revisionRef.current && !blocksDirtyRef.current) || (!explicit && !editedRef.current) || (!explicit && errorRef.current)) return;
    if (blocksDirtyRef.current && !blockOutputReadyRef.current) return;
    const output = textRef.current;
    const revision = revisionRef.current;
    const cache = blockCacheRef.current;
    const run = (async () => {
      if (aliveRef.current) { setSaving(true); setError(null); }
      try {
        if (useNotesStore.getState().activeId !== id) throw new Error("Заметка закрыта. Черновик сохранён для следующего открытия.");
        await saveNote({ sourceText: output, sourceRevision: revision, blocknote: cache?.blocknote ?? null, sourceMap: cache?.sourceMap ?? null });
        const current = useNotesStore.getState().activeNote;
        const saved = current?.id === id ? current : await readNote(id);
        if (saved?.sourceRevision !== output) throw new Error("Не удалось проверить сохранение. Черновик сохранён.");
        revisionRef.current = output;
        errorRef.current = null;
        persistDraft(id, textRef.current, output);
        if (cache && latestBlockJson.current === cache.blocknote) {
          blocksDirtyRef.current = false;
          localStorage.removeItem(`synapse:block-draft:${id}`);
        } else if (blocksDirtyRef.current && cache) {
          // Keystrokes made while saving keep the fresh baseline and their own document.
          const pending = { blocknote: latestBlockJson.current, sourceMap: cache.sourceMap };
          blockCacheRef.current = pending;
          localStorage.setItem(`synapse:block-draft:${id}`, JSON.stringify(pending));
        }
        if (aliveRef.current) setDirty(textRef.current !== output || blocksDirtyRef.current);
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

  const changeSource = (value: string, cache?: { blocknote: string; sourceMap: string }) => {
    if (cache) blockCacheRef.current = cache;
    else {
      blockCacheRef.current = null;
      blocksDirtyRef.current = false;
      localStorage.removeItem(`synapse:block-draft:${id}`);
    }
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
    if ((textRef.current !== revisionRef.current || blocksDirtyRef.current) && !(await confirmDialog(
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
      blockCacheRef.current = fresh.blocknote && fresh.sourceMap ? { blocknote: fresh.blocknote, sourceMap: fresh.sourceMap } : null;
      blocksDirtyRef.current = false;
      localStorage.removeItem(`synapse:block-draft:${id}`);
      setBlockGeneration(value => value + 1);
    useNotesStore.setState({ activeNote: fresh });
  };

  const deferredText = useDeferredValue(text);
  const navigate = useCallback((reference: string, relativeFirst = false, newTab = false) => {
    const target = wikiTarget(reference);
    const path = resolveVaultReference(target.path, id, files, { note: true, relativeFirst });
    if (!path) { useToastStore.getState().push(`Ссылка не найдена или неоднозначна: ${reference}`); return; }
    const nextId = path.slice(0, -3);
    if (nextId === id && !newTab) {
      void (async () => { await blockFlushRef.current?.(); await save(); setMode("preview"); requestAnimationFrame(() => scrollToHeading(target.heading)); })().catch(() => undefined);
      return;
    }
    try { if (target.heading) sessionStorage.setItem(anchorKey(nextId), target.heading); } catch { /* optional scroll hint */ }
    useNotesStore.getState().openLinkMatch(nextId, newTab);
  }, [id, files, save]);

  const switchMode = async (next: Mode) => {
    try { await blockFlushRef.current?.(); await save(); setMode(next); } catch { /* Keep the draft and visible recovery actions. */ }
  };
  const bridge = {
    dirty: blocksDirtyRef.current,
    source: textRef.current,
    blocknote: blockCacheRef.current?.blocknote,
    sourceMap: blockCacheRef.current?.sourceMap,
    onReady: (flush: (() => Promise<void>) | null) => { blockFlushRef.current = flush; },
    onDraft: (blocks: ImportedBlock[], map: ImportedSourceMap) => {
      const cache = { blocknote: JSON.stringify(blocks), sourceMap: JSON.stringify(map) };
      latestBlockJson.current = cache.blocknote;
      blockCacheRef.current = cache;
      blocksDirtyRef.current = true;
      blockOutputReadyRef.current = false;
      setDirty(true);
      try { localStorage.setItem(`synapse:block-draft:${id}`, JSON.stringify(cache)); } catch {
        setError("Не удалось сохранить черновик блоков. Нажмите «Сохранить».");
      }
    },
    onSave: async (source: string, blocknote: string, sourceMap: string) => {
      blockOutputReadyRef.current = true;
      changeSource(source, { blocknote, sourceMap });
      await save(true);
    },
  };

  return <VaultMarkdownContext.Provider value={{ files, workspace, id, navigate }}><div className="markdown-source-editor" onKeyDownCapture={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault(); void (async () => { await blockFlushRef.current?.(); await save(true); })().catch(() => undefined);
    }
  }}>
    <div className="markdown-source-toolbar">
      {canGoBack ? <button type="button" onClick={goBack} title="Назад" aria-label="Назад"><ArrowLeft size={16} /></button> : null}
      <div className="markdown-source-modes" aria-label="Режим просмотра">
        <button type="button" aria-pressed={mode === "blocks"} onClick={() => { void switchMode("blocks"); }}><Blocks size={14} /> Блоки</button>
        <button type="button" aria-pressed={mode === "preview"} onClick={() => { void switchMode("preview"); }}>Чтение</button>
        <button type="button" aria-pressed={mode === "source"} onClick={() => { void switchMode("source"); }}><FileCode2 size={14} /> Markdown</button>
      </div>
      <span className="markdown-source-status" role="status">{saving ? "Сохраняю…" : dirty ? "Черновик" : "Сохранено"}</span>
      <button type="button" onClick={() => openVersionHistory(id)} title="История версий" aria-label="История версий"><History size={16} /></button>
      <button type="button" disabled={saving} onClick={() => { void reload().catch((e) => setError(String(e))); }} title="Перечитать файл" aria-label="Перечитать файл"><RefreshCw size={16} /></button>
      <button type="button" onClick={() => { void (async () => { await blockFlushRef.current?.(); await save(true); })().catch(() => undefined); }} disabled={!dirty || saving}><Save size={14} /> Сохранить</button>
    </div>
    {error ? <div className="markdown-source-error" role="alert">{error}</div> : null}
    <div className="markdown-source-location" title={id}>{id}.md</div>
    <div className={`markdown-source-panes markdown-source-${mode}`}>
      {mode === "blocks" ? <Editor2026 key={`${id}:${blockGeneration}`} imported={bridge} /> : null}
      {mode === "source" ? <textarea className="markdown-source-input" aria-label="Исходный Markdown включая свойства YAML" spellCheck={false} value={text} onChange={(event) => changeSource(event.target.value)} onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(true).catch(() => undefined); }
      }} /> : null}
      {mode === "preview" ? <div className="markdown-source-preview group/hero" data-editor-scroll>
        <NoteHero key={id} />
        <div className="md-content markdown-source-body"><VaultMarkdown source={deferredText} onMarkerChange={(kind, index, value) => changeSource(changeNoteMarker(textRef.current, kind, index, value))} /></div>
      </div> : null}
    </div>
  </div></VaultMarkdownContext.Provider>;
}
