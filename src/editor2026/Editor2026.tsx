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
  Info,
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
import { UnlinkedMentions } from "../components/UnlinkedMentions";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { importAssetBytes } from "../lib/storage";
import { tagExtension } from "../lib/tags";
import { flattenNotes } from "../lib/treeUtils";
import { refreshWikiLinks, wikiLinkExtension } from "../lib/wikiLink";
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

export function Editor2026() {
  const activeNote = useNotesStore((s) => s.activeNote);
  const activeId = useNotesStore((s) => s.activeId);
  const saveNote = useNotesStore((s) => s.saveNote);
  const goBack = useNotesStore((s) => s.goBack);
  const canGoBack = useNotesStore((s) => s.backStack.length > 0);
  const tree = useNotesStore((s) => s.tree);
  const editorReloadNonce = useNotesStore((s) => s.editorReloadNonce);
  const wide = useMediaQuery("(min-width: 1600px)");

  const editor = useCreateBlockNote({
    schema,
    uploadFile: uploadDroppedFile,
    // Разворачиваем портабельную ссылку `.assets/<имя>` (и старую абсолютную из
    // ранее сохранённых заметок) в рабочий URL под текущую машину прямо при
    // показе встроенных блоков картинки/файла. На диске проп остаётся
    // портабельным — это и делает бэкап переносимым между ОС.
    resolveFileUrl: (url) => Promise.resolve(resolveAssetUrl(url)),
    // Multi-column: drag-cursor для создания колонок + локализация для
    // slash-пункта и хендлеров.
    dropCursor: multiColumnDropCursor,
    dictionary: { ...en, multi_column: multiColumnLocales.en },
    extensions: E26_DEBUG
      ? [wikiLinkExtension, tagExtension, debugExtension]
      : [wikiLinkExtension, tagExtension],
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  // Ctrl + колесо мыши зумит ТЕКСТ редактора (через base font-size,
  // см. обертку ниже) без transform, так что всплывающие меню
  // остаются выровненными. Сохраняется в localStorage под тем же ключом,
  // что и в старом редакторе.
  const [zoom, setZoom] = useState(() => {
    const raw = Number(localStorage.getItem("editor-zoom"));
    return Number.isFinite(raw) && raw >= 0.7 && raw <= 2 ? raw : 1;
  });
  useEffect(() => {
    localStorage.setItem("editor-zoom", String(zoom));
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
    (async () => {
      const blocks = await parseNoteToBlocks(editor, activeNote);
      if (cancelled) return;
      await applyDocument(editor, schema, blocks, activeNote.content);
      if (cancelled) return;
      loadedIdRef.current = activeId;
      loadedNonceRef.current = editorReloadNonce;
      // Отражаем форму загруженного документа, чтобы строка шаблонов
      // появлялась на пустой новой заметке и скрывалась на заполненной.
      setEmptyIfChanged(isEmptyDoc(editor.document));
    })();

    return () => {
      cancelled = true;
    };
  }, [activeId, activeNote, editor, editorReloadNonce, setEmptyIfChanged]);

  // Регистрируем flush-колбэк для пути сохранения-при-переключении.
  // См. Editor.tsx для аналогичного паттерна. Без этого Ctrl+K
  // в течение ~400ms после последнего нажатия молча теряет отложенное сохранение.
  useEffect(() => {
    const flush = async () => {
      if (saveTimerRef.current === null) return;
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (loadedIdRef.current !== activeId) return;
      try {
        // Сворачиваем ссылки на ассеты к портабельной форме ПЕРЕД сохранением,
        // из тех же блоков делаем и markdown — иначе в заметку утечёт абсолютный
        // путь и бэкап не переедет на другую ОС.
        const blocks = portablizeBlocks(editor.document);
        const md = await editor.blocksToMarkdownLossy(blocks as never);
        if (loadedIdRef.current !== activeId) return;
        await saveNote({
          content: md,
          blocknote: JSON.stringify(blocks),
          bnHash: hashString(md),
        });
      } catch (e) {
        console.error("Editor2026: flush save failed:", e);
      }
    };
    const unregister = registerFlusher(flush);
    return () => {
      unregister();
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [activeId, editor, saveNote]);

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

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(async () => {
        saveTimerRef.current = null;
        if (loadedIdRef.current !== editingId) return;
        try {
          // См. flush выше: портабилизируем ссылки на ассеты до сохранения.
          const blocks = portablizeBlocks(editor.document);
          const md = await editor.blocksToMarkdownLossy(blocks as never);
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
    [activeId, editor, saveNote, setEmptyIfChanged],
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
      const calloutItem: DefaultReactSuggestionItem = {
        title: "Выноска",
        subtext: "Цветной блок: инфо / важно / совет",
        aliases: ["callout", "выноска", "врезка", "инфо", "info", "note"],
        group: "Блоки",
        icon: <Info size={18} />,
        onItemClick: () => insertCustomBlock("callout"),
      };
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
      return filterSuggestionItems(
        [
          ...getDefaultReactSlashMenuItems(editor),
          calloutItem,
          dataTableItem,
          galleryItem,
          fileItem,
          whiteboardItem,
          ...getMultiColumnSlashMenuItems(editor),
        ],
        query,
      );
    },
    [editor, insertCustomBlock],
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
      <AnimatePresence>
        {canGoBack && (
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
          <NoteHero key={activeId} />
          <TemplateChipRow visible={isEmpty} editor={editor} schema={schema} />
          <div className={cn(wide && "flex justify-center items-start gap-6 px-6")}>
            {wide && (
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
                  <LocalGraph />
                </>
              )}
            </div>
            {wide && (
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
