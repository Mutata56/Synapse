/** Cmd opens an article in a tab; Ctrl and the selection mode select rows. */
export function noteClickAction(event: { metaKey: boolean; ctrlKey: boolean }, selecting = false): "new-tab" | "select" | "open" {
  if (event.metaKey) return "new-tab";
  return selecting || event.ctrlKey ? "select" : "open";
}
