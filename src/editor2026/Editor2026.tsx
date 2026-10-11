// src/editor2026/Editor2026.tsx
//
// Активный редактор заметок. Владеет экземпляром BlockNote, заголовком
// заметки, save/load, зумом, slash-меню, панелью форматирования и
// кастомными блоками (выноски, галерея, dataTable, multi-column, whiteboard).
// Загрузка документа идет через ./loadDocument, который деградирует
// неизвестные типы блоков и защищает replaceBlocks markdown-фолбэком.

import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import {
  getMultiColumnSlashMenuItems,
  locales as multiColumnLocales,
  multiColumnDropCursor,
} from "@blocknote/xl-multi-column";
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  FileText,
  Images,
  Paperclip,
  PenTool,
  Table,
} from "lucide-react";
import { TextSelection, type Transaction } from "prosemirror-state";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Backlinks } from "../components/Backlinks";
import { LocalGraphWebGL as LocalGraph } from "./LocalGraphWebGL";
import { NoteHero } from "../components/NoteHero";
import { persistEditorZoom, readEditorZoom } from "../lib/editorZoom";
import { UnlinkedMentions } from "../components/UnlinkedMentions";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { importAssetBytes } from "../lib/storage";
import { tagExtension } from "../lib/tags";
import { flattenNotes } from "../lib/treeUtils";
import { refreshWikiLinks, wikiLinkExtension } from "../lib/wikiLink";
import { iconizeExtension } from "../lib/iconizeExtension";
import { registerFlusher, useNotesStore } from "../store/notes";
import { FormattingToolbar2026 } from "./chrome/FormattingToolbar2026";
import { debugExtension, dlog, E26_DEBUG } from "./lib/debug";
import {
  applyDocument,
  hashString,
  isEmptyDoc,
  parseNoteToBlocks,
} from "./loadDocument";
import { getNotesSchema } from "./schema";
import { bindImportedMap, loadImportedMarkdown, saveImportedMarkdown, type ImportedBlock, type ImportedSourceMap } from "./importedMarkdown";
import { blocksToNoteMarkdown } from "../lib/noteBlockMarkdown";
import { CALLOUT_LABELS, CALLOUT_TYPES, TASK_STATES } from "../lib/noteBlockTypes";
import { calloutIcon, TaskIcon } from "../components/NoteBlockUI";
import { TemplateChipRow } from "./TemplateChipRow";
import { buildWikiLinkItems } from "./wikiLink2026";
import { tryHandleImagePaste } from "./lib/pasteImages";
import {
  portablizeBlocks,
  resolveAssetUrl,
  toPortableAssetRef,
} from "./lib/assets";

/** Задержка перед сохранением содержимого BlockNote на диск. */
const CONTENT_SAVE_DEBOUNCE_MS = 400;

/** Извлекает расширение (без точки) из имени файла. */
const FILE_EXT_REGEX = /\.([a-zA-Z0-9]+)$/;
const FALLBACK_EXT = "bin";

const EMPTY_STATE_EASE = [0.16, 1, 0.3, 1] as const;

// ─── Схема редактора ──────────────────────────────────────────────────────
// Схема 2026 (встроенные + codeBlock; новые блоки добавляются по фазам).
// Синглтон на уровне модуля, чистое описание, не мутируется.
const schema = getNotesSchema();

/**
 * Upload-хендлер BlockNote, направляет каждое перетащенное/вставленное
 * изображение через пайплайн дедупликации ассетов по SHA и возвращает
 * ПОРТАБЕЛЬНУЮ ссылку `.assets/<имя>`. На уровне модуля, чтобы замыкание было
 * стабильным между ре-рендерами.
 *
 * Возвращаем портабельную, а не абсолютную ссылку нарочно: она и ложится в проп
 * блока, и уезжает на диск, так что в заметке нет привязки к пути конкретной ОС
 * (важно для бэкапа между системами). В рабочий URL для показа её разворачивает
 * resolveFileUrl ниже.
 */
async function uploadDroppedFile(file: File): Promise<string> {
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const ext =
      file.name.match(FILE_EXT_REGEX)?.[1] ??
      file.type.split("/")[1] ??
      FALLBACK_EXT;
    const { url } = await importAssetBytes(buf, ext);
    return toPortableAssetRef(url);
  } catch (e) {
    console.error("Editor2026: dropped file import failed:", e);
    throw e;
  }
}

// ─── Компонент ─────────────────────────────────────────────────────────────

