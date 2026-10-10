import { ArrowRight, FileText, Folder, Hash, Loader2, Maximize2, Minus, Network, Palette, Pin, PinOff, Plus, RotateCcw, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { GraphScene } from "../lib/graphScene";
import { buildSearchDocs, type SearchDoc } from "../lib/fullTextSearch";
import { getWorkspaceDir, listVaultFiles } from "../lib/storage";
import { flattenNotes } from "../lib/treeUtils";
import { setGraphFocusHandler } from "../lib/graphFocus";
import { t } from "../lib/i18n";
import type { GraphAppearance, GraphMode, GraphOptions, GraphReferenceMap } from "../lib/graphTypes";
import { useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { GraphMinimap, type GraphMinimapHandle } from "./GraphMinimap";
import GraphReferencesWorker from "../workers/graphReferences.worker.ts?worker&inline";
import { BaseDirectory, exists, readTextFile } from "@tauri-apps/plugin-fs";
import { coerceGraphStyle, readObsidianGraphPreferences, type GraphStyle } from "../lib/graphStyle";
import "./graph.css";
import { recordGraphDiagnostic } from "../lib/graphDiagnostics";
import { graphSession } from "../lib/graphSession";

const MODE_KEY = "synapse.graph.mode";
const DEFAULT_APPEARANCE: Record<GraphMode, GraphAppearance> = {
  volume: { repulsion: 60000, clusterSeparation: 200000, internalRepulsion: 96000, linkDistance: 28, cohesion: 0.265, damping: 0.5, centerForce: 0.025, showEdges: false, colorByFolder: true, frozen: false, breathing: true, labelZoom: 1.35, nodeSize: 1, lineWidth: 1, linkStrength: 0.08, colorGroups: [] },
  obsidian: { repulsion: 50000, clusterSeparation: 0, internalRepulsion: 0, linkDistance: 160, cohesion: 0, damping: 0.88, centerForce: 0.005, showEdges: true, colorByFolder: false, frozen: false, breathing: false, labelZoom: 0.85, nodeSize: 1, lineWidth: 0.75, linkStrength: 0.12, colorGroups: [] },
};
const DEFAULT_OPTIONS: GraphOptions = { showOrphans: true, showUnresolved: true, showTags: false, showAttachments: false };

const STYLE_KEY = "synapse.graph.obsidian.style";
export function GraphView({ documents, obsidianSettings }: { documents?: readonly SearchDoc[]; obsidianSettings?: unknown } = {}) {
  const tree = useNotesStore((state) => state.tree);
  const setView = useNotesStore((state) => state.setView);
  const selectNote = useNotesStore((state) => state.selectNote);
  const setCurrentFolder = useNotesStore((state) => state.setCurrentFolder);
  const expandFolder = useNotesStore((state) => state.expandFolder);
  const notes = useMemo(() => flattenNotes(tree), [tree]);
  const [mode, setMode] = useState<GraphMode>(() => {
    try { return localStorage.getItem(MODE_KEY) === "obsidian" ? "obsidian" : "volume"; } catch { return "volume"; }
  });
  const [appearances, setAppearances] = useState(() => graphSession.preferences?.appearances ?? DEFAULT_APPEARANCE);
  const [options, setOptions] = useState(() => graphSession.preferences?.options ?? DEFAULT_OPTIONS);
  const appearance = appearances[mode];
  const [references, setReferences] = useState<GraphReferenceMap | null>(() => graphSession.references.hasSnapshot ? graphSession.references.references : null);
  const [files, setFiles] = useState<string[]>([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [referenceRetry, setReferenceRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number; pinned: boolean } | null>(null);
  const [panel, setPanel] = useState<"filters" | "physics" | "groups" | null>(null);
  const [styleReady, setStyleReady] = useState(!!graphSession.preferences);
  const originalStyle = useRef<GraphStyle>(graphSession.preferences?.originalStyle ?? coerceGraphStyle(null));
  const [query, setQuery] = useState(() => graphSession.preferences?.query ?? "");
  const deferredQuery = useDeferredValue(query);
  const [tags, setTags] = useState<Set<string>>(() => new Set(graphSession.preferences?.tags ?? []));
  const [timelineEnabled, setTimelineEnabled] = useState(() => graphSession.preferences?.timelineEnabled ?? false);
  const [timeline, setTimeline] = useState(() => graphSession.preferences?.timeline ?? Number.MAX_SAFE_INTEGER);
  const [creating, setCreating] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const minimap = useRef<GraphMinimapHandle>(null);
  const scene = useRef<GraphScene | null>(null);
  const sceneMode = useRef<GraphMode>(mode);
  const sceneRevision = useRef(0);
  const appearanceRef = useRef(appearance); appearanceRef.current = appearance;
  const filterRef = useRef<Set<string> | null>(null);
  const graph = useMemo(() => graphSession.model.update(tree, mode, references, options, files), [tree, mode, references, options, files]);
  const byKey = useMemo(() => new Map(graph.nodes.map((node) => [node.key, node])), [graph]);
  const selectedNode = selected ? byKey.get(selected) : null;
  const tagsAvailable = useMemo(() => [...new Set(notes.flatMap((note) => note.tags))].sort((a, b) => a.localeCompare(b)), [notes]);
  const dates = useMemo(() => ({ min: Math.min(...notes.map((note) => note.createdAt), Date.now()), max: Math.max(...notes.map((note) => note.createdAt), 0) }), [notes]);
  const visible = useMemo(() => {
    const search = deferredQuery.trim().toLowerCase();
    if (!search && tags.size === 0 && !timelineEnabled) return null;
    return new Set(notes.filter((note) => (!search || note.title.toLowerCase().includes(search) || note.id.toLowerCase().includes(search))
      && (tags.size === 0 || note.tags.some((tag) => tags.has(tag))) && (!timelineEnabled || note.createdAt <= timeline)).map((note) => note.id));
  }, [deferredQuery, notes, tags, timelineEnabled, timeline]);
  filterRef.current = visible;

  useEffect(() => {
    if (graphSession.preferences) return;
    let canceled = false;
    void (async () => {
      let imported: unknown = obsidianSettings;
      if (!documents && imported === undefined) {
        try {
          const path = "notes/.obsidian/graph.json", baseDir = BaseDirectory.AppData;
          if (await exists(path, { baseDir })) imported = JSON.parse(await readTextFile(path, { baseDir }));
        } catch { /* A normal Synapse workspace need not have Obsidian settings. */ }
      }
      if (canceled) return;
      const preset = readObsidianGraphPreferences(imported);
      originalStyle.current = preset.style;
      let style = preset.style;
      try { const saved = localStorage.getItem(STYLE_KEY); if (saved) style = coerceGraphStyle(JSON.parse(saved)); } catch { /* use copied preferences */ }
      setAppearances((current) => ({ ...current, obsidian: { ...current.obsidian, ...style, repulsion: preset.repulsion, centerForce: preset.centerForce, linkDistance: preset.linkDistance, linkStrength: preset.linkStrength } }));
      setOptions(preset.options); setStyleReady(true);
    })();
    return () => { canceled = true; };
  }, [!!documents, obsidianSettings]);
  useEffect(() => {
    if (styleReady) graphSession.preferences = { appearances, options, query, tags: [...tags], timelineEnabled, timeline, originalStyle: originalStyle.current };
  }, [appearances, options, query, tags, timelineEnabled, timeline, styleReady]);
  useEffect(() => {
    if (!styleReady) return;
    const { colorGroups, nodeSize, lineWidth } = appearances.obsidian;
    try { localStorage.setItem(STYLE_KEY, JSON.stringify({ colorGroups, nodeSize, lineWidth })); } catch { /* optional preference */ }
  }, [appearances.obsidian, styleReady]);

  useEffect(() => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* optional preference */ } setSelected(null); setMenu(null); setPanel(null); }, [mode]);
  useEffect(() => {
    let canceled = false;
    setReferencesLoading(true); setReferenceError(null);
    const supplied = documents?.map((document) => ({ id: document.note.id, body: document.body }));
    void graphSession.references.update(notes,
      async () => (await buildSearchDocs(notes)).map((document) => ({ id: document.note.id, body: document.body })),
      (changed) => new Promise<GraphReferenceMap>((resolve, reject) => {
        let worker: Worker;
        try { worker = new GraphReferencesWorker(); recordGraphDiagnostic("referenceWorkers"); }
        catch (reason) { reject(reason); return; }
        worker.onmessage = ({ data }: MessageEvent<{ ok: boolean; references?: GraphReferenceMap; error?: string }>) => {
          worker.terminate(); if (data.ok && data.references) resolve(data.references); else reject(new Error(data.error ?? t("Не удалось обновить связи")));
        };
        worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || t("Не удалось обновить связи"))); };
        recordGraphDiagnostic("parsedDocuments", changed.length); worker.postMessage(changed);
      }), supplied).then((value) => { if (!canceled) { setReferences(value); setReferencesLoading(false); } })
      .catch((reason) => { if (!canceled) { setReferenceError(String(reason)); setReferencesLoading(false); } });
    return () => { canceled = true; };
  }, [documents, notes, referenceRetry]);
  useEffect(() => {
    if (mode !== "obsidian" || !options.showAttachments) return;
    let canceled = false;
    void listVaultFiles().then((value) => { if (!canceled) setFiles(value); }).catch((reason) => { if (!canceled) setReferenceError(String(reason)); });
    return () => { canceled = true; };
  }, [mode, options.showAttachments]);

  const openNode = useCallback((key: string) => {
    const node = byKey.get(key); if (!node) return;
    if (node.kind === "note") { setView("notes"); void selectNote(node.path); }
    else if (node.kind === "folder") { setCurrentFolder(node.path); expandFolder(node.path); setView("files"); }
    else if (node.kind === "attachment") {
      void getWorkspaceDir().then((root) => openPath(`${root}/${node.path}`)).catch((reason) => useToastStore.getState().push(String(reason)));
    } else if (node.kind === "tag") { setTags(new Set([node.path])); setPanel("filters"); }
    else setSelected(key);
  }, [byKey, setView, selectNote, setCurrentFolder, expandFolder]);
  const callbacks = useRef({ openNode }); callbacks.current = { openNode };
  useEffect(() => {
    const element = host.current; if (!element || references === null || !styleReady) return;
    if (scene.current && sceneMode.current === mode && graph.nodes.length && !error) {
      scene.current.updateData(graph); return;
    }
    if (scene.current) { graphSession.layouts[sceneMode.current] = scene.current.snapshot(); scene.current.destroy(); scene.current = null; }
    if (!graph.nodes.length) return;
    const revision = ++sceneRevision.current; setError(null); sceneMode.current = mode;
    const current = new GraphScene(element, graph, mode, appearanceRef.current, {
      select: setSelected, open: (key) => callbacks.current.openNode(key),
      context: (key, x, y, pinned) => setMenu({ key, x, y, pinned }),
      minimap: (snapshot) => minimap.current?.update(snapshot), error: (message) => { if (revision === sceneRevision.current) setError(message); },
    }, graphSession.layouts[mode]);
    scene.current = current;
    void current.start().then(() => {
      if (revision !== sceneRevision.current) { current.destroy(); return; }
      current.setAppearance(appearanceRef.current); current.setFilter(filterRef.current);
    }).catch((reason) => { if (revision === sceneRevision.current) setError(String(reason)); current.destroy(); });
  }, [graph, mode, retry, references === null, styleReady]);
  useEffect(() => () => {
    sceneRevision.current++;
    if (scene.current) { graphSession.layouts[sceneMode.current] = scene.current.snapshot(); scene.current.destroy(); scene.current = null; }
  }, []);
  useEffect(() => { scene.current?.setAppearance(appearance); }, [appearance]);
  useEffect(() => { scene.current?.setFilter(visible); }, [visible]);
  useEffect(() => { scene.current?.setSelected(selected); }, [selected]);
  useEffect(() => { setGraphFocusHandler((key) => scene.current?.focus(key)); return () => setGraphFocusHandler(null); }, []);

  const changeAppearance = (patch: Partial<GraphAppearance>) => setAppearances((current) => ({ ...current, [mode]: { ...current[mode], ...patch } }));
  const resetFilters = () => { setQuery(""); setTags(new Set()); setTimelineEnabled(false); scene.current?.clearFocus(); };
  const center = useCallback((x: number, y: number) => scene.current?.center(x, y), []);
  const menuItems = useMemo<ContextMenuItem[]>(() => menu ? [
    { kind: "item", label: t("Открыть"), icon: FileText, onClick: () => openNode(menu.key) },
    { kind: "item", label: t("Фокус на узле"), icon: Network, onClick: () => scene.current?.focus(menu.key) },
    { kind: "item", label: t(menu.pinned ? "Открепить" : "Закрепить"), icon: menu.pinned ? PinOff : Pin, onClick: () => scene.current?.togglePin(menu.key) },
  ] : [], [menu, openNode]);
  const createMissing = async () => {
    if (!selectedNode || creating) return;
    setCreating(true);
    try {
      const split = selectedNode.path.lastIndexOf("/");
      await useNotesStore.getState().createNote(split < 0 ? "" : selectedNode.path.slice(0, split), selectedNode.label); setView("notes");
    } catch (reason) { useToastStore.getState().push(String(reason)); } finally { setCreating(false); }
  };

  return <section className={`graph-surface graph-${mode}`} aria-label={t("Граф связей")}>
    <div ref={host} className="graph-render-host" data-graph-mode={mode} />
    <div className="graph-toolbar">
      <div className="graph-mode-switch" role="radiogroup" aria-label={t("Режим графа")}>
        {(["volume", "obsidian"] as const).map((value) => <button type="button" key={value} role="radio" aria-checked={mode === value} tabIndex={mode === value ? 0 : -1}
          title={t(value === "volume" ? "Объёмный граф с островами папок" : "Граф в стиле Obsidian")}
          onClick={() => setMode(value)} onKeyDown={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next = event.key === "Home" ? "volume" : event.key === "End" ? "obsidian" : value === "volume" ? "obsidian" : "volume";
              const parent = event.currentTarget.parentElement;
              setMode(next);
              requestAnimationFrame(() => (parent?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next === "volume" ? 0 : 1])?.focus());
            }
          }}>{value === "volume" ? <Sparkles size={14} /> : <Network size={14} />}{t(value === "volume" ? "Объёмный" : "Obsidian")}</button>)}
      </div>
      <div className="graph-toolbar-actions">
        <button type="button" className={panel === "filters" ? "is-active" : ""} aria-expanded={panel === "filters"} onClick={() => setPanel((value) => value === "filters" ? null : "filters")}><Search size={14} />{t("Фильтры")}{visible ? <span className="graph-active-indicator" /> : null}</button>
        {mode === "obsidian" ? <button type="button" className={panel === "groups" ? "is-active" : ""} aria-expanded={panel === "groups"} onClick={() => setPanel((value) => value === "groups" ? null : "groups")}><Palette size={14} />{t("Группы")}</button> : null}
        <button type="button" className={panel === "physics" ? "is-active" : ""} aria-expanded={panel === "physics"} onClick={() => setPanel((value) => value === "physics" ? null : "physics")}><SlidersHorizontal size={14} />{t("Вид")}</button>
        <button type="button" onClick={() => scene.current?.fit()} title={t("Вместить весь граф")} aria-label={t("Вместить весь граф")}><Maximize2 size={15} /></button>
      </div>
    </div>
    {panel ? <div className="graph-controls" aria-label={t(panel === "filters" ? "Фильтры графа" : "Настройки графа")}>
      <div className="graph-controls-title"><strong>{t(panel === "filters" ? "Фильтры" : panel === "groups" ? "Цветные группы" : "Настройки графа")}</strong><button type="button" onClick={() => setPanel(null)} aria-label={t("Закрыть")}><X size={15} /></button></div>
      {panel === "filters" ? <>
        <label className="graph-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Название или путь")} aria-label={t("Поиск по графу")} /></label>
        {mode === "obsidian" ? <div className="graph-filter-toggles">
          <Toggle label={t("Неразрешённые ссылки")} checked={options.showUnresolved} change={(value) => setOptions((current) => ({ ...current, showUnresolved: value }))} />
          <Toggle label={t("Заметки без связей")} checked={options.showOrphans} change={(value) => setOptions((current) => ({ ...current, showOrphans: value }))} />
          <Toggle label={t("Теги как узлы")} checked={options.showTags} change={(value) => setOptions((current) => ({ ...current, showTags: value }))} />
          <Toggle label={t("Вложения")} checked={options.showAttachments} change={(value) => setOptions((current) => ({ ...current, showAttachments: value }))} />
        </div> : null}
        <div className="graph-tag-filters"><span><Hash size={13} />{t("Теги")}</span><div>{tagsAvailable.map((tag) => <button type="button" key={tag} aria-pressed={tags.has(tag)} onClick={() => setTags((previous) => { const next = new Set(previous); if (next.has(tag)) next.delete(tag); else next.add(tag); return next; })}>#{tag}</button>)}</div></div>
        <Toggle label={t("Таймлайн")} checked={timelineEnabled} change={(value) => { setTimelineEnabled(value); if (value && timeline === Number.MAX_SAFE_INTEGER) setTimeline(dates.max); }} />
        {timelineEnabled ? <label className="graph-timeline">{new Date(timeline).toLocaleDateString()}<input type="range" aria-label={t("Показать заметки до даты")} min={dates.min} max={Math.max(dates.min + 1, dates.max)} value={Math.min(timeline, dates.max)} onChange={(event) => setTimeline(Number(event.target.value))} /></label> : null}
        <button type="button" className="graph-text-action" onClick={resetFilters}><RotateCcw size={13} />{t("Сбросить фильтры")}</button>
      </> : panel === "groups" ? <>
        <p className="graph-group-hint">{t('Правило: path:"Папка", file:"Заметка" или tag:#тег. Первое совпадение задаёт цвет.')}</p>
        <div className="graph-color-groups">{appearances.obsidian.colorGroups.map((group, index) => <div className="graph-color-group" key={index}>
          <input type="color" aria-label={`${t("Цвет группы")} ${index + 1}`} value={group.color} onChange={(event) => setAppearances((current) => ({ ...current, obsidian: { ...current.obsidian, colorGroups: current.obsidian.colorGroups.map((value, i) => i === index ? { ...value, color: event.target.value } : value) } }))} />
          <input type="text" aria-label={`${t("Правило группы")} ${index + 1}`} placeholder='path:"Папка"' value={group.query} onChange={(event) => setAppearances((current) => ({ ...current, obsidian: { ...current.obsidian, colorGroups: current.obsidian.colorGroups.map((value, i) => i === index ? { ...value, query: event.target.value } : value) } }))} />
          <button type="button" aria-label={`${t("Удалить группу")} ${index + 1}`} onClick={() => setAppearances((current) => ({ ...current, obsidian: { ...current.obsidian, colorGroups: current.obsidian.colorGroups.filter((_, i) => i !== index) } }))}><X size={14} /></button>
        </div>)}</div>
        <button type="button" className="graph-text-action" disabled={appearances.obsidian.colorGroups.length >= 24} onClick={() => setAppearances((current) => ({ ...current, obsidian: { ...current.obsidian, colorGroups: [...current.obsidian.colorGroups, { query: "", color: "#b1df52" }] } }))}><Plus size={13} />{t("Добавить группу")}</button>
        <button type="button" className="graph-text-action" onClick={() => setAppearances((current) => ({ ...current, obsidian: { ...current.obsidian, ...originalStyle.current } }))}><RotateCcw size={13} />{t("Исходные цвета Obsidian")}</button>
      </> : <>
        <Toggle label={t("Симуляция")} checked={!appearance.frozen} change={(value) => changeAppearance({ frozen: !value })} />
        <Slider label={t("Отталкивание")} value={appearance.repulsion} min={1000} max={150000} step={1000} change={(value) => changeAppearance({ repulsion: value })} />
        <Slider label={t("Длина связей")} value={appearance.linkDistance} min={15} max={500} step={5} change={(value) => changeAppearance({ linkDistance: value })} />
        {mode === "obsidian" ? <><Slider label={t("Размер узлов")} value={appearance.nodeSize} min={0.4} max={3} step={0.05} change={(value) => changeAppearance({ nodeSize: value })} /><Slider label={t("Толщина линий")} value={appearance.lineWidth} min={0.2} max={3} step={0.05} change={(value) => changeAppearance({ lineWidth: value })} /></> : null}
        <Slider label={t("Притяжение к центру")} value={appearance.centerForce} min={0.001} max={0.08} step={0.001} change={(value) => changeAppearance({ centerForce: value })} />
        {mode === "volume" ? <>
          <Slider label={t("Разделение островов")} value={appearance.clusterSeparation} min={0} max={500000} step={5000} change={(value) => changeAppearance({ clusterSeparation: value })} />
          <Slider label={t("Отталкивание в холле")} value={appearance.internalRepulsion} min={0} max={200000} step={2000} change={(value) => changeAppearance({ internalRepulsion: value })} />
          <Slider label={t("Сплочённость")} value={appearance.cohesion} min={0.01} max={0.5} step={0.005} change={(value) => changeAppearance({ cohesion: value })} />
          <Toggle label={t("Дыхание капель")} checked={appearance.breathing} change={(value) => changeAppearance({ breathing: value })} />
        </> : null}
        <Slider label={t("Порог подписей")} value={appearance.labelZoom} min={0.15} max={3} step={0.05} change={(value) => changeAppearance({ labelZoom: value })} />
        <Toggle label={t("Связи (линии)")} checked={appearance.showEdges} change={(value) => changeAppearance({ showEdges: value })} />
        <Toggle label={t("Цвет по папке")} checked={appearance.colorByFolder} change={(value) => changeAppearance({ colorByFolder: value })} />
        <button type="button" className="graph-text-action" onClick={() => setAppearances((current) => ({ ...current, [mode]: DEFAULT_APPEARANCE[mode] }))}><RotateCcw size={13} />{t("Сбросить")}</button>
      </>}
    </div> : null}
    {graph.nodes.length ? <GraphMinimap ref={minimap} host={host} center={center} /> : <div className="graph-empty"><Network size={30} /><h2>{t("Пока нет узлов")}</h2><p>{t("Заметки и их связи появятся здесь после создания или импорта.")}</p></div>}
    <div className="graph-bottom-controls"><div role="status">{referencesLoading ? <Loader2 size={13} className="graph-loading" /> : null}<span>{t("Узлов")}: {graph.nodes.length} · {t("Связей")}: {graph.edges.length}</span></div><div><button type="button" onClick={() => scene.current?.zoom(1 / 1.2)} aria-label={t("Отдалить")}><Minus size={15} /></button><button type="button" onClick={() => scene.current?.zoom(1.2)} aria-label={t("Приблизить")}><Plus size={15} /></button></div></div>
    {selectedNode ? <div className="graph-node-preview"><button type="button" className="graph-preview-close" onClick={() => { setSelected(null); scene.current?.clearFocus(); }} aria-label={t("Закрыть")}><X size={14} /></button><div className="graph-preview-type">{selectedNode.kind === "folder" ? <Folder size={14} /> : <FileText size={14} />}{t(selectedNode.kind === "unresolved" ? "Неразрешённая ссылка" : selectedNode.kind === "folder" ? "Папка" : "Заметка")}</div><h3>{selectedNode.label}</h3><p>{selectedNode.note?.preview || selectedNode.path}</p><button type="button" onClick={() => selectedNode.kind === "unresolved" ? void createMissing() : openNode(selectedNode.key)} disabled={creating}>{creating ? <Loader2 size={13} className="graph-loading" /> : <ArrowRight size={13} />}{t(selectedNode.kind === "unresolved" ? "Создать заметку" : "Открыть")}</button></div> : null}
    {error ? <div className="graph-error" role="alert"><strong>{t("Не удалось открыть граф")}</strong><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>{t("Повторить")}</button></div> : null}
    {referenceError ? <div className="graph-reference-error" role="alert"><span>{t("Не удалось обновить связи")}</span><button type="button" onClick={() => setReferenceRetry((value) => value + 1)}>{t("Повторить")}</button><button type="button" onClick={() => setReferenceError(null)} aria-label={t("Закрыть")}><X size={13} /></button></div> : null}
    {menu ? <ContextMenu open x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} /> : null}
  </section>;
}

function Toggle({ label, checked, change }: { label: string; checked: boolean; change: (value: boolean) => void }) {
  return <label className="graph-toggle"><span>{label}</span><input type="checkbox" role="switch" checked={checked} onChange={(event) => change(event.target.checked)} /></label>;
}

function Slider({ label, value, min, max, step, change }: { label: string; value: number; min: number; max: number; step: number; change: (value: number) => void }) {
  return <label className="graph-slider"><span>{label}<output>{Number(value.toFixed(3))}</output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(event) => change(Number(event.target.value))} /></label>;
}
