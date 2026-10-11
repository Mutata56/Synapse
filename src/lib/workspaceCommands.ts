export type WorkspaceCommand = "new-tab" | "close-tab" | "new-note" | "new-database" | "new-canvas" | "quick-switcher" | "toggle-sidebar" | "toggle-context" | "settings" | "help" | "quit-app";
export const WORKSPACE_COMMAND_EVENT = "synapse-workspace-command";
export const QUICK_SWITCHER_EVENT = "synapse-open-quick-switcher";
export function workspaceCommand(command: WorkspaceCommand) {
  window.dispatchEvent(new CustomEvent(WORKSPACE_COMMAND_EVENT, { detail: command }));
}
export const WORKSPACE_REVEAL_NOTE_EVENT = "synapse-reveal-workspace-note";
