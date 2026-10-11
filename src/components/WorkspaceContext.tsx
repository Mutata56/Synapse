import { FileText, Link2, ListTree, PanelRight } from "lucide-react";
import { useMemo, useState } from "react";
import { t } from "../lib/i18n";
import { useNotesStore } from "../store/notes";
import { useWorkspaceStore } from "../store/workspace";
import { Backlinks } from "./Backlinks";
import { WorkspaceIconButton } from "./WorkspaceChrome";

export function WorkspaceContext() {
  const note = useNotesStore(state => state.view === "notes" ? state.activeNote : null);
  const [pane, setPane] = useState<"outline" | "links">("outline");
  const headings = useMemo(() => {
    if (!note) return [];
    let fenced = false;
    return note.content.split(/\r?\n/).flatMap(line => {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return []; }
      const match = !fenced ? /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line) : null;
      return match ? [{ depth: match[1].length, title: match[2] }] : [];
    });
  }, [note]);
  return <aside className="workspace-context" aria-label={t("Правая панель")}>
    <header className="workspace-context-header"><div role="tablist" aria-label={t("Контекст заметки")}>
      <WorkspaceIconButton icon={ListTree} label={t("Структура заметки")} active={pane === "outline"} role="tab" aria-selected={pane === "outline"} onClick={() => setPane("outline")} />
      <WorkspaceIconButton icon={Link2} label={t("Обратные ссылки")} active={pane === "links"} role="tab" aria-selected={pane === "links"} onClick={() => setPane("links")} />
    </div><WorkspaceIconButton icon={PanelRight} label={t("Свернуть правую панель")} onClick={() => useWorkspaceStore.getState().toggleRight()} /></header>
    <div className="workspace-context-content" role="tabpanel" aria-label={t(pane === "outline" ? "Структура заметки" : "Обратные ссылки")}>
      {!note ? <div className="workspace-side-empty"><FileText size={21} aria-hidden="true" /><p>{t("Открой заметку, чтобы увидеть её структуру и ссылки.")}</p></div> : pane === "links" ? <><h2>{t("Обратные ссылки")}</h2><Backlinks compact /></> : <><h2>{t("Структура заметки")}</h2>{headings.length ? headings.map((heading, index) => <button key={index} type="button" className="workspace-outline-row" style={{ paddingLeft: 12 + (heading.depth - 1) * 12 }} onClick={() => {
        const region = document.querySelector(".workspace-stage");
        const target = [...(region?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? [])].find(element => element.textContent?.trim() === heading.title.trim());
        target?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }}>{heading.title}</button>) : <p className="workspace-side-empty">{t("В этой заметке пока нет заголовков.")}</p>}</>}
    </div>
  </aside>;
}
