import { create } from "zustand";
import { t } from "../lib/i18n";
import { flattenNotes } from "../lib/treeUtils";
import { activeWorkspaceTab, closeWorkspaceTab, emptySession, openWorkspaceTarget, parseWorkspaceSession, reorderWorkspaceTabs, serializeWorkspaceSession, type WorkspaceSession, type WorkspaceTarget } from "../lib/workspaceTabs";
import { flushAllPending, useNotesStore, type View } from "./notes";
import { useToastStore } from "./toasts";

const SESSION_KEY = "synapse-workspace-session-v1";
const UI_KEY = "synapse-workspace-ui-v1";
const id = () => crypto.randomUUID();
function loadUi() {
  try { return JSON.parse(localStorage.getItem(UI_KEY) ?? "{}"); } catch { return {}; }
}
function loadSession() {
  try { return parseWorkspaceSession(localStorage.getItem(SESSION_KEY), id()); } catch { return emptySession(id()); }
}
export const defaultSidebarWidth = () => Math.min(860, Math.max(240, window.innerWidth * 0.445 - 56));
export const clampSidebarWidth = (width: number) => Math.min(Math.max(240, window.innerWidth - 368), Math.max(220, width));
type SidePane = "files" | "search" | "bookmarks";
type FileSort = "name" | "modified" | "created";
type State = WorkspaceSession & {
  pending: boolean;
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarPane: SidePane;
  rightVisible: boolean;
  fileSort: FileSort;
  vaultLabel: string;
  helpVisible: boolean;
  openNote: (noteId: string, newTab?: boolean) => Promise<void>;
  openView: (view: View) => Promise<void>;
  newTab: () => Promise<void>;
  activateTab: (id: string) => Promise<void>;
  closeTab: (id?: string) => Promise<void>;
  closeOtherTabs: () => void;
  reorder: (source: string, before: string) => void;
  toggleSidebar: () => void;
  showSidebar: (pane?: SidePane) => void;
  setSidebarWidth: (width: number) => void;
  toggleRight: () => void;
  setFileSort: (sort: FileSort) => void;
  setVaultLabel: (label: string) => void;
  showHelp: (value: boolean) => void;
  restore: () => Promise<void>;
};
let bridgePaused = false;
let intent = 0;
let queue: Promise<void> = Promise.resolve();

async function applyTarget(target: WorkspaceTarget) {
  const notes = useNotesStore.getState();
  await flushAllPending();
  if (target.kind === "note") {
    await notes.selectNote(target.noteId);
    if (!useNotesStore.getState().activeNote) throw new Error(t("Не удалось открыть заметку"));
    useNotesStore.getState().setView("notes");
  } else {
    if (target.kind === "empty" || target.view === "notes") await notes.closeActiveNote();
    useNotesStore.getState().setView(target.kind === "empty" ? "notes" : target.view);
  }
}

/** Serialize reads and flushes. Only the latest queued navigation is applied. */
function navigate(next: WorkspaceSession): Promise<void> {
  next = { tabs: next.tabs, activeTabId: next.activeTabId };
  const mine = ++intent;
  useWorkspaceStore.setState({ pending: true });
  queue = queue.catch(() => {}).then(async () => {
    if (mine !== intent) return;
    bridgePaused = true;
    const previous = activeWorkspaceTab(useWorkspaceStore.getState()).target;
    try {
      await applyTarget(activeWorkspaceTab(next).target);
      if (mine === intent) useWorkspaceStore.setState(next);
    } catch (error) {
      useToastStore.getState().push(error instanceof Error ? error.message : t("Не удалось открыть заметку"), "error");
      await applyTarget(previous).catch(() => {});
    } finally {
      bridgePaused = false;
      if (mine === intent) useWorkspaceStore.setState({ pending: false });
    }
  });
  return queue;
}

