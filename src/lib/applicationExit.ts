import { invoke } from "@tauri-apps/api/core";
import { flushAllPending } from "../store/notes";
import { useTasksStore } from "../store/tasks";

let pendingExit: Promise<void> | null = null;

/** The task store outlives Calendar. Its durable queue has no navigation timeout. */
export function exitAfterSaving(): Promise<void> {
  if (pendingExit) return pendingExit;
  pendingExit = (async () => {
    try {
      await flushAllPending();
      await useTasksStore.getState().flush();
      await invoke("exit_application");
    } finally { pendingExit = null; }
  })();
  return pendingExit;
}
