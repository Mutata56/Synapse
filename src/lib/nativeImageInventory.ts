import * as core from "@tauri-apps/api/core";

export type InventoryFile = { path: string; mtime: number; size: number };
export type NativeImageInventory = { images: InventoryFile[]; notes: InventoryFile[]; complete: boolean };

/** One metadata-only native request instead of an IPC per directory/file.
 * Fixtures and older hosts retain the filesystem adapter; real scan failures
 * propagate so incomplete data cannot enable cleanup. */
export async function readNativeImageInventory(): Promise<NativeImageInventory | null> {
  const isNative = Reflect.get(core, "isTauri") as (() => boolean) | undefined;
  const invoke = Reflect.get(core, "invoke") as typeof core.invoke | undefined;
  if (!isNative?.() || !invoke) return null;
  try { return await invoke<NativeImageInventory>("image_inventory"); }
  catch (error) {
    if (/command[^\n]*image_inventory[^\n]*not found|unknown command[^\n]*image_inventory/i.test(String(error))) return null;
    throw error;
  }
}
