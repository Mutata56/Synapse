import { join } from "@tauri-apps/api/path";
import { getWorkspaceDir } from "./storage";

export type WorkspacePathFormat = "absolute" | "relative";
type PathEntry = { kind: "note" | "folder"; path: string };

/** Note IDs are filenames without .md; headings are not filesystem paths. */
export async function copyWorkspacePaths(
  entries: readonly PathEntry[],
  format: WorkspacePathFormat,
  trashed = false,
): Promise<void> {
  if (!entries.length) return;
  const relative = entries.map(entry => `${trashed ? ".trash/" : ""}${entry.path}${entry.kind === "note" ? ".md" : ""}`);
  let paths = relative;
  if (format === "absolute") {
    const root = await getWorkspaceDir();
    paths = await Promise.all(relative.map(path => join(root, ...path.split("/"))));
  }
  const value = paths.join("\n");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Native webviews can expose Clipboard API but reject its permission.
  }
  const focused = document.activeElement;
  const element = document.createElement("textarea");
  element.value = value;
  element.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  element.tabIndex = -1;
  document.body.appendChild(element);
  element.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    element.remove();
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
  }
}
