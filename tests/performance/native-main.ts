import { useNotesStore } from "../../src/store/notes";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { metrics, measureFrames, publish } from "./probe";

if (getCurrentWindow().label === "main") {
  useNotesStore.setState({ view: "files" });
  for (const name of ["refreshTree", "refreshTrash", "batchMove", "batchTrash", "batchRestoreTrash", "undo", "redo"] as const) {
    const original = useNotesStore.getState()[name] as (...args: unknown[]) => Promise<unknown>;
    const measured = async (...args: unknown[]) => {
      const started = performance.now(); let ok = false;
      try { const result = await original(...args); ok = true; return result; }
      finally {
        metrics.actions.push({ name, ms: performance.now() - started, ok, count: Array.isArray(args[0]) ? args[0].length : undefined });
        publish(`action:${name}`);
      }
    };
    // Benchmark wrappers retain the real store and real Tauri filesystem.
    useNotesStore.setState({ [name]: measured } as Parameters<typeof useNotesStore.setState>[0]);
  }
  useNotesStore.subscribe((state, previous) => {
    if (state.view !== previous.view) { metrics.views.push(state.view); measureFrames(); }
  });
  for (const event of ["wheel", "keydown", "pointerdown"])
    document.addEventListener(event, measureFrames, { passive: true });
  setTimeout(() => publish("startup-settled"), 2500);
}
void import("../../src/main");
