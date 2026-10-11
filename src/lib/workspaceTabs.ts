import type { View } from "../store/notes";

export type WorkspaceTarget = { kind: "empty" } | { kind: "note"; noteId: string } | { kind: "view"; view: View };
export type WorkspaceTab = { id: string; target: WorkspaceTarget };
export type WorkspaceSession = { tabs: WorkspaceTab[]; activeTabId: string };
const VIEWS = new Set<View>(["notes", "graph", "calendar", "trash", "images", "files", "tags", "inbox", "settings", "overview"]);
export const MAX_WORKSPACE_TABS = 40;

export function emptySession(id: string): WorkspaceSession {
  return { tabs: [{ id, target: { kind: "empty" } }], activeTabId: id };
}

export function sameTarget(a: WorkspaceTarget, b: WorkspaceTarget): boolean {
  return a.kind === b.kind && (a.kind === "empty" || (a.kind === "note" && b.kind === "note" && a.noteId === b.noteId) || (a.kind === "view" && b.kind === "view" && a.view === b.view));
}

export function activeWorkspaceTab(session: WorkspaceSession): WorkspaceTab {
  return session.tabs.find(tab => tab.id === session.activeTabId) ?? session.tabs[0];
}

export function openWorkspaceTarget(session: WorkspaceSession, target: WorkspaceTarget, id: string, newTab = false): WorkspaceSession {
  const existing = target.kind !== "empty" && (target.kind !== "note" || !newTab) ? session.tabs.find(tab => sameTarget(tab.target, target)) : undefined;
  if (existing) return existing.id === session.activeTabId ? session : { tabs: session.tabs, activeTabId: existing.id };
  const active = activeWorkspaceTab(session);
  if (!newTab || active.target.kind === "empty") {
    if (sameTarget(active.target, target)) return session;
    return { activeTabId: session.activeTabId, tabs: session.tabs.map(tab => tab.id === active.id ? { ...tab, target } : tab) };
  }
  const tabs = [...session.tabs, { id, target }];
  if (tabs.length > MAX_WORKSPACE_TABS) tabs.shift();
  return { tabs, activeTabId: id };
}

export function closeWorkspaceTab(session: WorkspaceSession, id: string, replacementId: string): WorkspaceSession {
  const index = session.tabs.findIndex(tab => tab.id === id);
  if (index < 0) return session;
  const tabs = session.tabs.filter(tab => tab.id !== id);
  if (!tabs.length) return emptySession(replacementId);
  return { tabs, activeTabId: session.activeTabId === id ? tabs[Math.min(index, tabs.length - 1)].id : session.activeTabId };
}

export function reorderWorkspaceTabs(session: WorkspaceSession, source: string, before: string): WorkspaceSession {
  if (source === before || !session.tabs.some(tab => tab.id === source) || !session.tabs.some(tab => tab.id === before)) return session;
  const tab = session.tabs.find(tab => tab.id === source)!;
  const tabs = session.tabs.filter(item => item.id !== source);
  tabs.splice(tabs.findIndex(item => item.id === before), 0, tab);
  return { activeTabId: session.activeTabId, tabs };
}

/** Session metadata contains destinations only, never document content. */
export function parseWorkspaceSession(raw: string | null, fallbackId: string): WorkspaceSession {
  if (!raw) return emptySession(fallbackId);
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.tabs)) return emptySession(fallbackId);
    const ids = new Set<string>();
    const tabs: WorkspaceTab[] = [];
    for (const tab of value.tabs.slice(0, MAX_WORKSPACE_TABS)) {
      if (!tab || typeof tab.id !== "string" || !tab.id || tab.id.length > 128 || ids.has(tab.id)) continue;
      const target = tab.target;
      if (!target || !(target.kind === "empty" || (target.kind === "note" && typeof target.noteId === "string" && target.noteId.length > 0 && target.noteId.length < 2048 && !target.noteId.includes("\0")) || (target.kind === "view" && VIEWS.has(target.view)))) continue;
      ids.add(tab.id); tabs.push({ id: tab.id, target: target.kind === "note" ? { kind: "note", noteId: target.noteId } : target.kind === "view" ? { kind: "view", view: target.view } : { kind: "empty" } });
    }
    if (!tabs.length) return emptySession(fallbackId);
    return { tabs, activeTabId: ids.has(value.activeTabId) ? value.activeTabId : tabs[0].id };
  } catch { return emptySession(fallbackId); }
}

export function serializeWorkspaceSession(session: WorkspaceSession): string {
  return JSON.stringify({ version: 1, tabs: session.tabs, activeTabId: session.activeTabId });
}
