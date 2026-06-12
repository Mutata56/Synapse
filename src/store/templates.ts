// src/store/templates.ts
//
// Маленький zustand-стор, держит кэш шаблонов и флаг модалки выбора. Отдельно
// от `notes.ts`, чтобы фича шаблонов не раздувала и так большой стор заметок,
// и чтобы подписчики (TemplateChipRow, TemplatePicker) подписывались только на
// свой кусок и не перерисовывались при каждом сохранении заметки.

import { create } from "zustand";
import {
  deleteTemplate as deleteTemplateFs,
  listTemplates,
  readTemplate,
  renameTemplate as renameTemplateFs,
  saveTemplate,
  slugifyTemplateName,
  templateSlugExists,
  type TemplateMeta,
} from "../lib/templates";
import { t } from "../lib/i18n";
import { confirmDialog, promptDialog } from "./confirm";
import { reportError, useNotesStore } from "./notes";
import { useToastStore } from "./toasts";

/** Режим модалки. `null` = закрыта. `pick` = применяет выбранный шаблон к
 *  активной заметке. `manage` = та же модалка, но с кнопками переименования и
 *  удаления. */
export type TemplatePickerMode = "pick" | "manage" | null;

type TemplatesState = {
  templates: TemplateMeta[];
  /** Ставится true после первого `refresh()` (успех или ошибка). Чтобы
   *  чип- строка не мигала пустым состоянием при первой загрузке. */
  loaded: boolean;
  pickerMode: TemplatePickerMode;

  refresh: () => Promise<void>;
  openTemplatePicker: (mode: Exclude<TemplatePickerMode, null>) => void;
  closeTemplatePicker: () => void;

  /** Сохраняет активную заметку как новый шаблон. Спрашивает имя, при совпадении
   *  слага спрашивает подтверждение перезаписи. Все ошибки через reportError
   *  (тост + лог), без тихого проглатывания. Ничего не делает, если нет активной
   *  заметки или тело пустое (тост "пусто"). */
  saveCurrentAsTemplate: () => Promise<void>;

  /** Переименовывает шаблон на месте (тот же slug/файл). Инлайн-переименование
   *  в модалке управления идет через это, чтобы кэш оставался актуальным. */
  renameTemplate: (id: string, newName: string) => Promise<void>;

  /** Удаляет шаблон после подтверждения в стиле "опасно". */
  deleteTemplate: (meta: TemplateMeta) => Promise<void>;

  /** Применяет шаблон к текущей активной заметке (пишет тело шаблона +
   *  блокнот JSON без потерь в активную заметку через saveNote, потом бампит
   *  editorReloadNonce, чтобы редактор перезагрузил документ). Ничего не делает,
   *  если нет активной заметки. Закрывает модалку при успехе. */
  applyTemplateToActiveNote: (templateId: string) => Promise<void>;
};

export const useTemplatesStore = create<TemplatesState>((set, get) => ({
  templates: [],
  loaded: false,
  pickerMode: null,

  refresh: async () => {
    try {
      const templates = await listTemplates();
      set({ templates, loaded: true });
    } catch (e) {
      console.error("templates: refresh failed:", e);
      // Все равно ставим `loaded`, чтобы UI спрятал скелетон, а не висел на
      // нем вечно при временной ошибке ФС. Следующий вызов повторит попытку.
      set({ loaded: true });
    }
  },

  openTemplatePicker: (mode) => set({ pickerMode: mode }),
  closeTemplatePicker: () => set({ pickerMode: null }),

  saveCurrentAsTemplate: async () => {
    const active = useNotesStore.getState().activeNote;
    if (!active) {
      useToastStore.getState().push(t("Нет открытой заметки"), "error");
      return;
    }
    if (!active.content.trim()) {
      useToastStore
        .getState()
        .push(t("Заметка пуста , нечего сохранять как шаблон"), "error");
      return;
    }
    let name: string | null;
    try {
      name = await promptDialog(t("Название шаблона"), {
        defaultValue: active.title?.trim() || t("Без названия"),
        placeholder: t("Например, Итоги недели"),
        confirmLabel: t("Сохранить"),
      });
    } catch (e) {
      reportError(
        "Не удалось открыть диалог",
        "saveCurrentAsTemplate: promptDialog failed:",
        e,
      );
      return;
    }
    if (name === null) return; // user cancelled
    const trimmed = name.trim();
    if (!trimmed) {
      useToastStore.getState().push(t("Название не может быть пустым"), "error");
      return;
    }

    const slug = slugifyTemplateName(trimmed);
    try {
      if (await templateSlugExists(slug)) {
        const ok = await confirmDialog(
          t(`Шаблон «${trimmed}» уже существует. Перезаписать?`),
          { confirmLabel: t("Перезаписать"), danger: true },
        );
        if (!ok) return;
      }
      await saveTemplate({
        id: `.templates/${slug}`,
        name: trimmed,
        // Иконка копируется, Обложка намеренно не копируется
        icon: active.icon ?? null,
        content: active.content,
        blocknote: active.blocknote ?? null,
        bnHash: active.bnHash ?? null,
      });
      await get().refresh();
      useToastStore.getState().push(t("Шаблон сохранён"), "success");
    } catch (e) {
      reportError(
        "Не удалось сохранить шаблон",
        "saveCurrentAsTemplate failed:",
        active.id,
        e,
      );
    }
  },

  renameTemplate: async (id, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      useToastStore.getState().push(t("Название не может быть пустым"), "error");
      return;
    }
    try {
      await renameTemplateFs(id, trimmed);
      await get().refresh();
      useToastStore.getState().push(t("Шаблон переименован"), "success");
    } catch (e) {
      reportError(
        "Не удалось переименовать шаблон",
        "renameTemplate failed:",
        id,
        e,
      );
    }
  },

  deleteTemplate: async (meta) => {
    const ok = await confirmDialog(t(`Удалить шаблон «${meta.name}»?`), {
      confirmLabel: t("Удалить"),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteTemplateFs(meta.id);
      await get().refresh();
      useToastStore.getState().push(t("Шаблон удалён"), "success");
    } catch (e) {
      reportError(
        "Не удалось удалить шаблон",
        "deleteTemplate failed:",
        meta.id,
        e,
      );
    }
  },

  applyTemplateToActiveNote: async (templateId) => {
    const notesStore = useNotesStore.getState();
    const active = notesStore.activeNote;
    if (!active) {
      useToastStore.getState().push(t("Нет открытой заметки"), "error");
      return;
    }
    try {
      const tpl = await readTemplate(templateId);
      if (!tpl) {
        reportError(
          t("Шаблон не найден"),
          "applyTemplateToActiveNote: readTemplate returned null:",
          templateId,
        );
        return;
      }
      // функция сериализует + обновляет кэш дерева. Потом бампаем
      // editorReloadNonce, чтобы редактор перезагрузил документ с новым
      // содержимым (иначе, если activeId не изменился, он пропустит загрузку).
      await notesStore.saveNote({
        content: tpl.content,
        blocknote: tpl.blocknote,
        bnHash: tpl.bnHash,
      });
      useNotesStore.setState((s) => ({
        editorReloadNonce: s.editorReloadNonce + 1,
      }));
      set({ pickerMode: null });
      useToastStore.getState().push(t("Шаблон применён"), "success");
    } catch (e) {
      reportError(
        "Не удалось применить шаблон",
        "applyTemplateToActiveNote failed:",
        templateId,
        e,
      );
    }
  },
}));
