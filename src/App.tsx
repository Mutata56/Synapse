import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { CalendarView } from "./components/CalendarView";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { PromptDialog } from "./components/PromptDialog";
import { TemplatePicker } from "./components/TemplatePicker";
import { Editor2026 } from "./editor2026/Editor2026";
import { FilesView } from "./components/FilesView";
import { GraphView } from "./components/GraphView";
import { ImageLightbox } from "./components/ImageLightbox";
import { ImagesView } from "./components/ImagesView";
import { InboxView } from "./components/InboxView";
import { NotesGallery } from "./components/NotesGallery";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { TagsView } from "./components/TagsView";
import { Toaster } from "./components/Toaster";
import { TrashView } from "./components/TrashView";
import { VersionHistory } from "./components/VersionHistory";
import { WikiLinkPicker } from "./components/WikiLinkPicker";
import { WritingDashboard } from "./components/WritingDashboard";
import { warmAssetResolver } from "./editor2026/lib/assets";
import { warmIndex, wordCountsFor } from "./lib/fullTextSearch";
import { seedTemplatesIfEmpty } from "./lib/templates";
import { flattenNotes } from "./lib/treeUtils";
import { flushAllPending, useNotesStore, type View } from "./store/notes";
import { useTemplatesStore } from "./store/templates";

// ─── Константы ─────────────────────────────────────────────────────────────

const VIEW_TRANSITION = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1] as const,
};

const BN_EDITOR_SELECTOR = ".bn-editor";

/** Нативные теги text-input, имеющие собственную undo-историю.
 *  Используется в `isInsideEditable` вместе с проверкой `contentEditable`
 *  и `.bn-editor`. */
const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA"]);

/**
 * Символы, которые клавиша Z выдаёт на различных раскладках. Проверка
 * `e.code === "KeyZ"` ловит физическую позицию клавиши; проверка `e.key`
 * по этому набору это фолбэк для раскладок / IME, где `code` ненадёжен
 * (например кириллическая клавиатура в некоторых сборках Tauri WebView).
 */
const Z_KEY_CHARS = new Set(["z", "Z", "я", "Я"]);

// ─── Component ─────────────────────────────────────────────────────────────

