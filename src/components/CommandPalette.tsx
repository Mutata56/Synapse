import { AnimatePresence, motion } from "framer-motion";
import Fuse from "fuse.js";
import {
  ArrowRight,
  Calendar,
  CornerDownLeft,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Hash,
  History,
  Image as ImageIcon,
  LayoutTemplate,
  Network,
  Pencil,
  Search,
  Settings,
  TextSearch,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildGraph } from "../lib/buildGraph";
import { cn } from "../lib/cn";
import { DEFAULT_NOTE_TITLE, EMOJI_FONT_STACK } from "../lib/format";
import { requestGraphFocus } from "../lib/graphFocus";
import { t } from "../lib/i18n";
import {
  collectNoteMatches,
  findEditorScrollContainer,
  getHighlightApi,
  HL_ALL,
  HL_CURRENT,
  scrollRangeIntoView,
  type NoteMatch,
} from "../lib/noteSearch";
import {
  buildSearchDocs,
  searchFullText,
  type SearchDoc,
  type Snippet,
} from "../lib/fullTextSearch";
import type { NoteMeta } from "../lib/storage";
import { flattenNotes } from "../lib/treeUtils";
import { useNotesStore, type View } from "../store/notes";
import { useTemplatesStore } from "../store/templates";

const PALETTE_MAX_WIDTH_PX = 560;
const RESULTS_MAX_HEIGHT_PX = 440;
const TOP_OFFSET_VH = 14;
// Должно лежать ВЫШЕ полноэкранной модалки доски (оверлей z 9999; её обвес,
// то есть текстовый слой, слой узлов, панель стилей, пипетка, доходит до 10003).
// Палитра глобальна (Ctrl+K/F открывают её везде, в том числе поверх доски),
// так что при открытой доске палитра ОБЯЗАНА рисоваться сверху. Раньше тут было
// 200, и палитра открывалась нормально, но рисовалась ПОД доской, так что
// Ctrl+F/Ctrl+K выглядели мёртвыми ("не работает на доске").
const Z_OVERLAY = 12000;

const RECENT_NOTES_COUNT = 8;
const NOTE_RESULTS_LIMIT = 12;
const ACTION_RESULTS_LIMIT = 5;

const SEARCH_DEBOUNCE_MS = 80;
/** Сколько подсветка совпадения держится после закрытия палитры. */
const HIGHLIGHT_LINGER_MS = 2200;

const FUSE_THRESHOLD = 0.4;

const ACTION_FUSE_OPTIONS = {
  keys: ["label", "keywords"],
  threshold: FUSE_THRESHOLD,
};

const NOTE_ICON_SIZE_PX = 18;

// Детект клавиш независимо от раскладки: ловим и ЙЦУКЕН, где физическая K даёт
// `л`, а физическая F даёт `а`.
const K_KEY_CHARS = new Set(["k", "K", "л", "Л"]);
const F_KEY_CHARS = new Set(["f", "F", "а", "А"]);

const ENTRANCE = {
  duration: 0.16,
  ease: [0.16, 1, 0.3, 1] as const,
};

type Mode = "global" | "note" | "graph";

type GraphNode = { key: string; label: string; kind: string };

type Action = {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
};

type Item =
  | { kind: "note"; note: NoteMeta; snippet?: Snippet | null }
  | { kind: "action"; action: Action }
  | { kind: "match"; match: NoteMatch; idx: number }
  | { kind: "gnode"; node: GraphNode };

const itemKey = (item: Item): string => {
  if (item.kind === "note") return `n:${item.note.id}`;
  if (item.kind === "action") return `a:${item.action.id}`;
  if (item.kind === "gnode") return `g:${item.node.key}`;
  return `m:${item.idx}`;
};