const ui = loadUi();
export const useWorkspaceStore = create<State>((set, get) => ({
  ...loadSession(), pending: false,
  sidebarVisible: typeof ui.sidebarVisible === "boolean" ? ui.sidebarVisible : window.innerWidth >= 760,
  sidebarWidth: Number.isFinite(ui.sidebarWidth) ? clampSidebarWidth(ui.sidebarWidth) : defaultSidebarWidth(),
  sidebarPane: ["files", "search", "bookmarks"].includes(ui.sidebarPane) ? ui.sidebarPane : "files",
  rightVisible: ui.rightVisible === true,
  fileSort: ["name", "modified", "created"].includes(ui.fileSort) ? ui.fileSort : "name",
  vaultLabel: typeof ui.vaultLabel === "string" && ui.vaultLabel.trim() ? ui.vaultLabel.slice(0, 80) : "Synapse Vault",
  helpVisible: false,
  openNote: (noteId, newTab = false) => navigate(openWorkspaceTarget(get(), { kind: "note", noteId }, id(), newTab)),
  openView: (view) => navigate(openWorkspaceTarget(get(), { kind: "view", view }, id(), true)),
  newTab: () => {
    const tab = { id: id(), target: { kind: "empty" as const } };
    return navigate({ tabs: [...get().tabs, tab].slice(-40), activeTabId: tab.id });
  },
  activateTab: (tabId) => get().tabs.some(tab => tab.id === tabId) ? navigate({ tabs: get().tabs, activeTabId: tabId }) : Promise.resolve(),
  closeTab: (tabId = get().activeTabId) => {
    const next = closeWorkspaceTab(get(), tabId, id());
    if (tabId !== get().activeTabId) { set(next); return Promise.resolve(); }
    return navigate(next);
  },
  closeOtherTabs: () => set(state => ({ tabs: [activeWorkspaceTab(state)] })),
  reorder: (source, before) => set(reorderWorkspaceTabs(get(), source, before)),
  toggleSidebar: () => set(state => ({ sidebarVisible: !state.sidebarVisible })),
  showSidebar: (pane = "files") => set({ sidebarVisible: true, sidebarPane: pane }),
  setSidebarWidth: width => set({ sidebarWidth: clampSidebarWidth(width) }),
  toggleRight: () => set(state => ({ rightVisible: !state.rightVisible })),
  setFileSort: fileSort => set({ fileSort }),
  setVaultLabel: vaultLabel => set({ vaultLabel: vaultLabel.trim().slice(0, 80) || "Synapse Vault" }),
  showHelp: helpVisible => set({ helpVisible }),
  restore: async () => {
    const state = get();
    const available = new Set(flattenNotes(useNotesStore.getState().tree).map(note => note.id));
    const tabs = state.tabs.map(tab => tab.target.kind === "note" && !available.has(tab.target.noteId) ? { ...tab, target: { kind: "empty" as const } } : tab);
    await navigate({ tabs, activeTabId: state.activeTabId });
  },
}));

useWorkspaceStore.subscribe(state => {
  try {
    localStorage.setItem(SESSION_KEY, serializeWorkspaceSession(state));
    const { sidebarVisible, sidebarWidth, sidebarPane, rightVisible, fileSort, vaultLabel } = state;
    localStorage.setItem(UI_KEY, JSON.stringify({ sidebarVisible, sidebarWidth, sidebarPane, rightVisible, fileSort, vaultLabel }));
  } catch { /* Private mode and quota do not block navigation. */ }
});

/** Other screens keep using the note store; their navigation enters the active tab. */
export function connectWorkspaceNavigation(): () => void {
  return useNotesStore.subscribe((state, previous) => {
    if (bridgePaused || (state.view === previous.view && state.activeId === previous.activeId)) return;
    const target: WorkspaceTarget = state.view === "notes" && state.activeId ? { kind: "note", noteId: state.activeId } : { kind: "view", view: state.view };
    useWorkspaceStore.setState(openWorkspaceTarget(useWorkspaceStore.getState(), target, id()));
  });
}
