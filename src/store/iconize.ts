import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import { coerceIconizeSettings, emptyIconizeState, iconKey, importIconizeData, recentIconSettings, validIconPath, type CustomIcon, type IconAssignment, type IconKind, type IconizeSettings, type IconizeState } from "../lib/iconize";
import { readIconizeData, subscribeIconizeData, updateIconizeData } from "../lib/storage";
import { sanitizeIconSvg } from "../lib/iconizeCatalog";
import { useToastStore } from "./toasts";
import { t } from "../lib/i18n";

type ImportResult = { data: unknown; icons: CustomIcon[] };
type Store = {
  data: IconizeState; loaded: boolean; error: string | null;
  picker: { targets: { kind: IconKind; path: string }[]; current?: IconAssignment; copyMode?: boolean; onPick?: (icon: string, appearance: { color: string | null; inherit: boolean }) => void | Promise<void> } | null;
  openPicker: (request: NonNullable<Store["picker"]>) => void; closePicker: () => void;
  assignMany: (targets: { kind: IconKind; path: string }[], value: IconAssignment | undefined) => Promise<void>;
  load: () => Promise<void>;
  assign: (kind: IconKind, path: string, value: IconAssignment | undefined) => Promise<void>;
  configure: (patch: Partial<IconizeSettings>) => Promise<void>;
  remember: (icon: string) => Promise<void>;
  importVault: (path?: string) => Promise<number>;
  addIcons: (icons: CustomIcon[]) => Promise<void>;
  removePack: (pack: string) => Promise<void>;
};
function cleanIcons(icons: CustomIcon[]): CustomIcon[] {
  return icons.flatMap(icon => { const svg = icon.svg ? sanitizeIconSvg(icon.svg) : ""; const png = typeof icon.png === "string" && icon.png.length < 2800000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(icon.png) ? icon.png : undefined; return (svg || png) && /^[A-Za-z][\w-]{0,127}$/.test(icon.id) ? [{ ...icon, svg: svg || "", png }] : []; });
}
async function transaction(update: (data: IconizeState) => IconizeState): Promise<void> {
  try { await updateIconizeData(update); useIconizeStore.setState({ error: null }); }
  catch (error) { const message = t("Не удалось сохранить Iconize"); useIconizeStore.setState({ error: message }); useToastStore.getState().push(message, "error"); throw error; }
}
let loading: Promise<void> | null = null;
export const useIconizeStore = create<Store>((set, get) => ({
  data: emptyIconizeState(), loaded: false, error: null, picker: null,
  openPicker: picker => set({ picker }), closePicker: () => set({ picker: null }),
  load: async () => {
    if (get().loaded) return;
    if (loading) return loading;
    loading = (async () => {
      try {
        const data = await readIconizeData(); set({ data, loaded: true });
        if (!data.imported && isTauri()) await get().importVault();
      } catch (error) { set({ error: t("Не удалось загрузить Iconize"), loaded: false }); console.error("Iconize load:", error); }
    })();
    try { await loading; } finally { loading = null; }
  },
  assign: async (kind, path, value) => {
    if (!validIconPath(path)) throw new Error("Invalid icon target");
    await transaction(data => {
      const assignments = { ...data.assignments }, key = iconKey(kind, path);
      if (value === undefined) delete assignments[key]; else assignments[key] = value;
      return { ...data, assignments, settings: value?.icon ? recentIconSettings(data.settings, value.icon) : data.settings };
    });
  },
  assignMany: (targets, value) => transaction(data => {
    const assignments = { ...data.assignments };
    for (const { kind, path } of targets) {
      if (!validIconPath(path)) throw new Error("Invalid icon target");
      const key = iconKey(kind, path); if (value === undefined) delete assignments[key]; else assignments[key] = value;
    }
    return { ...data, assignments, settings: value?.icon ? recentIconSettings(data.settings, value.icon) : data.settings };
  }),
  configure: patch => transaction(data => ({ ...data, settings: coerceIconizeSettings({ ...data.settings, ...patch }) })),
  remember: icon => transaction(data => ({ ...data, settings: recentIconSettings(data.settings, icon) })),
  importVault: async path => {
    const imported = await invoke<ImportResult | null>("read_iconize_import", { vaultPath: path ?? null });
    if (!imported) { if (path) throw new Error(t("Iconize не найден в выбранном хранилище")); return 0; }
    const icons = cleanIcons(imported.icons);
    await transaction(data => {
      const next = importIconizeData(imported.data, data);
      next.customIcons = [...new Map([...icons, ...data.customIcons].map(icon => [icon.id, icon])).values()];
      return next;
    });
    return Object.keys(get().data.assignments).length;
  },
  addIcons: icons => transaction(data => ({ ...data, customIcons: [...new Map([...data.customIcons, ...cleanIcons(icons)].map(icon => [icon.id, icon])).values()] })),
  removePack: pack => transaction(data => ({ ...data, customIcons: data.customIcons.filter(icon => icon.pack !== pack) })),
}));
subscribeIconizeData(data => useIconizeStore.setState({ data }));
