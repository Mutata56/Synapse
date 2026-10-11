import { FileText, Link2, ListTree, Network, PanelRight } from "lucide-react";
import { useMemo, useRef } from "react";
import { t } from "../lib/i18n";
import { extractWorkspaceHeadings } from "../lib/workspaceOutline";
import { useNotesStore } from "../store/notes";
import { clampContextWidth, useWorkspaceStore } from "../store/workspace";
import { Backlinks } from "./Backlinks";
import { WorkspaceIconButton } from "./WorkspaceChrome";
import { LocalGraph } from "./LocalGraph";

export function WorkspaceContext() {
  const note = useNotesStore(state => state.view === "notes" ? state.activeNote : null);
  const pane = useWorkspaceStore(state => state.rightPane);
  const width = useWorkspaceStore(state => state.rightWidth);
  const sidebarWidth = useWorkspaceStore(state => state.sidebarWidth);
  const sidebarVisible = useWorkspaceStore(state => state.sidebarVisible);
  const setPane = useWorkspaceStore(state => state.setRightPane);
  const actualWidth = clampContextWidth(width, sidebarVisible, sidebarWidth);
  const root = useRef<HTMLElement>(null);
  const dragWidth = useRef(actualWidth);
  const dragging = useRef(false);
  const headings = useMemo(() => note ? extractWorkspaceHeadings(note.markdownSource ? note.sourceText ?? note.content : note.content) : [], [note]);
  return <aside ref={root} className="workspace-context" aria-label={t("Правая панель")} style={{ width: actualWidth }}>
    <header className="workspace-context-header"><div role="tablist" aria-label={t("Контекст заметки")}>
      <WorkspaceIconButton icon={ListTree} label={t("Структура заметки")} active={pane === "outline"} role="tab" aria-selected={pane === "outline"} onClick={() => setPane("outline")} />
      <WorkspaceIconButton icon={Link2} label={t("Обратные ссылки")} active={pane === "links"} role="tab" aria-selected={pane === "links"} onClick={() => setPane("links")} />
      <WorkspaceIconButton icon={Network} label={t("Локальный граф")} active={pane === "graph"} role="tab" aria-selected={pane === "graph"} onClick={() => setPane("graph")} />
    </div><WorkspaceIconButton icon={PanelRight} label={t("Свернуть правую панель")} onClick={() => useWorkspaceStore.getState().toggleRight()} /></header>
    <div className="workspace-context-content" role="tabpanel" aria-label={t(pane === "outline" ? "Структура заметки" : pane === "links" ? "Обратные ссылки" : "Локальный граф")}>
      {!note ? <div className="workspace-side-empty"><FileText size={21} aria-hidden="true" /><p>{t("Открой заметку, чтобы увидеть её структуру и ссылки.")}</p></div> : pane === "graph" ? <><h2>{t("Локальный граф")}</h2><LocalGraph compact sidebar /><button type="button" className="workspace-open-graph" onClick={() => void useWorkspaceStore.getState().openView("graph")}>{t("Открыть общий граф")}</button></> : pane === "links" ? <><h2>{t("Обратные ссылки")}</h2><Backlinks compact /></> : <><h2>{t("Структура заметки")}</h2>{headings.length ? headings.map((heading, index) => <button key={index} type="button" className="workspace-outline-row" style={{ paddingLeft: 12 + (heading.depth - 1) * 12 }} onClick={() => {
        const region = document.querySelector(".workspace-stage");
        // Scope to document bodies, excluding titles and application headings.
        // Ordered occurrences distinguish repeated headings without raw-Markdown comparisons.
        const body = region?.querySelector(".markdown-source-body,.bn-editor");
        const target = body?.querySelectorAll("h1,h2,h3,h4,h5,h6")[index];
        if (target) {
          target.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
          return;
        }
        const input = region?.querySelector<HTMLTextAreaElement>(".markdown-source-input");
        const sourceHeading = input ? extractWorkspaceHeadings(input.value)[index] : null;
        if (input && sourceHeading) {
          const start = sourceHeading.sourceOffset;
          const end = input.value.indexOf("\n", start);
          input.focus({ preventScroll: true });
          input.setSelectionRange(start, end < 0 ? input.value.length : end);
          const line = input.value.slice(0, start).split("\n").length - 1;
          input.scrollTop = Math.max(0, line * (parseFloat(getComputedStyle(input).lineHeight) || 24) - input.clientHeight / 3);
        }
      }}>{heading.title}</button>) : <p className="workspace-side-empty">{t("В этой заметке пока нет заголовков.")}</p>}</>}
    </div>
    <div role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t("Изменить ширину правой панели")} aria-valuenow={Math.round(actualWidth)} aria-valuemin={240} aria-valuemax={Math.round(clampContextWidth(600, sidebarVisible, sidebarWidth))} className="workspace-context-resize" title={t("Потяните, чтобы изменить ширину (двойной клик , сброс)")}
      onPointerDown={event => { event.preventDefault(); dragging.current = true; dragWidth.current = actualWidth; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (dragging.current && root.current) { dragWidth.current = clampContextWidth(root.current.getBoundingClientRect().right - event.clientX, sidebarVisible, sidebarWidth); root.current.style.width = `${dragWidth.current}px`; } }}
      onPointerUp={event => { if (!dragging.current) return; dragging.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); useWorkspaceStore.getState().setRightWidth(dragWidth.current); }}
      onPointerCancel={() => { dragging.current = false; if (root.current) root.current.style.width = `${actualWidth}px`; }}
      onDoubleClick={() => useWorkspaceStore.getState().setRightWidth(270)}
      onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) { event.preventDefault(); useWorkspaceStore.getState().setRightWidth(event.key === "Home" ? 270 : actualWidth + (event.key === "ArrowLeft" ? 16 : -16)); } }} />
  </aside>;
}
