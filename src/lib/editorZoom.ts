export const EDITOR_ZOOM_KEY = "editor-zoom";
export const EDITOR_SCALE_PROFILE_KEY = "editor-scale-profile";
export const EDITOR_SCALE_PROFILE = "obsidian-live-26-v1";

export function readEditorZoom(storage: Pick<Storage, "getItem">): number {
  // An old relative zoom must not multiply the newly matched Obsidian base.
  if (storage.getItem(EDITOR_SCALE_PROFILE_KEY) !== EDITOR_SCALE_PROFILE) return 1;
  const zoom = Number(storage.getItem(EDITOR_ZOOM_KEY));
  return Number.isFinite(zoom) && zoom >= .7 && zoom <= 2 ? zoom : 1;
}

export function persistEditorZoom(storage: Pick<Storage, "setItem">, zoom: number): void {
  storage.setItem(EDITOR_ZOOM_KEY, String(zoom));
  storage.setItem(EDITOR_SCALE_PROFILE_KEY, EDITOR_SCALE_PROFILE);
}