// ─── Компонент ─────────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("global");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [matches, setMatches] = useState<NoteMatch[]>([]);
  // Полнотекстовые доки для глобальной области. Тела кэшируются между
  // открытиями в fullTextSearch.ts, так что пересборка дешёвая, пока заметка
  // реально не поменялась.
  const [docs, setDocs] = useState<SearchDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Таймер авто-сброса подсветки в заметке, чтобы новый переход отменил
  // предыдущий (иначе первый таймер погасит подсветку второго).
  const lingerTimerRef = useRef<number | null>(null);

  const tree = useNotesStore((s) => s.tree);
  const view = useNotesStore((s) => s.view);
  const activeId = useNotesStore((s) => s.activeId);
  const setView = useNotesStore((s) => s.setView);
  const selectNote = useNotesStore((s) => s.selectNote);
  const createNote = useNotesStore((s) => s.createNote);
  const startCreateFolder = useNotesStore((s) => s.startCreateFolder);
  const closeActive = useNotesStore((s) => s.closeActiveNote);

  // Поиск по заметке имеет смысл, только когда редактор реально на экране,
  // поиск по графу только во вью графа. Эти флаги решают, в какую область
  // переключают Ctrl+F / Tab (в заметке это заметка, в графе это граф).
  const noteSearchAvailable = view === "notes" && activeId !== null;
  const graphAvailable = view === "graph";

  // ─── Глобальные клавиши: Ctrl/Cmd+K (везде), Ctrl/Cmd+F (в заметке, если
  //     она открыта, иначе везде), Tab (сменить область), Esc (закрыть).
  //     `code` не зависит от раскладки, наборы символов это запасной вариант
  //     для IME. Tab ловим здесь (не на инпуте), чтобы он работал откуда
  //     угодно и ровно раз. Доступность читаем свежей из стора: замыкание
  //     над React-стейтом может отстать на рендер и сработать не вовремя. ───
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const isK = e.code === "KeyK" || K_KEY_CHARS.has(e.key);
      const isF = e.code === "KeyF" || F_KEY_CHARS.has(e.key);
      const s = useNotesStore.getState();
      const localTarget: Mode | null =
        s.view === "graph"
          ? "graph"
          : s.view === "notes" && s.activeId !== null
            ? "note"
            : null;

      if (mod && (isK || isF)) {
        e.preventDefault();
        // Ctrl+F ведёт в контекстную область (граф в графе, заметка в заметке),
        // Ctrl+K всегда глобальный.
        const target: Mode = isF && localTarget ? localTarget : "global";
        if (open && mode === target) {
          setOpen(false);
        } else {
          setMode(target);
          setOpen(true);
        }
      } else if (open && e.key === "Tab") {
        e.preventDefault();
        // Переключаемся между глобальной и контекстной областью, если она есть.
        if (localTarget) setMode((m) => (m === "global" ? localTarget : "global"));
      } else if (open && e.key === "Escape") {
        // Глотаем, чтобы Escape закрывал ТОЛЬКО палитру: иначе событие
        // продолжит всплывать до обработчика Escape модалки доски (он тоже на
        // фазе всплытия) и закрыл бы доску под ней тем же нажатием.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mode]);

  // Если активная заметка пропала при открытой палитре (или открылись не во
  // вью заметки), выходим из области заметки: искать там нечего.
  useEffect(() => {
    if (mode === "note" && !noteSearchAvailable) setMode("global");
    else if (mode === "graph" && !graphAvailable) setMode("global");
  }, [mode, noteSearchAvailable, graphAvailable]);

  // Сбрасываем запрос/выбор и фокусим инпут при открытии или смене области.
  // Два rAF дают framer-motion закоммитить узел перед фокусом: `autoFocus`
  // закрывает первый монтаж, а это закрывает смену области.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => inputRef.current?.focus()),
    );
    return () => cancelAnimationFrame(id);
  }, [open, mode]);

  // ─── Действия (глобальная область) ────────────────────────────────────────────
  const actions: Action[] = useMemo(() => {
    const goToView = (v: View) => {
      setView(v);
      if (v === "notes") closeActive();
      setOpen(false);
    };

    const base: Action[] = [
      {
        id: "new-note",
        label: t("Новая заметка"),
        hint: t("Создать новую"),
        icon: FilePlus,
        keywords: "new note создать заметка create add",
        run: async () => {
          await createNote("");
          setOpen(false);
        },
      },
      {
        id: "new-folder",
        label: t("Новая папка"),
        hint: t("Создать в корне"),
        icon: FolderPlus,
        keywords: "new folder создать папка create add directory",
        run: () => {
          setView("notes");
          closeActive();
          startCreateFolder("");
          setOpen(false);
        },
      },
    ];

    // Переименование имеет смысл только при открытой заметке: оно фокусит
    // инпут заголовка в hero напрямую.
    if (noteSearchAvailable) {
      base.push({
        id: "rename-note",
        label: t("Переименовать заметку"),
        hint: t("Изменить заголовок"),
        icon: Pencil,
        keywords: "rename переименовать title заголовок название",
        run: () => {
          setOpen(false);
          requestAnimationFrame(() => {
            const el = document.querySelector<HTMLInputElement>(".hero-title");
            el?.focus();
            el?.select();
          });
        },
      });
      base.push({
        id: "version-history",
        label: t("История версий"),
        hint: t("Прошлые версии заметки"),
        icon: History,
        keywords: "history версии история backup бэкап откат restore версия",
        run: () => {
          const id = useNotesStore.getState().activeId;
          if (id) useNotesStore.getState().openVersionHistory(id);
          setOpen(false);
        },
      });
      base.push({
        id: "save-as-template",
        label: t("Сохранить как шаблон…"),
        hint: t("Текущая заметка как шаблон"),
        icon: LayoutTemplate,
        keywords: "шаблон template save сохранить как новый",
        run: () => {
          void useTemplatesStore.getState().saveCurrentAsTemplate();
          setOpen(false);
        },
      });
    }
    // Управление шаблонами доступно всегда: это модалка, заметка не нужна.
    base.push({
      id: "manage-templates",
      label: t("Шаблоны…"),
      hint: t("Управление шаблонами"),
      icon: LayoutTemplate,
      keywords: "templates шаблоны управление manage список",
      run: () => {
        useTemplatesStore.getState().openTemplatePicker("manage");
        setOpen(false);
      },
    });

    base.push(
      { id: "go-files", label: "Файлы", icon: FolderPlus,
        keywords: "files папки browse directory", run: () => goToView("files") },
      { id: "go-notes", label: "Все заметки", hint: "Перейти в галерею",
        icon: FileText, keywords: "notes заметки список all",
        run: () => goToView("notes") },
      { id: "go-graph", label: "Граф связей", icon: Network,
        keywords: "graph граф связи links", run: () => goToView("graph") },
      { id: "go-calendar", label: "Календарь", icon: Calendar,
        keywords: "calendar календарь daily", run: () => goToView("calendar") },
      { id: "daily-template", label: "Шаблон заметки дня", hint: "Изменить структуру",
        icon: LayoutTemplate, keywords: "template шаблон дня daily структура",
        run: () => { void useNotesStore.getState().openDailyTemplate(); setOpen(false); } },
      { id: "go-tags", label: "Теги", icon: Hash,
        keywords: "tags теги hashtag", run: () => goToView("tags") },
      { id: "go-trash", label: "Корзина", icon: Trash2,
        keywords: "trash корзина deleted", run: () => goToView("trash") },
      { id: "go-images", label: "Изображения", icon: ImageIcon,
        keywords: "images изображения assets covers", run: () => goToView("images") },
      { id: "go-settings", label: "Настройки", icon: Settings,
        keywords: "settings настройки preferences опции цвет хоткей", run: () => goToView("settings") },
    );
    return base;
  }, [
    createNote,
    setView,
    closeActive,
    startCreateFolder,
    noteSearchAvailable,
  ]);

  // ─── Поисковые индексы (глобальная область) ─────────────────────────────────────
  const allNotes = useMemo(() => flattenNotes(tree), [tree]);

  // Собираем полнотекстовые доки только пока открыта глобальная область. Тела
  // кэшируются по `updatedAt` в fullTextSearch.ts, так что бамп дерева от
  // фонового сохранения перечитывает только изменившуюся заметку, остальное
  // попадает в кэш. `cancelled` отбрасывает устаревшую сборку, если дерево
  // поменялось посреди чтения.
  useEffect(() => {
    // Вне глобальной области (или когда закрыто) чистим доки, чтобы повторное
    // открытие не показало результаты по набору заметок из прошлой сессии
    // (например, заметку успели удалить) до того, как доедет свежая пересборка.
    // Вью без запроса (недавние и действия) доки не читает, так что пустого
    // мигания при открытии не будет.
    if (!open || mode !== "global") {
      setDocs([]);
      setDocsLoading(false);
      return;
    }
    let cancelled = false;
    setDocsLoading(true);
    buildSearchDocs(allNotes)
      .then((d) => {
        if (cancelled) return;
        setDocs(d);
        setDocsLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("buildSearchDocs failed:", e);
        setDocsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, allNotes]);

  const actionFuse = useMemo(() => new Fuse(actions, ACTION_FUSE_OPTIONS), [actions]);

  // Узлы графа (папки, заметки, #теги), собираем только при поиске по графу.
  const graphNodes = useMemo<GraphNode[]>(() => {
    if (!open || mode !== "graph") return [];
    const g = buildGraph(tree);
    return g.nodes().map((id) => ({
      key: id,
      label: String(g.getNodeAttribute(id, "label") ?? ""),
      kind: String(g.getNodeAttribute(id, "kind") ?? "note"),
    }));
  }, [open, mode, tree]);
  const graphFuse = useMemo(
    () =>
      mode === "graph"
        ? new Fuse(graphNodes, {
            keys: ["label"],
            threshold: FUSE_THRESHOLD,
            ignoreLocation: true,
          })
        : null,
    [mode, graphNodes],
  );

  // ─── Поиск по заметке (область заметки) ───────────────────────────────────────
  // С дебаунсом, чтобы проход TreeWalker по большой заметке не бежал на каждое нажатие.
  useEffect(() => {
    if (!open || mode !== "note") {
      setMatches([]);
      return;
    }
    const q = query.trim();
    if (!q) {
      setMatches([]);
      return;
    }
    const id = window.setTimeout(
      () => setMatches(collectNoteMatches(q)),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [open, mode, query]);

  // ─── Список результатов ───────────────────────────────────────────────────────
  const items: Item[] = useMemo(() => {
    if (mode === "note") {
      return matches.map<Item>((match, idx) => ({ kind: "match", match, idx }));
    }
    if (mode === "graph") {
      const gq = query.trim();
      const list =
        gq && graphFuse
          ? graphFuse.search(gq).slice(0, 40).map((h) => h.item)
          : graphNodes.slice(0, 40);
      return list.map<Item>((node) => ({ kind: "gnode", node }));
    }
    const q = query.trim();
    if (!q) {
      const recent = [...allNotes]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, RECENT_NOTES_COUNT)
        .map<Item>((note) => ({ kind: "note", note }));
      const acts = actions.map<Item>((action) => ({ kind: "action", action }));
      return [...acts, ...recent];
    }
    const noteHits = searchFullText(docs, q, NOTE_RESULTS_LIMIT);
    const actionHits = actionFuse.search(q).slice(0, ACTION_RESULTS_LIMIT);
    return [
      ...actionHits.map<Item>((h) => ({ kind: "action", action: h.item })),
      ...noteHits.map<Item>((h) => ({ kind: "note", note: h.note, snippet: h.snippet })),
    ];
  }, [mode, matches, query, allNotes, actions, docs, actionFuse, graphNodes, graphFuse]);

  // Подсвечивает все совпадения и выбранное, скроллит к нему и закрывается.
  // Подсветка держится чуть-чуть, чтобы юзер увидел, куда попал, когда оверлей
  // (он закрывает редактор) уедет анимацией.
  const jumpToMatch = (match: NoteMatch) => {
    const api = getHighlightApi();
    if (api) {
      api.paint(HL_ALL, matches.map((m) => m.range));
      api.paint(HL_CURRENT, [match.range]);
      if (lingerTimerRef.current !== null) {
        window.clearTimeout(lingerTimerRef.current);
      }
      lingerTimerRef.current = window.setTimeout(() => {
        api.clear(HL_ALL);
        api.clear(HL_CURRENT);
        lingerTimerRef.current = null;
      }, HIGHLIGHT_LINGER_MS);
    }
    scrollRangeIntoView(match.range, findEditorScrollContainer());
    setOpen(false);
  };

  const runItem = (item: Item) => {
    if (item.kind === "note") {
      setView("notes");
      void selectNote(item.note.id);
      setOpen(false);
    } else if (item.kind === "action") {
      item.action.run();
    } else if (item.kind === "gnode") {
      requestGraphFocus(item.node.key);
      setOpen(false);
    } else {
      jumpToMatch(item.match);
    }
  };

  // Сбрасываем на верх при новом запросе или области: это реально новый набор.
  useEffect(() => {
    setSelected(0);
  }, [query, mode]);

  // Держим `selected` в пределах при смене размера списка, НЕ дёргая его наверх:
  // подъезжающие асинхронные полнотекстовые результаты (доки доехали) удлиняют
  // список, и сброс в 0 тут потерял бы позицию стрелок посреди навигации.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Держим активный результат в зоне видимости при навигации с клавиатуры.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-cp-index="${selected}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, open]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = items[selected];
      if (target) runItem(target);
    }
  };

  const placeholder =
    mode === "note"
      ? "Поиск по тексту заметки…"
      : mode === "graph"
        ? "Поиск по графу (папки, заметки, теги)…"
        : "Поиск заметок, действий…";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={() => setOpen(false)}
          style={{ zIndex: Z_OVERLAY, paddingTop: `${TOP_OFFSET_VH}vh` }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center px-4"
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={ENTRANCE}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: PALETTE_MAX_WIDTH_PX }}
            className="w-full bg-[var(--color-bg-overlay)] rounded-xl border border-[var(--color-border-strong)] shadow-[var(--shadow-float)] backdrop-blur-xl backdrop-saturate-[1.7] overflow-hidden flex flex-col"
            role="dialog"
            aria-label="Командная палитра"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
              {mode === "note" ? (
                <TextSearch size={16} strokeWidth={2} className="text-zinc-500 shrink-0" />
              ) : (
                <Search size={16} strokeWidth={2} className="text-zinc-500 shrink-0" />
              )}
              <input
                ref={inputRef}
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                spellCheck={false}
                placeholder={placeholder}
                className="flex-1 bg-transparent outline-none text-zinc-100 text-[14px] placeholder-zinc-600"
              />
              <Kbd>Esc</Kbd>
            </div>

            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--color-border)]">
              <Tab
                active={mode === "global"}
                onClick={() => setMode("global")}
                shortcut={`${MOD_LABEL} K`}
              >
                Везде
              </Tab>
              {graphAvailable ? (
                <Tab
                  active={mode === "graph"}
                  onClick={() => setMode("graph")}
                  shortcut={`${MOD_LABEL} F`}
                >
                  В графе
                </Tab>
              ) : (
                <Tab
                  active={mode === "note"}
                  disabled={!noteSearchAvailable}
                  onClick={() => setMode("note")}
                  shortcut={`${MOD_LABEL} F`}
                >
                  В заметке
                </Tab>
              )}
            </div>

            <div
              ref={listRef}
              className="overflow-y-auto py-1.5"
              style={{ maxHeight: RESULTS_MAX_HEIGHT_PX }}
            >
              {items.length === 0 ? (
                <EmptyHint
                  mode={mode}
                  hasQuery={query.trim().length > 0}
                  hasActiveNote={noteSearchAvailable}
                  loading={docsLoading}
                />
              ) : (
                items.map((item, i) => (
                  <ResultRow
                    key={itemKey(item)}
                    item={item}
                    active={i === selected}
                    index={i}
                    onHover={() => setSelected(i)}
                    onClick={() => runItem(item)}
                  />
                ))
              )}
            </div>

            <Footer mode={mode} count={items.length} selected={selected} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Подкомпоненты ─────────────────────────────────────────────────────────