export default function App() {
  const refreshTree = useNotesStore((s) => s.refreshTree);
  const loadFolderColors = useNotesStore((s) => s.loadFolderColors);
  const loadSettings = useNotesStore((s) => s.loadSettings);
  const view = useNotesStore((s) => s.view);
  const activeId = useNotesStore((s) => s.activeId);
  const undo = useNotesStore((s) => s.undo);
  const redo = useNotesStore((s) => s.redo);

  // Разовый bootstrap воркспейса. `refreshTree` сам ловит ошибки и логирует,
  // так что на сайте вызова обрабатывать не нужно, но помечаем fire-and-forget
  // через `void`. Когда дерево загружено, прогреваем кэш полнотекстового
  // поиска в фоне, чтобы первый глобальный поиск не платил за чтение всех
  // заметок с диска при нажатии.
  useEffect(() => {
    // Разовая очистка устаревшего флага беты Editor2026 (старый ключ,
    // можно удалить позже). Старый <Editor/> ушёл на пенсию, Editor2026
    // теперь единственный редактор; ключ безвреден после переключения,
    // но чистка сохраняет localStorage опрятным для вернувшихся юзеров,
    // которые включали бету.
    try {
      // todo удалить после обновлений, ключ от старой беты
      localStorage.removeItem("editor2026");
    } catch {
      // localStorage может кидать в приватных режимах / при переполнении
      // квоты, best-effort.
    }
    // Прогреваем путь к .assets, чтобы разворот портабельных ссылок на картинки
    // (resolveAssetUrl) был синхронным к моменту отрисовки первой заметки.
    void warmAssetResolver();
    void (async () => {
      // Загружаем настройки первыми, чтобы CSS-переменные accent и
      // пользовательский глобальный шорткат применились как можно раньше
      // (до чтения дерева, которое заполняет UI).
      await loadSettings();
      await refreshTree();
      // Создаём встроенные шаблоны, если их нет (идемпотентно, см.
      // seedTemplatesIfEmpty). Запускаем ПОСЛЕ refreshTree, так что
      // ensureWorkspace уже создал папку `notes/`; dotdir шаблонов
      // невидим для обходчика дерева, обновлять не нужно. Гидратируем
      // кэш шаблонов после, чтобы чип-роу / пикер имели что показать.
      await seedTemplatesIfEmpty().catch((e) => {
        console.error("seedTemplatesIfEmpty failed (ignored):", e);
      });
      void useTemplatesStore.getState().refresh();
      const flatNotes = flattenNotes(useNotesStore.getState().tree);
      void warmIndex(flatNotes);
      // Fire-and-forget прогрев подсчёта слов, чтобы первый "Обзор" открылся
      // без чтения диска: `warmIndex` заполняет кэш тел, а этот проход
      // заполняет параллельный кэш подсчёта слов по тем же телам.
      void wordCountsFor(flatNotes).catch(() => {
        /* best-effort прогрев; ошибки логируются самим wordCountsFor. */
      });
      if (useNotesStore.getState().settings.openDailyOnStartup) {
        void useNotesStore.getState().openDailyNote(new Date());
      }
    })();
    void loadFolderColors();
  }, [refreshTree, loadFolderColors, loadSettings]);

  // Окно быстрого захвата пишет заметку в своём webview, затем шлёт это
  // событие, чтобы главное окно перечитало дерево и захват появился.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("note-captured", () => void refreshTree()).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [refreshTree]);

  // ── Сброс pending сохранений при закрытии приложения ───────────────────
  // Alt+F4 / Ctrl+W / кнопка закрытия окна раньше молча теряли
  // дебаунсированные сохранения: всё напечатанное за ~400мс до закрытия
  // пропадало. Tauri's onCloseRequested стреляет ДО уничтожения окна,
  // и мы можем preventDefault, чтобы удержать закрытие до завершения
  // flush. Пропускаем в окне быстрого захвата, у него свой простой
  // textarea и нет flusher-ов.
  useEffect(() => {
    const win = getCurrentWindow();
    if (win.label === "capture") return;
    let unlistenClose: (() => void) | undefined;
    void win
      .onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          await flushAllPending();
        } catch (e) {
          console.error("close: flushAllPending failed:", e);
        } finally {
          // Tauri 2: window.destroy() реально закрывает (в отличие от
          // `close()`, который снова запускает цикл запросов). Оборачиваем,
          // чтобы поглотить ошибку tear-down, и окно гарантированно
          // закроется, даже если flusher крикнул.
          await win.destroy().catch((e) => {
            console.error("close: window.destroy failed:", e);
          });
        }
      })
      .then((u) => {
        unlistenClose = u;
      });
    // beforeunload , дополнительная защита для окружений, которые обходят
    // Tauri close-requested путь (dev reload, F5). Только синхронно, await
    // здесь невозможен, но минимум останавливаем таймер, чтобы гонка
    // unmount не писала в уничтоженный редактор.
    const onBeforeUnload = () => {
      // Fire-and-forget; best-effort с учётом синхронного ограничения.
      void flushAllPending();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      unlistenClose?.();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  // Глобальный Ctrl/Cmd+Z и Ctrl/Cmd+Shift+Z для app-level undo/redo.
  // Пропускаем обработчик когда фокус в любом редактируемом поле (нативный
  // input, textarea, contenteditable или BlockNote), чтобы они сохраняли
  // собственные undo-истории.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (!isZKey(e)) return;
      if (isInsideEditable(e.target)) return;

      e.preventDefault();
      void (e.shiftKey ? redo() : undo());
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <div className="app-shell flex h-screen w-screen overflow-hidden">
      <CommandPalette />
      <Toaster />
      <WikiLinkPicker />
      <VersionHistory />
      <ConfirmDialog />
      <PromptDialog />
      <TemplatePicker />
      <ImageLightbox />
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 min-h-0 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {/* IMPORTANT: the screen key intentionally does NOT include
              activeId. Switching between two notes inside the "notes"
              view would otherwise unmount + remount the Editor (and
              therefore BlockNote) on every selection , defeating
              Editor's own optimisation of swapping content via
              `replaceBlocks` while the editor instance stays alive.
              NoteHero handles the per-note visual swap via its own
              `key={activeId}`. */}
          {/* initial={false}: skip the enter animation. Previously this was
              { opacity: 0, y: 4 } , on a rapid double key-flip (e.g. clicking
              a usage chip in ImagesView fires setView("notes") and selectNote
              in the same tick, producing "images" , "gallery" , "editor"),
              AnimatePresence mode="wait" + interrupted enter could leave the
              NEW wrapper stuck at its initial opacity:0. The mid-mount DOM
              still hit-tested (cursor changed on hover) but everything was
              invisible , the reported "захожу опять и пусто" bug. With no
              enter animation, an interrupted enter cannot leave the wrapper
              hidden. Exit cross-fade still works. */}
          <motion.div
            key={screenKeyFor(view, activeId)}
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={VIEW_TRANSITION}
            className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden"
          >
            {renderView(view, activeId)}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

// ─── Хелперы ─────────────────────────────────────────────────────────────

/**
 * (view, activeId) - стабильный ключ анимации. Ключ управляет какими
 * mount/unmount циклами запускаются внутри <AnimatePresence>. Удержание
 * ключа для "notes" свёрнутого в "editor" или "gallery" означает, что
 * переключение между двумя заметками НЕ размонтирует редактор.
 */
function screenKeyFor(view: View, activeId: string | null): string {
  if (view === "notes") return activeId ? "editor" : "gallery";
  return view;
}

/**
 * Выбирает правильный верхнеуровневый экран для текущего view. Ветка
 * `default` проходит через `assertNever`, так что добавление нового
 * варианта в `View` без соответствующего `case` сломает сборку TypeScript.
 */
function renderView(view: View, activeId: string | null): ReactNode {
  switch (view) {
    case "notes":
      return activeId ? <Editor2026 /> : <NotesGallery />;
    case "files":
      return <FilesView />;
    case "trash":
      return <TrashView />;
    case "images":
      return <ImagesView />;
    case "tags":
      return <TagsView />;
    case "graph":
      return <GraphView />;
    case "calendar":
      return <CalendarView />;
    case "overview":
      return <WritingDashboard />;
    case "inbox":
      return <InboxView />;
    case "settings":
      return <SettingsView />;
    default:
      return assertNever(view);
  }
}

/**
 * TypeScript helper для исчерпывающей проверки. `x: never` проверяется
 * только когда все ветки обработаны выше, иначе этот вызов не компилируется.
 * Runtime throw это защитный фолбэк, который никогда не должен сработать.
 */
function assertNever(x: never): never {
  throw new Error(`App.renderView: unhandled view "${x as string}"`);
}

function isZKey(e: KeyboardEvent): boolean {
  // `code` не зависит от раскладки (физическая позиция клавиши);
  // `key` это то, что выдаёт раскладка. Принимаем оба варианта для
  // устойчивости к edge cases где один ненадёжен (Tauri WebView, IME,
  // мёртвые клавиши).
  return e.code === "KeyZ" || Z_KEY_CHARS.has(e.key);
}

function isInsideEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return target.closest(BN_EDITOR_SELECTOR) !== null;
}
