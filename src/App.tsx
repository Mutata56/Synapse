import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { useIconizeStore } from "./store/iconize";
const IconPicker = lazy(() => import("./components/IconPicker"));
import { t } from "./lib/i18n";
const CalendarView = lazy(() => import("./components/CalendarView").then(module => ({ default: module.CalendarView })));
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { PromptDialog } from "./components/PromptDialog";
import { TemplatePicker } from "./components/TemplatePicker";
const Editor2026 = lazy(() => import("./editor2026/Editor2026").then(module => ({ default: module.Editor2026 })));
import { FilesView } from "./components/FilesView";
const GraphView = lazy(() => import("./components/GraphView").then((module) => ({ default: module.GraphView })));
import { ImageLightbox } from "./components/ImageLightbox";
const ImagesView = lazy(() => import("./components/ImagesView").then(module => ({ default: module.ImagesView })));
import { InboxView } from "./components/InboxView";
import { NotesGallery } from "./components/NotesGallery";
const MarkdownSourceEditor = lazy(() => import("./components/MarkdownSourceEditor").then(module => ({ default: module.MarkdownSourceEditor })));
const SettingsView = lazy(() => import("./components/SettingsView").then(module => ({ default: module.SettingsView })));
import { WorkspaceChrome } from "./components/WorkspaceChrome";
import { useWorkspaceStore } from "./store/workspace";
import { activeWorkspaceTab } from "./lib/workspaceTabs";
import { TagsView } from "./components/TagsView";
import { Toaster } from "./components/Toaster";
import { TrashView } from "./components/TrashView";
import { VersionHistory } from "./components/VersionHistory";
import { WikiLinkPicker } from "./components/WikiLinkPicker";
const WritingDashboard = lazy(() => import("./components/WritingDashboard").then(module => ({ default: module.WritingDashboard })));
import { warmAssetResolver } from "./editor2026/lib/assets";
import { warmIndex } from "./lib/fullTextSearch";
import { seedTemplatesIfEmpty } from "./lib/templates";
import { flattenNotes } from "./lib/treeUtils";
import { flushAllPending, useNotesStore, type View } from "./store/notes";
import { useTemplatesStore } from "./store/templates";

// ─── Константы ─────────────────────────────────────────────────────────────

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

export default function App({ bootstrap = true }: { bootstrap?: boolean } = {}) {
  const iconPickerOpen = useIconizeStore(s => s.picker !== null);
  const refreshTree = useNotesStore((s) => s.refreshTree);
  const loadFolderColors = useNotesStore((s) => s.loadFolderColors);
  const loadSettings = useNotesStore((s) => s.loadSettings);
  const target = useWorkspaceStore(state => activeWorkspaceTab(state).target);
  const view: View = target.kind === "view" ? target.view : "notes";
  const activeId = target.kind === "note" ? target.noteId : null;
  const undo = useNotesStore((s) => s.undo);
  const redo = useNotesStore((s) => s.redo);

  // Разовый bootstrap воркспейса. `refreshTree` сам ловит ошибки и логирует,
  // так что на сайте вызова обрабатывать не нужно, но помечаем fire-and-forget
  // через `void`. Когда дерево загружено, прогреваем кэш полнотекстового
  // поиска в фоне, чтобы первый глобальный поиск не платил за чтение всех
  // заметок с диска при нажатии.
  useEffect(() => {
    if (!bootstrap) return;
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
      await useIconizeStore.getState().load();
      await refreshTree();
      await useWorkspaceStore.getState().restore();
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
      // Статистика слов загружается только по выбору «Объём текстов» в Обзоре.
      // Параллельный прогрев здесь дублировал чтения холодного search-кэша.
      if (useNotesStore.getState().settings.openDailyOnStartup) {
        void useNotesStore.getState().openDailyNote(new Date());
      }
    })();
    void loadFolderColors();
  }, [bootstrap, refreshTree, loadFolderColors, loadSettings]);

  // Окно быстрого захвата пишет заметку в своём webview, затем шлёт это
  // событие, чтобы главное окно перечитало дерево и захват появился.
  useEffect(() => {
    if (!isTauri()) return;
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
    if (!isTauri()) return;
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
          // Скрываем окно после flush: процесс и main webview остаются
          // живыми в трее, поэтому повторный запуск восстанавливает окно.
          await win.hide().catch((e) => {
            console.error("close: window.hide failed:", e);
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
    <div className="app-shell h-screen w-screen overflow-hidden">
      <CommandPalette />
      <Toaster />
      {iconPickerOpen && <Suspense fallback={null}><IconPicker /></Suspense>}
      <WikiLinkPicker />
      <VersionHistory />
      <ConfirmDialog />
      <PromptDialog />
      <TemplatePicker />
      <ImageLightbox />
      <WorkspaceChrome>
        {/* The editor key stays stable across note selections. View changes
            render immediately rather than waiting for a background RAF/exit. */}
        <div key={screenKeyFor(view, activeId)} id="workspace-active-content" role="tabpanel"
          className="workspace-view flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <Suspense fallback={<div role="status" className="p-6 text-sm text-[var(--text-secondary)]">{t("Загрузка…")}</div>}>{renderView(view, activeId)}</Suspense>
        </div>
      </WorkspaceChrome>
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
      return activeId ? <NoteEditor /> : <NotesGallery />;
    case "files":
      return <FilesView />;
    case "trash":
      return <TrashView />;
    case "images":
      return <ImagesView />;
    case "tags":
      return <TagsView />;
    case "graph":
      return <Suspense fallback={<div role="status" className="p-6 text-sm text-neutral-400">{t("Загрузка графа…")}</div>}><GraphView /></Suspense>;
    case "calendar":
      return <CalendarView />;
    case "overview":
      return <Suspense fallback={<div role="status" className="p-6 text-sm text-neutral-400">{t("Загрузка обзора…")}</div>}><WritingDashboard /></Suspense>;
    case "inbox":
      return <InboxView />;
    case "settings":
      return <SettingsView />;
    default:
      return assertNever(view);
  }
}

/** Choose the lossless source route before a BlockNote instance is mounted. */
function NoteEditor() {
  const note = useNotesStore((s) => s.activeNote);
  const reloadNonce = useNotesStore((s) => s.editorReloadNonce);
  if (!note) return <div className="flex-1 grid place-items-center text-zinc-500">Заметка не загружена</div>;
  return note.markdownSource
    ? <MarkdownSourceEditor key={`${note.id}:${reloadNonce}`} />
    : <Editor2026 />;
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