function Tab({
  active,
  disabled,
  onClick,
  shortcut,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  shortcut: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors",
        disabled
          ? "text-zinc-700 cursor-not-allowed"
          : active
            ? "bg-white/[0.07] text-zinc-100"
            : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]",
      )}
    >
      {children}
      <span className="font-mono text-[9px] text-zinc-600">{shortcut}</span>
    </button>
  );
}

function EmptyHint({
  mode,
  hasQuery,
  hasActiveNote,
  loading,
}: {
  mode: Mode;
  hasQuery: boolean;
  hasActiveNote: boolean;
  loading: boolean;
}) {
  let text = "Ничего не найдено";
  if (mode === "global" && loading && hasQuery) {
    text = "Индексирую заметки…";
  } else if (mode === "note") {
    if (!hasActiveNote) text = "Откройте заметку, чтобы искать по тексту";
    else if (!hasQuery) text = "Введите текст для поиска по заметке";
  }
  return (
    <div className="px-4 py-8 text-center text-[13px] text-zinc-600">{text}</div>
  );
}

function ResultRow({
  item,
  active,
  index,
  onHover,
  onClick,
}: {
  item: Item;
  active: boolean;
  index: number;
  // mouse-enter, а не mouse-move: `move` стреляет на каждый пиксель
  // движения и устраивает поток setState и поток ре-рендеров.
  onHover: () => void;
  onClick: () => void;
}) {
  return (
    <div
      data-cp-index={index}
      onMouseEnter={onHover}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 mx-1.5 py-2 rounded-md cursor-pointer transition-colors",
        active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
      )}
    >
      {item.kind === "note" ? (
        <NoteRowContent note={item.note} snippet={item.snippet} />
      ) : item.kind === "action" ? (
        <ActionRowContent action={item.action} />
      ) : item.kind === "gnode" ? (
        <GraphNodeRowContent node={item.node} />
      ) : (
        <MatchRowContent match={item.match} />
      )}
      {active && (
        <ArrowRight
          size={13}
          strokeWidth={2}
          className="text-zinc-500 shrink-0"
        />
      )}
    </div>
  );
}

