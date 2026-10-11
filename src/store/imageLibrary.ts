import { create } from "zustand";
import { listImageLibrary } from "../lib/storage";
import type { ImageFilter, ImageLibrary, LibraryImage } from "../lib/imageLibrary";

type State = {
  library: ImageLibrary | null; loading: boolean; error: boolean;
  filter: ImageFilter; mode: "grid" | "list"; focusedId: string | null;
  setFilter: (patch: Partial<ImageFilter>) => void;
  setMode: (mode: "grid" | "list") => void;
  focus: (id: string) => void;
  refresh: (loader?: () => Promise<ImageLibrary>) => Promise<void>;
};
let refreshing: Promise<void> | null = null;
function reuseImages(before: LibraryImage[], after: LibraryImage[]) {
  const previous = new Map(before.map((image) => [image.id, image]));
  const merged = after.map((image) => {
    const old = previous.get(image.id);
    return old && old.url === image.url && old.name === image.name && old.folder === image.folder && old.managed === image.managed && old.modifiedAt === image.modifiedAt && old.sizeBytes === image.sizeBytes && old.usedBy.length === image.usedBy.length && old.usedBy.every((usage, i) => usage.id === image.usedBy[i].id && usage.title === image.usedBy[i].title && usage.folder === image.usedBy[i].folder) ? old : image;
  });
  return before.length === merged.length && before.every((image, i) => image === merged[i]) ? before : merged;
}

export const useImageLibraryStore = create<State>((set) => ({
  library: null, loading: false, error: false,
  filter: { query: "", scope: "all", folder: null, format: "", sort: "modified" }, mode: "grid", focusedId: null,
  setFilter: (patch) => set((state) => ({ filter: { ...state.filter, ...patch } })),
  setMode: (mode) => set({ mode }), focus: (focusedId) => set({ focusedId }),
  refresh: (loader = listImageLibrary) => {
    if (refreshing) return refreshing;
    set({ loading: true, error: false });
    refreshing = Promise.resolve().then(loader).then((library) => set((state) => ({ library: { ...library, images: state.library ? reuseImages(state.library.images, library.images) : library.images } })))
      .catch(() => { set({ error: true }); })
      .finally(() => { refreshing = null; set({ loading: false }); });
    return refreshing;
  },
}));