/** Реактивное совпадение CSS media-query (например, ширина для боковых полей). */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export type ImportedEditorBridge = {
  dirty?: boolean; source: string; blocknote?: string | null; sourceMap?: string | null;
  onDraft: (blocks: ImportedBlock[], map: ImportedSourceMap) => void;
  onSave: (source: string, blocknote: string, sourceMap: string) => Promise<void>;
  onReady: (flush: (() => Promise<void>) | null) => void;
};

export function Editor2026({ imported }: { imported?: ImportedEditorBridge } = {}) {
  const activeNote = useNotesStore((s) => s.activeNote);
  const activeId = useNotesStore((s) => s.activeId);
  const saveNote = useNotesStore((s) => s.saveNote);
  const goBack = useNotesStore((s) => s.goBack);
  const canGoBack = useNotesStore((s) => s.backStack.length > 0);
  const tree = useNotesStore((s) => s.tree);
  const editorReloadNonce = useNotesStore((s) => s.editorReloadNonce);
  const modules = useNotesStore(state => state.settings.modules);
  const localGraphEnabled = useNotesStore(state => state.settings.modules.graph && state.settings.graph.localGraph);
  const wide = useMediaQuery("(min-width: 1600px)");

  const editor = useCreateBlockNote({
    schema,
    uploadFile: uploadDroppedFile,
    // Разворачиваем портабельную ссылку `.assets/<имя>` (и старую абсолютную из
    // ранее сохранённых заметок) в рабочий URL под текущую машину прямо при
    // показе встроенных блоков картинки/файла. На диске проп остаётся
    // портабельным, и именно это делает бэкап переносимым между ОС.
    resolveFileUrl: (url) => Promise.resolve(resolveAssetUrl(url)),
    // Multi-column: drag-cursor для создания колонок + локализация для
    // slash-пункта и хендлеров.
    dropCursor: multiColumnDropCursor,
    dictionary: { ...en, multi_column: multiColumnLocales.en },
    extensions: E26_DEBUG
      ? [wikiLinkExtension, tagExtension, iconizeExtension, debugExtension]
      : [wikiLinkExtension, tagExtension, iconizeExtension],
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  // Ctrl + колесо мыши зумит ТЕКСТ редактора (через base font-size,
  // см. обертку ниже) без transform, так что всплывающие меню
  // остаются выровненными. Сохраняется в localStorage под тем же ключом,
  // что и в старом редакторе.
  const [zoom, setZoom] = useState(() => readEditorZoom(localStorage));
  useEffect(() => {
    persistEditorZoom(localStorage, zoom);
  }, [zoom]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => {
        const next = Math.round((z + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10;
        return Math.min(2, Math.max(0.7, next));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const loadedIdRef = useRef<string | null>(null);
  const loadedNonceRef = useRef(-1);
  const saveTimerRef = useRef<number | null>(null);
  const importedRef = useRef(imported);
  importedRef.current = imported;
  const importedMapRef = useRef<ImportedSourceMap | null>(null);
  const importedFlightRef = useRef<Promise<void> | null>(null);
  const importedDirtyRef = useRef(false);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Текущий документ пуст (один пустой параграф) или нет. Управляет
  // видимостью TemplateChipRow. Обновляется при загрузке документа и
  // при каждом изменении, чтобы строка шаблонов возвращалась когда
  // пользователь очищает заметку (как в Notion). Функциональный setter
  // пропускает ре-рендер если буль не изменился.
  const [isEmpty, setIsEmpty] = useState(false);
  const setEmptyIfChanged = useCallback((next: boolean) => {
    setIsEmpty((prev) => (prev === next ? prev : next));
  }, []);

  // Загружаем контент когда `activeId` становится другой заметкой (или
  // изменился nonce). Через безопасный загрузчик: неизвестные типы блоков
  // деградируют, replaceBlocks защищены markdown-фолбэком.
  useEffect(() => {
    if (!activeNote || !activeId) return;
    if (
      loadedIdRef.current === activeId &&
      loadedNonceRef.current === editorReloadNonce
    )
      return;

    let cancelled = false;
    setReadyId(null);
    (async () => {
      const bridge = importedRef.current;
      const parsed = bridge ? await loadImportedMarkdown(editor, bridge.source, bridge.blocknote, bridge.sourceMap) : null;
      const blocks = parsed ? parsed.blocks : await parseNoteToBlocks(editor, activeNote);
      if (cancelled) return;
      if (parsed) editor.replaceBlocks(editor.document, blocks as never);
      else await applyDocument(editor, schema, blocks, activeNote.content);
      if (parsed) {
        importedMapRef.current = parsed.cached ? parsed.map : bindImportedMap(parsed.map, editor.document as unknown as ImportedBlock[]);
        importedDirtyRef.current = Boolean(bridge?.dirty);
      }
      if (cancelled) return;
      loadedIdRef.current = activeId;
      loadedNonceRef.current = editorReloadNonce;
      // Отражаем форму загруженного документа, чтобы строка шаблонов
      // появлялась на пустой новой заметке и скрывалась на заполненной.
      setEmptyIfChanged(isEmptyDoc(editor.document));
      setLoadError(null);
      setReadyId(activeId);
    })().catch((error) => { if (!cancelled) setLoadError(String(error)); });

    return () => {
      cancelled = true;
    };
  }, [activeId, activeNote, editor, editorReloadNonce, setEmptyIfChanged]);

  const persistImported = useCallback(async () => {
    if (importedFlightRef.current) await importedFlightRef.current;
    const bridge = importedRef.current;
    const map = importedMapRef.current;
    if (!bridge || !map || !importedDirtyRef.current || loadedIdRef.current !== activeId) return;
    const blocks = portablizeBlocks(editor.document) as ImportedBlock[];
    const run = (async () => {
      const next = await saveImportedMarkdown(editor, map, blocks);
      await bridge.onSave(next.source, JSON.stringify(blocks), JSON.stringify(next.map));
      importedMapRef.current = next.map;
      importedDirtyRef.current = JSON.stringify(portablizeBlocks(editor.document)) !== JSON.stringify(blocks);
    })();
    importedFlightRef.current = run;
    try { await run; } finally { importedFlightRef.current = null; }
  }, [activeId, editor]);

  // Регистрируем flush-колбэк для пути сохранения-при-переключении.
  // См. Editor.tsx для аналогичного паттерна. Без этого Ctrl+K
  // в течение ~400ms после последнего нажатия молча теряет отложенное сохранение.
  useEffect(() => {
    const flush = async () => {
      if (saveTimerRef.current === null) {
        if (importedFlightRef.current) await importedFlightRef.current;
        if (importedRef.current && importedMapRef.current) await persistImported();
        return;
      }
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (loadedIdRef.current !== activeId) return;
      try {
        // Сворачиваем ссылки на ассеты к портабельной форме ПЕРЕД сохранением,
        // из тех же блоков делаем и markdown, иначе в заметку утечёт абсолютный
        // путь и бэкап не переедет на другую ОС.
        if (importedRef.current) { await persistImported(); return; }
        const blocks = portablizeBlocks(editor.document);
        const md = await blocksToNoteMarkdown(editor, blocks as never);
        if (loadedIdRef.current !== activeId) return;
        await saveNote({
          content: md,
          blocknote: JSON.stringify(blocks),
          bnHash: hashString(md),
        });
      } catch (e) {
        console.error("Editor2026: flush save failed:", e);
        if (importedRef.current) throw e;
      }
    };
    importedRef.current?.onReady(flush);
    const unregister = registerFlusher(flush);
    return () => {
      // Immediate view changes must not discard a pending editor debounce.
      void flush().catch(() => undefined);
      importedRef.current?.onReady(null);
      unregister();
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [activeId, editor, saveNote, persistImported]);

  const handleChange = useCallback(
    (
      _editor: unknown,
      ctx: { getChanges: () => readonly unknown[] },
    ) => {
      // Пропускаем транзакции без изменений блоков (например, только
      // meta-обновление refreshWikiLinks), чтобы не пересохранять заметку.
      if (ctx.getChanges().length === 0) return;
      const editingId = loadedIdRef.current;
      if (!editingId || editingId !== activeId) return;

      // Синхронизируем `isEmpty` при каждом реальном изменении, чтобы
      // строка шаблонов скрывалась с первого символа (и возвращалась
      // при удалении всего). Guarded setter пропускает React-работу
      // если буль не изменился.
      setEmptyIfChanged(isEmptyDoc(editor.document));
      if (importedMapRef.current) {
        importedDirtyRef.current = true;
        importedRef.current?.onDraft(editor.document as unknown as ImportedBlock[], importedMapRef.current);
      }

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(async () => {
        saveTimerRef.current = null;
        if (loadedIdRef.current !== editingId) return;
        try {
          // См. flush выше: портабилизируем ссылки на ассеты до сохранения.
          if (importedRef.current) { await persistImported(); return; }
          const blocks = portablizeBlocks(editor.document);
          const md = await blocksToNoteMarkdown(editor, blocks as never);
          if (loadedIdRef.current !== editingId) return;
          await saveNote({
            content: md,
            blocknote: JSON.stringify(blocks),
            bnHash: hashString(md),
          });
        } catch (e) {
          console.error("Editor2026: save failed:", e);
        }
      }, CONTENT_SAVE_DEBOUNCE_MS);
    },
    [activeId, editor, saveNote, setEmptyIfChanged, persistImported],
  );

  const insertWikiLink = useCallback(
    (rawTitle: string) => {
      const title = rawTitle.trim();
      if (!title) return;
      const view = editor.prosemirrorView;
      if (!view) return;
      const { state } = view;
      const { from } = state.selection;
      const hasOpen = from > 0 && state.doc.textBetween(from - 1, from) === "[";
      const start = hasOpen ? from - 1 : from;
      const text = `[[${title}]] `;
      const tr = state.tr.insertText(text, start, from);
      const caret = start + text.length;
      tr.setSelection(TextSelection.create(tr.doc, caret));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    },
    [editor],
  );

  // Пункты [[-попапа через buildWikiLinkItems (editor2026/wikiLink2026.ts):
  // ранжирование по алиасам + реальный пункт "создать заметку" с guard
  // от дубликатов.
  const getLinkItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
      const { tree: curTree, activeId: curId } = useNotesStore.getState();
      return buildWikiLinkItems(flattenNotes(curTree), query, curId, {
        insertWikiLink,
        createNoteByTitle: (t) =>
          void useNotesStore.getState().createNoteByTitle(t),
      });
    },
    [insertWikiLink],
  );

  // Вставка кастомного блока из slash-меню. Для блоков без контента
  // (gallery/fileCard/dataTable) курсор не может быть внутри блока,
  // поэтому добавляем пустой параграф после и перемещаем туда курсор,
  // иначе фокус залипает на атом-блоке. Callout поддерживает текст,
  // курсор остается внутри.
  const insertCustomBlock = useCallback(
    (type: string) => {
      dlog("insertCustomBlock:", type);
      // todo типизировать, сейчас as any из-за схемы BlockNote
      const inserted = insertOrUpdateBlockForSlashMenu(editor, { type } as any);
      if (type !== "callout") {
        try {
          const [para] = editor.insertBlocks(
            [{ type: "paragraph" }],
            inserted,
            "after",
          );
          if (para) editor.setTextCursorPosition(para, "start");
          dlog("insertCustomBlock: added trailing paragraph + caret");
        } catch (e) {
          console.error("Editor2026: trailing paragraph after insert failed:", e);
        }
      }
      editor.focus();
    },
    [editor],
  );

  // "/" slash-меню: встроенные пункты + наши новые блоки. Передача этого
  // контроллера отключает встроенное slash-меню BlockNote, поэтому
  // добавляем getDefaultReactSlashMenuItems обратно.
  const getSlashItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
      const calloutItems: DefaultReactSuggestionItem[] = CALLOUT_TYPES.map(kind => {
        const Icon = calloutIcon(kind);
        return { title: `${t("Выноска")}: ${t(CALLOUT_LABELS[kind])}`, subtext: t("Цветной блок с заголовком. Тип меняется через ПКМ."), aliases: ["callout", "выноска", "врезка", kind, CALLOUT_LABELS[kind].toLowerCase()], group: t("Выноски"), icon: <Icon size={18} />, onItemClick: () => {
          const block = insertOrUpdateBlockForSlashMenu(editor, { type: "callout", props: { variant: kind } });
          editor.setTextCursorPosition(block, "start"); editor.focus();
        } };
      });
      const taskItems: DefaultReactSuggestionItem[] = TASK_STATES.map(state => ({ title: `${t("Задача")}: ${t(state.label)}`, subtext: t("Статус меняется через ПКМ."), aliases: ["task", "checkbox", "задача", state.id, state.label.toLowerCase()], group: t("Задачи"), icon: <TaskIcon marker={state.marker} />, onItemClick: () => {
        const block = insertOrUpdateBlockForSlashMenu(editor, { type: "checkListItem", props: { taskStatus: state.marker, checked: state.marker === "x" } });
        editor.setTextCursorPosition(block, "start"); editor.focus();
      } }));
      const galleryItem: DefaultReactSuggestionItem = {
        title: "Галерея",
        subtext: "Несколько изображений: сетка или карусель",
        aliases: ["gallery", "галерея", "images", "изображения", "карусель"],
        group: "Медиа",
        icon: <Images size={18} />,
        onItemClick: () => insertCustomBlock("gallery"),
      };
      const fileItem: DefaultReactSuggestionItem = {
        title: "Файл",
        subtext: "Карточка вложения, открыть в системе",
        aliases: ["file", "файл", "вложение", "attachment", "pdf"],
        group: "Медиа",
        icon: <Paperclip size={18} />,
        onItemClick: () => insertCustomBlock("fileCard"),
      };
      const dataTableItem: DefaultReactSuggestionItem = {
        title: "Таблица данных",
        subtext: "Сетка с типами ячеек, сортировкой и ресайзом",
        aliases: ["table", "таблица", "база", "database", "db", "grid"],
        group: "Блоки",
        icon: <Table size={18} />,
        onItemClick: () => insertCustomBlock("dataTable"),
      };
      const whiteboardItem: DefaultReactSuggestionItem = {
        title: "Доска",
        subtext: "Бесконечный холст для рисования и схем",
        aliases: ["whiteboard", "доска", "холст", "canvas", "draw", "tldraw"],
        group: "Медиа",
        icon: <PenTool size={18} />,
        onItemClick: () => insertCustomBlock("whiteboard"),
      };
      // ВАЖНО: пункты с одинаковым `group` должны идти подряд, иначе
      // дублируются заголовки групп (React предупреждение "same key") и
      // клики ломаются. Сначала все "Блоки", потом все "Медиа".
      const items = [
        ...getDefaultReactSlashMenuItems(editor),
        ...calloutItems, ...taskItems, ...(modules.database ? [dataTableItem] : []), galleryItem, fileItem, ...(modules.canvas ? [whiteboardItem] : []),
        ...getMultiColumnSlashMenuItems(editor),
      ];
      const groups = new Map<string, DefaultReactSuggestionItem[]>();
      for (const item of items) {
        const group = item.group ?? "";
        const members = groups.get(group) ?? [];
        members.push(item);
        groups.set(group, members);
      }
      return filterSuggestionItems(Array.from(groups.values()).flat(), query);
    },
    [editor, insertCustomBlock, modules.database, modules.canvas],
  );

  // Открываем блочное меню по клику в ПУСТОЙ параграф, чтобы можно
  // было выбрать тип блока без ввода "/". Ограничено пустыми параграфами
  // и сжатым выделением, чтобы не всплывало при вводе текста. Использует
  // тот же механизм что и кнопка "+" (openSuggestionMenu расширения
  // suggestionMenu), полностью защищён.
  const openBlockMenuIfEmpty = useCallback(() => {
    // todo удалить A/B e26-clickmenu после проверки
    // A/B переключатель: `localStorage.setItem("e26-clickmenu","off")` + reload
    // для отключения клик-открытия-меню.
    if (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("e26-clickmenu") === "off"
    ) {
      dlog("openBlockMenuIfEmpty: disabled via e26-clickmenu=off");
      return;
    }
    requestAnimationFrame(() => {
      try {
        const view = editor.prosemirrorView;
        if (!view || !view.hasFocus()) return;
        const sel = view.state.selection;
        // Только для сжатого TEXT-курсора. Игнорируем NodeSelection (атомный
        // блок) или range, иначе курсор отскакивает обратно на блок.
        if (!(sel instanceof TextSelection) || !sel.empty) {
          dlog("openBlockMenuIfEmpty: skip (not an empty TextSelection)");
          return;
        }
        const $from = sel.$from;
        if (
          $from.parent.type.name !== "paragraph" ||
          $from.parent.content.size !== 0
        )
          return;
        dlog("openBlockMenuIfEmpty: pin caret + open slash menu");
        // Фиксируем курсор там где он был ПЕРЕД открытием, чтобы
        // internal editor.focus() не переместил выделение на соседний атом-блок.
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.create(view.state.doc, sel.from))
            .scrollIntoView(),
        );
        const sm = editor.extensions.get("suggestionMenu") as
          | { openSuggestionMenu?: (t: string) => void }
          | undefined;
        sm?.openSuggestionMenu?.("/");
      } catch (e) {
        console.error("Editor2026: open block menu on click failed:", e);
      }
    });
  }, [editor]);

  const shouldOpenLinks = useCallback((tr: Transaction) => {
    const { $from, from, empty } = tr.selection;
    if (!empty) return false;
    if ($from.parent.type.spec.code) return false;
    if ($from.marks().some((m) => m.type.name === "code")) return false;
    return from > 0 && tr.doc.textBetween(from - 1, from) === "[";
  }, []);

  const titlesSig = useMemo(
    () =>
      JSON.stringify(
        flattenNotes(tree)
          .map((n) => n.title.trim().toLowerCase())
          .sort(),
      ),
    [tree],
  );

  useEffect(() => {
    const view = editor.prosemirrorView;
    if (view) refreshWikiLinks(view);
  }, [titlesSig, editor]);

  if (!activeNote) {
    return <EmptyState />;
  }

  return (
    <div className="relative flex-1 flex flex-col min-w-0 min-h-0">
      {loadError ? <div className="markdown-source-error" role="alert">Не удалось открыть блоки. Ваш Markdown сохранён. {loadError}</div> : null}
      <AnimatePresence>
        {canGoBack && !imported && (
          <motion.button
            type="button"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.15, ease: EMPTY_STATE_EASE }}
            onClick={goBack}
            title={t("Назад")}
            aria-label={t("Назад")}
            className="absolute top-3 left-4 z-40 flex items-center justify-center w-8 h-8 rounded-lg bg-black/40 backdrop-blur-md border border-white/10 text-white/80 hover:text-white hover:bg-black/60 transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
          </motion.button>
        )}
      </AnimatePresence>

      <div
        ref={scrollRef}
        data-editor-scroll
        className="group/hero relative flex-1 overflow-auto"
      >
        {/* Зум масштабирует base font-size через CSS-переменную (см.
            .e26-zoom-scope в index.css). НЕ используем CSS `zoom`/`transform`:
            они смещают всплывающие меню (floating-ui читает блочные прямоугольники
            в масштабированных координатах, но записывает позиции в локальных). */}
        <div
          className="e26-zoom-scope"
          style={{ "--e26-zoom": zoom } as CSSProperties}
        >
          <NoteHero key={activeId} textZoom={zoom} />
          <TemplateChipRow visible={isEmpty} editor={editor} schema={schema} />
          <div className={cn(wide && "flex justify-center items-start gap-6 px-6")}>
            {wide && localGraphEnabled && (
              <aside
                key="mentions"
                className="w-64 shrink-0 sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto pt-6"
              >
                <Backlinks compact />
                <UnlinkedMentions compact />
              </aside>
            )}
            <div key="center" className={cn("w-full min-w-0", wide && "max-w-3xl")}>
              {/* slashMenu={false}: предоставляем СВОЙ "/" контроллер.
                  Встроенный оставил бы два slash-меню одновременно,
                  они конфликтуют и клики перестают работать. */}
              <BlockNoteView
                editor={editor}
                onChange={handleChange}
                theme="dark"
                editable={readyId === activeId && !loadError}
                slashMenu={false}
                formattingToolbar={false}
                onClick={openBlockMenuIfEmpty}
                // Вставка изображений из буфера обмена (Print Screen / Snipping Tool / Cmd+Shift+4).
                // Встроенный uploadFile BlockNote срабатывает только на File-типных
                // дропах/вставках; изображения из буфера приходят через
                // ClipboardEvent.items и требуют ручного перехвата.
                onPaste={(e) => {
                  void tryHandleImagePaste(e, editor);
                }}
              >
                <FormattingToolbar2026 />
                <SuggestionMenuController
                  triggerCharacter="["
                  getItems={getLinkItems}
                  shouldOpen={shouldOpenLinks}
                  minQueryLength={0}
                />
                <SuggestionMenuController
                  triggerCharacter="/"
                  getItems={getSlashItems}
                />
              </BlockNoteView>
              {!wide && (
                <>
                  <Backlinks />
                  <UnlinkedMentions />
                  {localGraphEnabled ? <LocalGraph /> : null}
                </>
              )}
            </div>
            {wide && localGraphEnabled && (
              <aside
                key="graph"
                className="w-64 shrink-0 sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto pt-6"
              >
                <LocalGraph compact />
              </aside>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Пустое состояние ─────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EMPTY_STATE_EASE }}
        className="flex flex-col items-center gap-3 text-center"
      >
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-[var(--color-border)] flex items-center justify-center">
          <FileText size={20} strokeWidth={1.6} className="text-zinc-600" />
        </div>
        <div className="text-zinc-400 text-sm font-medium">
          Нет открытой заметки
        </div>
        <div className="text-zinc-600 text-xs max-w-xs">
          Выбери что-нибудь слева или создай новую через{" "}
          <span className="font-mono text-zinc-500">+</span>
        </div>
      </motion.div>
    </div>
  );
}