function NoteRowContent({
  note,
  snippet,
}: {
  note: NoteMeta;
  snippet?: Snippet | null;
}) {
  return (
    <>
      {note.icon ? (
        <span
          style={{
            fontFamily: EMOJI_FONT_STACK,
            fontSize: NOTE_ICON_SIZE_PX,
            lineHeight: 1,
          }}
          className="select-none w-5 text-center shrink-0"
        >
          {note.icon}
        </span>
      ) : (
        <FileText
          size={14}
          strokeWidth={1.8}
          className="text-zinc-600 shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-zinc-100 truncate">
          {note.title || DEFAULT_NOTE_TITLE}
        </div>
        {/* Совпадение в теле показывает свой сниппет, а совпадение только в
            заголовке откатывается на путь папки, чтобы у строки была вторая строка. */}
        {snippet ? (
          <div className="text-[11px] truncate">
            <span className="text-zinc-500">{snippet.before}</span>
            <span className="bg-[var(--color-search-hit)] text-[var(--color-text-strong)] rounded-[2px] px-0.5">
              {snippet.text}
            </span>
            <span className="text-zinc-500">{snippet.after}</span>
          </div>
        ) : (
          note.folder && (
            <div className="text-[11px] text-zinc-600 truncate">
              {note.folder.replace(/\//g, " › ")}
            </div>
          )
        )}
      </div>
    </>
  );
}

function ActionRowContent({ action }: { action: Action }) {
  const Icon = action.icon;
  return (
    <>
      <Icon
        size={14}
        strokeWidth={1.8}
        className="text-[var(--color-accent)] shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-zinc-100 truncate">{action.label}</div>
        {action.hint && (
          <div className="text-[11px] text-zinc-600 truncate">{action.hint}</div>
        )}
      </div>
    </>
  );
}

function GraphNodeRowContent({ node }: { node: GraphNode }) {
  const Icon = node.kind === "folder" ? Folder : node.kind === "tag" ? Hash : FileText;
  const color =
    node.kind === "folder"
      ? "text-[#7c86b8]"
      : node.kind === "tag"
        ? "text-[#6aa891]"
        : "text-zinc-500";
  return (
    <>
      <Icon size={14} strokeWidth={1.8} className={cn("shrink-0", color)} />
      <div className="min-w-0 flex-1 text-[13px] text-zinc-100 truncate">
        {node.label}
      </div>
    </>
  );
}

function MatchRowContent({ match }: { match: NoteMatch }) {
  return (
    <>
      <Search size={14} strokeWidth={1.8} className="text-zinc-600 shrink-0" />
      <div className="min-w-0 flex-1 text-[13px] truncate">
        <span className="text-zinc-500">{match.before}</span>
        <span className="bg-[var(--color-search-hit)] text-[var(--color-text-strong)] rounded-[2px] px-0.5">
          {match.text}
        </span>
        <span className="text-zinc-500">{match.after}</span>
      </div>
    </>
  );
}

function Footer({
  mode,
  count,
  selected,
}: {
  mode: Mode;
  count: number;
  selected: number;
}) {
  return (
    <div className="px-4 py-2 border-t border-[var(--color-border)] flex items-center justify-between text-[10px] text-zinc-600">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          Навигация
        </span>
        <span className="flex items-center gap-1">
          <Kbd>
            <CornerDownLeft size={9} strokeWidth={2.4} />
          </Kbd>
          {mode === "note" ? "Перейти" : "Открыть"}
        </span>
      </div>
      {mode === "note" ? (
        <span className="font-mono">
          {count === 0 ? "нет совпадений" : `${selected + 1} / ${count}`}
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Kbd>Tab</Kbd>
          Сменить область
        </span>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-zinc-400 font-mono text-[10px]">
      {children}
    </kbd>
  );
}

/** Глиф модификатора под ОС для подписи хоткея Ctrl/Cmd. На macOS ждут ⌘, а не
 *  "Ctrl", на Windows/Linux ждут "Ctrl". Определяем один раз при первом чтении
 *  по user agent (Tauri несёт Webview, но он всё равно сообщает платформу UA
 *  хоста, для такой мелкой UI-задачи этого хватает). */
const MOD_LABEL =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || navigator.platform || "")
    ? "⌘"
    : "Ctrl";
