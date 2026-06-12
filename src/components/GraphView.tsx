import {
  ArrowRight,
  Clock,
  FileText,
  Folder,
  Hash,
  Loader2,
  Maximize2,
  Minus,
  Network,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildGraph, type GraphNodeKind } from "../lib/buildGraph";
import { ClusterHullManager, KERNEL_PAD } from "../lib/clusterHull";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { readClusterPalette } from "../lib/themeColors";
import { DEFAULT_NOTE_TITLE, pluralRu } from "../lib/format";
import {
  DEFAULT_FORCE_SETTINGS,
  ForceLayout,
  type PhysicsEdge,
  type PhysicsNode,
} from "../lib/forceLayout";
import { setGraphFocusHandler } from "../lib/graphFocus";
import { catmullRom, convexHull, inflate, type Pt } from "../lib/hull";
import { t } from "../lib/i18n";
import { countContents, findFolderByPath, flattenNotes } from "../lib/treeUtils";
import { useNotesStore } from "../store/notes";

const FIT_PADDING_PX = 90;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const HIT_PAD_PX = 6; // запас на радиус захвата вокруг узла
const SLEEP_FRAMES = 40; // сколько спокойных кадров до того, как симуляция уснёт
const LABEL_FADE_RANGE = 0.35; // окно зума, на котором подписи проявляются
const LABEL_GAP = 6; // зазор в экранных px между краем узла и его подписью

const LABEL_FONT = "Inter, system-ui, -apple-system, sans-serif";
const LABEL_SIZE_PX = 15;
const LABEL_COLOR = 0xccd1dc;

// Базовый радиус диска по типу узла, реальный ещё растёт со степенью (хабы крупнее).
const NODE_RADIUS: Record<GraphNodeKind, number> = {
  folder: 6,
  note: 4.5,
};
const DEGREE_RADIUS_GAIN = 1.5; // r += gain*sqrt(degree), с потолком
const DEGREE_RADIUS_CAP = 14;

// Приглушённая палитра: заливка плюс чуть светлее кольцо для чёткого края.
const NODE_COLOR: Record<GraphNodeKind, number> = {
  folder: 0x7c86b8, // серо-синий индиго
  note: 0xa7b0c2, // холодный серый
};
const NODE_RING: Record<GraphNodeKind, number> = {
  folder: 0x9aa3d2,
  note: 0xc7cdda,
};

type EdgeStyle = { color: number; alpha: number; width: number };
const EDGE_STYLE: Record<string, EdgeStyle> = {
  contains: { color: 0x3f3f4b, alpha: 0.45, width: 1 }, // структурные, тихие
  link: { color: 0x6b74ac, alpha: 0.6, width: 1.2 }, // [[ссылки]], это сигнал
};

const GRAPH_BG =
  "radial-gradient(circle at 50% 38%, #16161d 0%, #0f0f15 55%, #0a0a0e 100%)";
const VIGNETTE = "inset 0 0 160px 30px rgba(0,0,0,0.45)";

const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

const nodeRadius = (kind: GraphNodeKind, degree: number): number =>
  NODE_RADIUS[kind] + Math.min(Math.sqrt(degree) * DEGREE_RADIUS_GAIN, DEGREE_RADIUS_CAP);

// Режим окраски по папке: узлы без папки (корневые заметки) падают сюда.
const NEUTRAL_FILL = 0x9aa0ad;
const NEUTRAL_RING = 0xc3c7d0;

// Косметическая анимация.
const BREATH_AMP = 0.02; // пульс радиуса капли на пару процентов, лёгкое "дыхание" в простое
const BREATH_W = 1.45; // угловая скорость дыхания (период около 4.3 с)
const BREATH_IDLE_MS = 8000; // если столько нет активности, дыхание глушим (бережём GPU)
const HOVER_EASE_MS = 110; // постоянная времени появления/исчезания границы при наведении

// "Жидкие оболочки" кластеров рисует ClusterHullManager (см. ../lib/clusterHull):
// каждый узел это density-ядро на GPU, всё суммируется в offscreen RenderTexture и
// порогом превращается в гладкую изоповерхность. Соседние папки СЛИВАЮТСЯ там, где
// поля пересекаются (цвета смешиваются по шву). Тут в GraphView остаётся только
// расстановка ПОДПИСЕЙ кластеров.
const HULL_MIN_MEMBERS = 3; // столько членов нужно кластеру, чтобы получить подпись
const HULL_THROTTLE = 1; // пересчитываем расстановку подписей каждый кадр (дёшево)
const HULL_LABEL_GAP = 34; // world-px над самым верхним узлом кластера для подписи

// Иерархия рёбер: межкластерные "магистрали" (структурные, к центру) толстые и
// яркие, внутрикластерные связи тонкие и тихие.
const HIGHWAY_WIDTH = 2.4;
const HIGHWAY_COLOR = 0x9aa3d2;
const HIGHWAY_ALPHA = 0.75;
const INTERNAL_WIDTH_SCALE = 0.8;
const INTERNAL_ALPHA_SCALE = 0.6;

// Яркая контрастная палитра кластеров (циан, оранж, розовый, синий, зелёный, фиолетовый и т.д.).
const CLUSTER_PALETTE = [
  0x4cc9f0, 0xf7945d, 0xf72585, 0x4895ef, 0x80ed99, 0xb388ff, 0xffd166,
  0xff6b6b, 0x52d1b8, 0xc77dff, 0x90be6d, 0xff8fab,
];

/** Подмешивает к цвету белый на долю `amt` от 0 до 1 (для колец узлов и подписей). */
function lighten(c: number, amt: number): number {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const m = (v: number): number => Math.round(v + (255 - v) * amt);
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

/** Подпись для ключа группировки (последний сегмент пути папки). */
const groupLabel = (key: string): string => key.split("/").pop() ?? key;

// ─── Текстура гало узла, печём один раз ─────────────────────────────────────
// Одна мягкая радиально-градиентная текстура на все спрайты узлов (тонируем
// цветом кластера при отрисовке). Печь ОДНУ текстуру резко дешевле, чем
// покадровый BlurFilter (он бы сломал троттлинг SLEEP_FRAMES) и чем Graphics на
// каждый узел (те бы тесселлировались заново на каждом drawDot clear). Кривая
// градиента как у ClusterHullManager.createGradientTexture, только плотнее к
// центру, чтобы диск читался светящимся ядром, а не плоской заливкой.
function createHaloTexture(half = 64): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = half * 2;
  canvas.height = half * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.WHITE;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, "rgba(255,255,255,1.0)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(0.6, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, half * 2, half * 2);
  return Texture.from(canvas);
}

const MM_W = 190; // ширина мини-карты (экранные px)
const MM_H = 140; // высота мини-карты
const MM_MARGIN = 12; // отступ от угла канваса
const MM_THROTTLE = 12; // пересчитываем (медленно меняющуюся) картину кластеров раз в N кадров

/** Преобразование мир в мини-карту: центр графа плюс масштаб подгонки (world px в mm px). */
interface MinimapXform {
  cx: number;
  cy: number;
  s: number;
}
/** Мировые координаты в локальные пиксели мини-карты (от её левого верхнего угла). */
function worldToMinimap(wx: number, wy: number, t: MinimapXform): { x: number; y: number } {
  return { x: MM_W / 2 + (wx - t.cx) * t.s, y: MM_H / 2 + (wy - t.cy) * t.s };
}
/** Локальные пиксели мини-карты обратно в мировые координаты. */
function minimapToWorld(mx: number, my: number, t: MinimapXform): { x: number; y: number } {
  return { x: t.cx + (mx - MM_W / 2) / t.s, y: t.cy + (my - MM_H / 2) / t.s };
}

/** Короткая русская дата для подписи таймлайна, например "12 мар. 2025 г." */
const fmtDate = (ts: number): string =>
  new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });

type GraphSettings = {
  repulsion: number; // общее кулоновское отталкивание (насколько разлетаются узлы)
  interCluster: number; // расстояние между РАЗНЫМИ папками (тёмные провалы между островами)
  intraRepulsion: number; // доп. отталкивание между узлами ОДНОЙ папки/холла
  cohesion: number; // притяжение к барицентру своего кластера (плотность острова)
  damping: number; // сколько скорости Verlet оставляет за шаг (0..1, больше = больше инерции)
  depth: number; // режим фокуса: на сколько прыжков от узла остаётся видно
  labelZoom: number; // минимальный зум камеры, при котором появляются подписи
  showEdges: boolean; // рисовать ли линии связей вообще (выкл = чище картинка)
  frozen: boolean; // пауза симуляции (сил нет), узлы двигаются только перетаскиванием
  breathing: boolean; // лёгкий пульс капель в простое (выкл = ноль нагрузки на GPU в простое)
  showMinimap: boolean; // навигатор в правом нижнем углу
};

// Подобранные дефолты: острова сильно разнесены (далеко, рыхлые круглые холлы),
// связи скрыты, всё быстро устаканивается. "Сбросить" возвращает сюда.
const DEFAULT_SETTINGS: GraphSettings = {
  repulsion: 60000,
  interCluster: 200000,
  intraRepulsion: 96000,
  cohesion: 0.265,
  damping: 0.5,
  depth: 5,
  labelZoom: 1.35,
  showEdges: false,
  frozen: false,
  breathing: true,
  showMinimap: true,
};

// Радиус ядра метабола завязан ТОЛЬКО на внутрихолловое отталкивание: разводя
// узлы ВНУТРИ папки, мы открываем дыры, и капля растёт, чтобы их закрыть. Общее
// отталкивание и разделение островов раздувать каплю НЕ должны, иначе острова
// никогда не разойдутся (большие капли просто перемкнут новые щели заново).
//
// Радиус кластера растёт как КУБИЧЕСКИЙ КОРЕНЬ из его отталкивания (отталкивание
// 1/r^2 против линейной пружины сплочённости даёт R пропорционально rep в степени
// 1/3), так что радиус ядра считаем по тому же закону. Линейная связка раздувала
// каплю раза в три, а узлы почти не двигались.
const HULL_INTRA_REF = 20000; // примерно базовое отталкивание, на которое внутренняя сила накручивает
const hullSpread = (s: GraphSettings): number =>
  Math.cbrt(1 + s.intraRepulsion / HULL_INTRA_REF);

/** Примерное расстояние в world-px от центра узла до внешнего края нарисованного
 *  метабола. Общее для hit-теста наведения (`clusterAt`) и контура наведения
 *  (`drawHullOutline`), чтобы зона срабатывания и видимая граница совпадали. */
const blobPad = (spread: number): number => KERNEL_PAD * spread * 0.7 + 12;

type PreviewData =
  | { kind: "note"; id: string; title: string; icon: string | null; text: string }
  | { kind: "folder"; path: string; name: string; folders: number; notes: number };

// ─── Контекстное меню по правому клику ───────────────────────────────────────
// Слой указателя Pixi находит узел под курсором и отдаёт это React, который
// рисует общий <ContextMenu>. Действия, которые трогают живую симуляцию (фокус,
// закрепление), зовут обратно через refs.
type MenuTarget = {
  index: number;
  nodeKind: GraphNodeKind;
  key: string;
  fixed: boolean;
};
type MenuState = { x: number; y: number; target: MenuTarget };

// ─── Компонент ─────────────────────────────────────────────────────────────

export function GraphView() {
  const tree = useNotesStore((s) => s.tree);
  const seedTestData = useNotesStore((s) => s.seedTestData);
  const clearTestData = useNotesStore((s) => s.clearTestData);
  const setView = useNotesStore((s) => s.setView);
  const selectNote = useNotesStore((s) => s.selectNote);
  const setCurrentFolder = useNotesStore((s) => s.setCurrentFolder);
  const expandFolder = useNotesStore((s) => s.expandFolder);
  const graph = useMemo(() => buildGraph(tree), [tree]);
  const hostRef = useRef<HTMLDivElement>(null);

  const [busy, setBusy] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [seedCount, setSeedCount] = useState(100);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [colorByFolder, setColorByFolder] = useState(true);
  const [settings, setSettings] = useState<GraphSettings>(DEFAULT_SETTINGS);
  // Фильтр по тегам: каждый выбранный тег это либо включение ("in"), либо исключение ("ex").
  const [tagMode, setTagMode] = useState<Map<string, "in" | "ex">>(new Map());
  const [tagSearch, setTagSearch] = useState("");
  const [showTags, setShowTags] = useState(false);
  // Фильтр по таймлайну: показываем только заметки, созданные до `timeline` (это таймстамп).
  const [showTimeline, setShowTimeline] = useState(false);
  const [timeline, setTimeline] = useState(() => Date.now());

  // Живые ручки в работающую симуляцию, чтобы слайдеры и кнопки рулили ей, не
  // снося Pixi и не перезапуская раскладку.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const engineRef = useRef<ForceLayout | null>(null);
  const wakeRef = useRef<() => void>(() => {});
  const updateLabelsRef = useRef<() => void>(() => {});
  const fitRef = useRef<() => void>(() => {});
  const reapplyFocusRef = useRef<() => void>(() => {});
  const focusNodeRef = useRef<(key: string) => void>(() => {});
  const colorByFolderRef = useRef(colorByFolder);
  colorByFolderRef.current = colorByFolder;
  const recolorRef = useRef<(byFolder: boolean) => void>(() => {});
  const applyTagFilterRef = useRef<(visible: Set<string> | null) => void>(() => {});
  const applyThemeRef = useRef<() => void>(() => {});
  const pinIndexRef = useRef<(i: number) => void>(() => {});
  // Мостик Pixi в React: обработчик правого клика на канвасе открывает это меню.
  const openMenuRef = useRef<(m: MenuState | null) => void>(() => {});

  // Состояние контекстного меню по правому клику.
  const [menu, setMenu] = useState<MenuState | null>(null);
  openMenuRef.current = setMenu;

  // Перечитываем CSS-палитру и перекрашиваем живой граф, когда переключается
  // атрибут темы (на будущее: светлая тема, пресеты), без перестройки графа.
  useEffect(() => {
    const obs = new MutationObserver(() => applyThemeRef.current());
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);

  const runSeed = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await seedTestData(seedCount);
    } finally {
      setBusy(false);
    }
  };
  const runClear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearTestData();
    } finally {
      setBusy(false);
    }
  };

  // Перестройка графа (например, после посева) сбрасывает выбор и фильтр.
  useEffect(() => {
    setSelectedKey(null);
    setTagMode(new Map());
    setMenu(null);
  }, [graph]);

  // Перекрашиваем живой граф при смене режима цвета (без перестройки).
  useEffect(() => {
    recolorRef.current(colorByFolder);
  }, [colorByFolder]);

  // Обходим дерево ОДИН раз на смену `tree` и делим плоский список плюс Map по id
  // на все мемо ниже. Раньше allTags, timelineRange, visibleNoteIds и preview
  // каждый сам звал flattenNotes(tree), четыре обхода на рендер, и preview ещё
  // делал .find на каждый выбор.
  const allNotes = useMemo(() => flattenNotes(tree), [tree]);
  const notesById = useMemo(() => {
    const m = new Map<string, (typeof allNotes)[number]>();
    for (const n of allNotes) m.set(n.id, n);
    return m;
  }, [allNotes]);

  // Все теги по дереву с числом заметок, самые частые сверху.
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of allNotes) {
      for (const t of note.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [allNotes]);
  const visibleTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    return q ? allTags.filter(([t]) => t.toLowerCase().includes(q)) : allTags;
  }, [allTags, tagSearch]);

  // Диапазон дат создания всех заметок, для слайдера таймлайна.
  const timelineRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const note of allNotes) {
      if (note.createdAt < min) min = note.createdAt;
      if (note.createdAt > max) max = note.createdAt;
    }
    if (!Number.isFinite(min)) {
      const n = Date.now();
      return { min: n, max: n };
    }
    return { min, max };
  }, [allNotes]);
  // Сдвигаем ползунок на "сейчас" (показываем всё), как только меняется диапазон данных.
  useEffect(() => {
    setTimeline(timelineRange.max);
  }, [timelineRange.max]);

  // id заметок, проходящих фильтр по тегам (null = фильтра нет, видно всё).
  // Заметка проходит, если несёт хотя бы один включающий тег (или их вообще нет)
  // И не несёт ни одного исключающего.
  const visibleNoteIds = useMemo((): Set<string> | null => {
    const inc = new Set<string>();
    const exc = new Set<string>();
    for (const [t, m] of tagMode) (m === "in" ? inc : exc).add(t);
    const tagActive = inc.size > 0 || exc.size > 0;
    const timeActive = showTimeline && timeline < timelineRange.max;
    if (!tagActive && !timeActive) return null; // фильтра нет, видно всё
    const ids = new Set<string>();
    for (const note of allNotes) {
      const okInc = inc.size === 0 || note.tags.some((t) => inc.has(t));
      const okExc = !note.tags.some((t) => exc.has(t));
      const okTime = !timeActive || note.createdAt <= timeline;
      if (okInc && okExc && okTime) ids.add(note.id);
    }
    return ids;
  }, [tagMode, allNotes, showTimeline, timeline, timelineRange.max]);

  // Прокидываем фильтр в работающую симуляцию (без перестройки).
  useEffect(() => {
    applyTagFilterRef.current(visibleNoteIds);
  }, [visibleNoteIds]);

  const cycleTag = (tag: string, mode: "in" | "ex") =>
    setTagMode((prev) => {
      const next = new Map(prev);
      if (next.get(tag) === mode) next.delete(tag);
      else next.set(tag, mode);
      return next;
    });

  // Данные карточки превью, выводим из неймспейсного ключа кликнутого узла.
  const preview = useMemo((): PreviewData | null => {
    if (!selectedKey) return null;
    const rest = selectedKey.slice(2);
    switch (selectedKey[0]) {
      case "n": {
        const note = notesById.get(rest); // O(1), раньше был O(N) через find
        if (!note) return null;
        return {
          kind: "note",
          id: note.id,
          title: note.title || DEFAULT_NOTE_TITLE,
          icon: note.icon,
          text: note.preview,
        };
      }
      case "f": {
        const children = findFolderByPath(tree, rest);
        const c = children ? countContents(children) : { folders: 0, notes: 0 };
        return {
          kind: "folder",
          path: rest,
          name: rest.split("/").pop() || rest,
          folders: c.folders,
          notes: c.notes,
        };
      }
      default:
        return null;
    }
  }, [selectedKey, tree, notesById]);

  const openPreview = () => {
    if (!preview) return;
    if (preview.kind === "note") {
      setView("notes");
      void selectNote(preview.id);
    } else {
      setCurrentFolder(preview.path);
      expandFolder(preview.path);
      setView("files");
    }
  };

  // Содержимое меню по правому клику для текущей цели. Действия, трогающие живую
  // симуляцию (фокус, закрепление, перекраска), идут через refs в замыкание Pixi.
  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return [];
    const target = menu.target;
    const items: ContextMenuItem[] = [];
    if (target.nodeKind === "note") {
      items.push({
        kind: "item",
        label: t("Открыть заметку"),
        icon: FileText,
        onClick: () => {
          setView("notes");
          void selectNote(target.key.slice(2));
        },
      });
    } else {
      items.push({
        kind: "item",
        label: t("Открыть в Файлах"),
        icon: Folder,
        onClick: () => {
          setCurrentFolder(target.key.slice(2));
          expandFolder(target.key.slice(2));
          setView("files");
        },
      });
    }
    items.push({
      kind: "item",
      label: t("Фокус на узле"),
      icon: Target,
      onClick: () => focusNodeRef.current(target.key),
    });
    items.push({
      kind: "item",
      label: target.fixed ? t("Открепить") : t("Закрепить"),
      icon: target.fixed ? PinOff : Pin,
      onClick: () => pinIndexRef.current(target.index),
    });
    return items;
  }, [menu, setView, selectNote, setCurrentFolder, expandFolder]);

  // Отдаём наружу обработчик фокуса, чтобы поиск "В графе" из палитры команд мог
  // изолировать и отцентрировать узел здесь (палитра это отдельный компонент, а
  // Ctrl+F в виде графа открывает её в режиме графа).
  useEffect(() => {
    setGraphFocusHandler((key) => focusNodeRef.current(key));
    return () => setGraphFocusHandler(null);
  }, []);

  // Применяем изменения слайдеров к живой симуляции (без перестройки).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.settings.repulsion = settings.repulsion;
    engine.settings.interCluster = settings.interCluster;
    engine.settings.intraRepulsion = settings.intraRepulsion;
    engine.settings.cohesion = settings.cohesion;
    engine.settings.damping = settings.damping;
    reapplyFocusRef.current(); // глубина могла поменяться, пересчитываем набор фокуса
    updateLabelsRef.current();
    wakeRef.current();
  }, [settings]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || graph.order === 0) return;

    let destroyed = false;
    const app = new Application();
    let dispose = () => {};

    void (async () => {
      try {
        await app.init({
          resizeTo: host,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
          preference: "webgl", // обкатанный векторный конвейер (Graphics/Text) на бэкенде WebGL
        });
      } catch (e) {
        console.error("GraphView: Pixi init failed:", e);
        return;
      }
      if (destroyed) {
        app.destroy(true, { children: true });
        return;
      }
      host.appendChild(app.canvas);
      const dpr = window.devicePixelRatio || 1;

      const world = new Container();
      app.stage.addChild(world);
      // Порядок слоёв внутри `world` (снизу вверх): рёбра, диски узлов, подписи
      // узлов, подписи кластеров. Жидкие оболочки кластеров НЕ в `world`, их
      // ClusterHullManager рисует в offscreen-буфер и показывает спрайтом в
      // экранном пространстве под `world` (создаётся, когда появятся узлы).
      const edgeG = new Graphics();
      const hullOutlineG = new Graphics(); // граница кластера под курсором (над рёбрами, под узлами)
      // Слой гало ВЫШЕ рёбер и контура наведения, но НИЖЕ чётких дисков узлов,
      // чтобы свечение не залезало на сам узел и не мутило кольцо фокуса. Гало
      // живут тут отдельными Sprite (не детьми Graphics каждого узла), чтобы
      // g.clear() в drawDot() при перекраске их случайно не сбросил.
      const haloLayer = new Container();
      const nodeLayer = new Container();
      nodeLayer.sortableChildren = true; // поднимаем узел в фокусе над остальными
      const labelLayer = new Container();
      const hullLabelLayer = new Container();
      world.addChild(edgeG, hullOutlineG, haloLayer, nodeLayer, labelLayer, hullLabelLayer);

      // ── Физические тела из модели graphology ───────────────────────────
      const ids = graph.nodes();
      const indexById = new Map(ids.map((id, i) => [id, i]));
      const kinds: GraphNodeKind[] = ids.map(
        (id) => (graph.getNodeAttribute(id, "kind") ?? "note") as GraphNodeKind,
      );
      const degrees: number[] = ids.map((id) => graph.degree(id));
      const radii: number[] = ids.map((_id, i) => nodeRadius(kinds[i], degrees[i]));
      // Тела Verlet. `charge` одинаковый, расстояния между узлами дают `repulsion`
      // и анти-перекрытие с учётом радиуса, а не размер. `mass` слегка растёт со
      // степенью, так что хабы инертнее и оседают якорями.
      const nodes: PhysicsNode[] = ids.map((_id, i) => ({
        x: 0,
        y: 0,
        px: 0,
        py: 0,
        mass: 1 + 0.5 * Math.sqrt(degrees[i]),
        charge: 1,
        radius: radii[i],
        active: true,
        fixed: false,
      }));
      const edgesData = graph.mapEdges((_e, attrs, s, t) => ({
        a: indexById.get(s) as number,
        b: indexById.get(t) as number,
        kind: (attrs.kind as string) ?? "contains",
      }));
      // Неориентированная смежность, её использует BFS режима фокуса (раскладку рёбра не двигают).
      const adjacency: number[][] = nodes.map(() => []);
      for (const e of edgesData) {
        adjacency[e.a].push(e.b);
        adjacency[e.b].push(e.a);
      }
      // ── Кластеризация по папкам. Кластер это ПОЛНЫЙ путь папки узла, соседние
      //    подпапки (и родитель против детей) НЕ сливаются, так что у каждой
      //    папки свой остров и цвет. У каждого кластера ещё есть id для
      //    межкластерного отталкивания, которое разводит острова. Теги и корневые
      //    заметки (без папки) получают "", то есть без кластера. ──────────────
      const groupPaths = ids.map((id) => String(graph.getNodeAttribute(id, "group") ?? ""));
      const nodeGroups = groupPaths;
      const clusterIndex = new Map<string, number>();
      [...new Set(nodeGroups)]
        .filter(Boolean)
        .sort()
        .forEach((c, i) => clusterIndex.set(c, i));
      // Цвета кластеров берём из CSS-темы (--cluster-N), так что канвас и DOM
      // делят одну палитру; CLUSTER_PALETTE это встроенный запасной вариант.
      // Перечитываем при смене темы (applyTheme), перекрашивая граф без перестройки.
      let clusterPalette = readClusterPalette(CLUSTER_PALETTE);
      const colorOf = (key: string): number => {
        const idx = clusterIndex.get(key);
        if (idx === undefined) return NEUTRAL_FILL;
        return clusterPalette[idx % clusterPalette.length];
      };
      const clusterId = new Int32Array(ids.length);
      for (let i = 0; i < ids.length; i++) {
        clusterId[i] = clusterIndex.get(nodeGroups[i]) ?? -1;
      }

      // ── Группы сплочённости и спавн. Каждый кластер (отдельный путь папки) это
      //    одна группа сплочённости, чьи члены тянет слабой пружиной к общему
      //    барицентру, и папки сжимаются в плотные одноцветные комки. Дальше
      //    движок сил собирает все комки в одну связную массу (гравитация),
      //    разводя узлы отталкиванием и коллизиями; размытие метабола сплавляет
      //    касающиеся комки и смешивает их цвета по шву. ──────────────────────
      const groupMembers = new Map<number, number[]>();
      for (let i = 0; i < clusterId.length; i++) {
        const c = clusterId[i];
        if (c < 0) continue;
        let arr = groupMembers.get(c);
        if (!arr) {
          arr = [];
          groupMembers.set(c, arr);
        }
        arr.push(i);
      }
      const groups: number[][] = [];
      for (const arr of groupMembers.values()) {
        if (arr.length >= 2) groups.push(arr);
      }
      // Сеем каждый кластер по маленькому кольцу (члены разбросаны рядом со своим
      // зерном), некластеризованные узлы около начала координат. Грубая
      // предрасстановка даёт движку быстро расслабиться, а не распутывать гигантский
      // случайный клубок.
      const orderedClusters = [...clusterIndex.values()].sort((a, b) => a - b);
      const nC = Math.max(orderedClusters.length, 1);
      const seedR = 80 + nC * 20;
      const clusterSeed = new Map<number, { x: number; y: number }>();
      orderedClusters.forEach((c, idx) => {
        const ang = (idx / nC) * Math.PI * 2;
        clusterSeed.set(c, { x: Math.cos(ang) * seedR, y: Math.sin(ang) * seedR });
      });
      for (let i = 0; i < nodes.length; i++) {
        const seed = clusterId[i] >= 0 ? clusterSeed.get(clusterId[i]) : undefined;
        const baseX = seed?.x ?? 0;
        const baseY = seed?.y ?? 0;
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * 60;
        const sx = baseX + Math.cos(a) * rr;
        const sy = baseY + Math.sin(a) * rr;
        nodes[i].x = sx;
        nodes[i].y = sy;
        nodes[i].px = sx;
        nodes[i].py = sy;
      }

      const engine = new ForceLayout(
        nodes,
        edgesData.map(
          (e): PhysicsEdge => ({
            a: e.a,
            b: e.b,
            rest: radii[e.a] + radii[e.b] + 28,
          }),
        ),
        {
          ...DEFAULT_FORCE_SETTINGS,
          repulsion: settingsRef.current.repulsion,
          interCluster: settingsRef.current.interCluster,
          intraRepulsion: settingsRef.current.intraRepulsion,
          cohesion: settingsRef.current.cohesion,
          damping: settingsRef.current.damping,
        },
        groups,
        clusterId,
      );
      let sleepEnergy = 0.01 * nodes.length;
      let focusIdx: number | null = null;
      // Гейт фильтра по тегам (1 = узел проходит). applyFocus подмешивает его в `active` по И.
      const filterPass = new Uint8Array(nodes.length).fill(1);
      let filterActive = false; // фильтр тегов/таймлайна прячет узлы, замораживаем раскладку

      // Цвета узлов: палитра кластера (режим папки) или по типу, рисуем по запросу.
      const folderFill: number[] = ids.map((_id, i) => colorOf(nodeGroups[i]));
      const folderRing: number[] = ids.map((_id, i) =>
        clusterIndex.has(nodeGroups[i]) ? lighten(colorOf(nodeGroups[i]), 0.3) : NEUTRAL_RING,
      );
      // Перезаполняем массивы цветов НА МЕСТЕ (чтобы каждое замыкание сохранило
      // свою ссылку) после смены темы или перекраски отдельного кластера.
      const recomputeFolderColors = () => {
        for (let i = 0; i < ids.length; i++) {
          folderFill[i] = colorOf(nodeGroups[i]);
          folderRing[i] = clusterIndex.has(nodeGroups[i])
            ? lighten(colorOf(nodeGroups[i]), 0.3)
            : NEUTRAL_RING;
        }
      };
      const kindFill = ids.map((_id, i) => NODE_COLOR[kinds[i]]);
      const kindRing = ids.map((_id, i) => NODE_RING[kinds[i]]);

      // ── Жидкие оболочки кластеров (спецификация метабола). Ядра окрашены по
      //    КЛАСТЕРУ (папке), независимо от переключателя цвета узлов. Выходной
      //    спрайт смонтирован под `world` (индекс 0 на сцене), так что оболочки
      //    лежат под чёткими векторными узлами; `syncHulls` перерисовывает поле
      //    плотности каждый кадр, когда двигается раскладка или камера. ─────────
      // Оболочку получают только кластеры от HULL_MIN_MEMBERS членов (как и подписи),
      // одинокая заметка в своей папке не должна оставлять случайную капельку жидкости.
      const clusterSize = new Map<number, number>();
      for (let i = 0; i < clusterId.length; i++) {
        const c = clusterId[i];
        if (c >= 0) clusterSize.set(c, (clusterSize.get(c) ?? 0) + 1);
      }
      const hullManager = new ClusterHullManager(
        app.renderer,
        app.screen.width,
        app.screen.height,
        {
          radii,
          colors: folderFill,
          clustered: ids.map(
            (_id, i) =>
              clusterId[i] >= 0 && (clusterSize.get(clusterId[i]) ?? 0) >= HULL_MIN_MEMBERS,
          ),
        },
      );
      app.stage.addChildAt(hullManager.output, 0);
      // Тусклое статичное звёздное поле позади всего (экранное пространство) для глубины.
      const starsG = new Graphics();
      app.stage.addChildAt(starsG, 0);
      const drawStars = () => {
        starsG.clear();
        const sw = app.screen.width;
        const sh = app.screen.height;
        let seed = 0x9e3779b9;
        const rnd = () => {
          seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
          return seed / 0x7fffffff;
        };
        for (let i = 0; i < 150; i++) {
          const rr = rnd();
          starsG
            .circle(rnd() * sw, rnd() * sh, rr < 0.85 ? 0.8 : 1.7)
            .fill({ color: 0xaab0c8, alpha: 0.06 + rr * 0.16 });
        }
      };
      drawStars();
      // Состояние косметической анимации (его крутит animTick каждый кадр, даже на парковке).
      let animTime = 0; // секунды, гонит дыхание капель
      let animFrame = 0;
      let hoverFade = 0; // плавно от 0 к 1, проявляет/убирает границу кластера под курсором
      let lastFade = 0;
      let lastActivity = performance.now(); // гейтит дыхание в простое (см. animTick)
      const syncHulls = () => {
        const breath = 1 + BREATH_AMP * Math.sin(animTime * BREATH_W);
        hullManager.update(
          nodes,
          world.scale.x,
          world.x,
          world.y,
          hullSpread(settingsRef.current) * breath,
        );
      };
      const onRendererResize = () => {
        hullManager.resize(app.screen.width, app.screen.height);
        drawStars();
        positionMinimap();
        recomputeMinimap();
      };
      app.renderer.on("resize", onRendererResize);

      // ── Спрайты узлов: чёткие векторные диски (заливка плюс кольцо),
      //    позиционируем каждый кадр и перекрашиваем по запросу. Векторная
      //    геометрия остаётся резкой на любом зуме. ─────────────────────────
      // ОДНА общая белая текстура гало, испечённая в 2D-канвасе, не на GPU. Гало
      // каждого узла это просто тонированный Sprite этой текстуры, сотни
      // аддитивных блитов за кадр стоят копейки против одного покадрового
      // BlurFilter (фильтр ещё будил бы каждый спящий кадр, ломая SLEEP_FRAMES).
      // 192x192: на MAX_ZOOM=4x узел-хаб (radii около 14, гало около 64 world-px,
      // то есть 256 экранных px) тянет текстуру всего раза в 1.33, с запасом по
      // мягкости градиента. 128px, растянутые до 256px, давали лёгкие полосы на
      // хабах на максимальном зуме (привет от въедливого ревью).
      const haloTex = createHaloTexture(96);
      const dots: Graphics[] = [];
      const halos: Sprite[] = [];
      const labels: Text[] = [];
      ids.forEach((id, i) => {
        // Сначала гало, чтобы захватить i и не жонглировать замыканиями потом.
        const halo = new Sprite(haloTex);
        halo.anchor.set(0.5);
        // Размер в мировом пространстве: радиус плюс 18 world-px свечения с каждой
        // стороны. Намеренно живёт в `world` (масштабируется зумом): гало растёт,
        // когда приближаешь (эффект дышащей туманности), и сжимается, когда отдаляешь.
        halo.scale.set(((radii[i] + 18) * 2) / haloTex.width);
        halo.tint = colorByFolderRef.current ? folderFill[i] : kindFill[i];
        halo.alpha = 0.55;
        // Аддитивное смешивание, чтобы пересекающиеся гало в плотных кластерах
        // складывались в мягкую туманность, а не лепились непрозрачно (при пересвете
        // ограничь alpha, см. риски).
        halo.blendMode = "add";
        haloLayer.addChild(halo);
        halos.push(halo);

        const g = new Graphics();
        nodeLayer.addChild(g);
        dots.push(g);

        const label = new Text({
          text: String(graph.getNodeAttribute(id, "label") ?? ""),
          resolution: dpr,
          style: {
            fontFamily: LABEL_FONT,
            fontSize: LABEL_SIZE_PX,
            fontWeight: "500",
            fill: LABEL_COLOR,
            dropShadow: { color: 0x000000, alpha: 0.55, blur: 4, distance: 0, angle: 0 },
          },
        });
        label.anchor.set(0, 0.5);
        labelLayer.addChild(label);
        labels.push(label);
      });

      const drawDot = (i: number, byFolder: boolean) => {
        const r = radii[i];
        const g = dots[i];
        const fill = byFolder ? folderFill[i] : kindFill[i];
        const ring = byFolder ? folderRing[i] : kindRing[i];
        g.clear();
        // Чёткий сплошной диск плюс кольцо в 1px. Мягкое "сияние" раньше было
        // двумя полупрозрачными кружками прямо тут, теперь это тонированный Sprite
        // гало на узел (см. haloLayer), так что мы не платим за тесселляцию на
        // каждой перекраске, а свечение живёт в своём (аддитивном) слое под диском.
        g.circle(0, 0, r).fill({ color: fill });
        g.circle(0, 0, r).stroke({ width: 1, color: ring, alpha: 0.9 });
      };
      for (let i = 0; i < dots.length; i++) drawDot(i, colorByFolderRef.current);
      recolorRef.current = (byFolder) => {
        for (let i = 0; i < dots.length; i++) drawDot(i, byFolder);
        // Перекраска гало только по тинту: ноль перестроек геометрии и текстуры,
        // та же общая текстура, просто целочисленный апдейт Sprite.tint на узел.
        for (let i = 0; i < halos.length; i++) {
          halos[i].tint = byFolder ? folderFill[i] : kindFill[i];
        }
      };

      // Подсветка-кольцо вокруг узла в фокусе (режим фокуса).
      const focusRing = new Graphics();
      focusRing.visible = false;
      focusRing.zIndex = 20; // всегда над (поднятым) узлом в фокусе
      nodeLayer.addChild(focusRing);

      // Состояние наведения: кластер под курсором (`hoverCluster`, -1 = нет) и
      // набор индексов его узлов (`hoverLit`), по нему гасим всё остальное.
      let hoverLit: Set<number> | null = null;
      let hoverCluster = -1;

      // ── Холлы кластеров: один полупрозрачный остров на КЛАСТЕР (отдельный
      //    полный путь папки). Без вложенности: каждый узел ровно в одном острове,
      //    то есть одна подпись на остров. Теги и корневые заметки (без папки) без острова. ──
      type HullF = {
        key: string;
        members: number[];
        color: number;
      };
      const hulls: HullF[] = [];
      for (const key of clusterIndex.keys()) {
        const members: number[] = [];
        for (let i = 0; i < ids.length; i++) {
          if (nodeGroups[i] === key) members.push(i);
        }
        if (members.length < HULL_MIN_MEMBERS) continue;
        hulls.push({
          key,
          members,
          color: colorOf(key),
        });
      }
      // clusterId в индексы узлов-членов, для подсветки наведения (только кластеры,
      // у которых реально есть капля, то есть от HULL_MIN_MEMBERS членов).
      const clusterMembers = new Map<number, number[]>();
      for (const h of hulls) {
        const cid = clusterIndex.get(h.key);
        if (cid !== undefined) clusterMembers.set(cid, h.members);
      }

      const hullPillG = new Graphics(); // тёмная скруглённая подложка под подписью кластера
      hullLabelLayer.addChild(hullPillG);
      const hullTexts: Text[] = [];
      hulls.forEach((h) => {
        const ht = new Text({
          text: groupLabel(h.key),
          resolution: dpr,
          style: {
            fontFamily: LABEL_FONT,
            fontSize: 19,
            fontWeight: "800",
            fill: lighten(h.color, 0.5), // яркий оттенок собственного цвета кластера
            // Сильное тёмное гало, чтобы цветная подпись читалась поверх любой заливки и узлов.
            dropShadow: { color: 0x000000, alpha: 0.95, blur: 6, distance: 0, angle: 0 },
          },
        });
        ht.anchor.set(0.5, 1); // садим чуть выше верхнего края холла
        hullLabelLayer.addChild(ht);
        hullTexts.push(ht);
      });

      // Флаг вкл/выкл на кластер (от HULL_MIN_MEMBERS активных членов = есть капля).
      const hullOn: boolean[] = hulls.map(() => false);

      // Ставим подпись каждого кластера над его каплей и отмечаем видимые кластеры.
      // ФОРМА капли рисуется прямо из позиций узлов (выпуклой оболочки больше нет).
      const recomputeHulls = () => {
        for (let gi = 0; gi < hulls.length; gi++) {
          const h = hulls[gi];
          const ht = hullTexts[gi];
          let cx = 0;
          let minY = Infinity;
          let count = 0;
          for (const i of h.members) {
            if (!nodes[i].active) continue;
            cx += nodes[i].x;
            const top = nodes[i].y - radii[i];
            if (top < minY) minY = top;
            count++;
          }
          // Показываем подпись, пока у кластера есть капля (хотя бы 1 активный
          // член): в режиме фокуса у папки может остаться 1-2 узла, но её остров
          // (а значит и имя) должен оставаться видимым.
          if (count === 0) {
            ht.visible = false;
            hullOn[gi] = false;
            continue;
          }
          hullOn[gi] = true;
          ht.position.set(cx / count, minY - HULL_LABEL_GAP);
          ht.visible = true;
        }
      };

      // (Оболочки кластеров рисует ClusterHullManager через syncHulls, см. выше.)

      // Подписи контр-масштабируются под камеру, так что рендерятся 1:1 (всегда
      // чётко) с постоянным экранным размером и проявляются за порогом зума (как в
      // Obsidian). Позиции в мировом пространстве, так что панорама бесплатна.
      const updateLabels = () => {
        const ws = world.scale.x;
        const t = settingsRef.current.labelZoom;
        const zoomAlpha = clamp((ws - (t - LABEL_FADE_RANGE)) / LABEL_FADE_RANGE, 0, 1);
        const inv = 1 / ws;
        for (let i = 0; i < labels.length; i++) {
          const l = labels[i];
          if (!nodes[i].active) {
            l.visible = false;
            continue;
          }
          const a = zoomAlpha; // только затухание по порогу зума (без гашения при наведении)
          l.alpha = a;
          l.visible = a > 0.02;
          if (!l.visible) continue;
          l.scale.set(inv);
          l.position.set(nodes[i].x + radii[i] + LABEL_GAP * inv, nodes[i].y);
        }
        // Подписи кластеров: тот же контр-масштаб, постоянный экранный размер,
        // чётко на любом зуме. Делаем тут (не только в render), чтобы они
        // пересчитывались и на парковке.
        hullPillG.clear();
        for (let gi = 0; gi < hullTexts.length; gi++) {
          const ht = hullTexts[gi];
          if (!ht.visible) continue;
          ht.scale.set(inv);
          ht.alpha = 1;
          // Тёмная скруглённая подложка под (цветной) подписью для читаемости.
          const w = ht.width;
          const h = ht.height;
          hullPillG
            .roundRect(ht.x - w / 2 - 8 * inv, ht.y - h - 3 * inv, w + 16 * inv, h + 6 * inv, 7 * inv)
            .fill({ color: 0x0b0b12, alpha: 0.5 });
        }
      };

      let userInteracted = false;
      // Цель камеры для кинематографичного lerp (null = камера в покое или под
      // прямым управлением). Прыжки задают её, а вечно работающий animTick к ней едет.
      let camTarget: { x: number; y: number; s: number } | null = null;
      // Считает цель камеры (x, y, масштаб), кадрирующую подмножество узлов, с
      // отступом на радиус каждого узла, чтобы диски не обрезались у края вьюпорта.
      // `null` кадрирует все сейчас активные узлы, это путь авто-подгонки и
      // "Вместить". Явный список индексов (например, члены папки) кадрирует только
      // этот кластер, на этом держится клик-фокус по подписям кластеров.
      const computeBoundsTarget = (
        indices: Iterable<number> | null,
      ): { x: number; y: number; s: number } | null => {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const visit = (i: number) => {
          const n = nodes[i];
          if (!n.active) return; // скрытый узел никогда не кадрируем, чтобы фокус и фильтр тегов были согласованы
          const r = radii[i];
          if (n.x - r < minX) minX = n.x - r;
          if (n.y - r < minY) minY = n.y - r;
          if (n.x + r > maxX) maxX = n.x + r;
          if (n.y + r > maxY) maxY = n.y + r;
        };
        if (indices === null) {
          for (let i = 0; i < nodes.length; i++) visit(i);
        } else {
          for (const i of indices) visit(i);
        }
        if (!Number.isFinite(minX)) return null;
        const w = Math.max(maxX - minX, 1);
        const h = Math.max(maxY - minY, 1);
        const s = clamp(
          Math.min(
            (app.screen.width - FIT_PADDING_PX) / w,
            (app.screen.height - FIT_PADDING_PX) / h,
          ),
          MIN_ZOOM,
          MAX_ZOOM,
        );
        return {
          x: app.screen.width / 2 - ((minX + maxX) / 2) * s,
          y: app.screen.height / 2 - ((minY + maxY) / 2) * s,
          s,
        };
      };
      // Совместимость со старым кодом: "Вместить" ждёт границы по всем активным узлам.
      const computeFitTarget = (): { x: number; y: number; s: number } | null =>
        computeBoundsTarget(null);
      // Мгновенная подгонка, её зовёт авто-подгонка, пока раскладка ещё устаканивается.
      const fit = () => {
        const t = computeFitTarget();
        if (!t) return;
        world.scale.set(t.s);
        world.position.set(t.x, t.y);
      };
      // Кинематографичный прыжок: плавно ведём камеру к (x, y, масштаб).
      // Перетаскивание и колесо остаются мгновенными, а фокус, клик по мини-карте
      // и "Вместить" наезжают плавно.
      const tweenCameraTo = (x: number, y: number, s: number) => {
        camTarget = { x, y, s };
        userInteracted = true; // чтобы авто-подгонка не дралась с твином
      };
      // Клик по подписи папки: плавно подводим камеру, кадрируя только членов
      // этого кластера. Намеренно только камера, без смены `focusIdx` и без
      // applyFocus, потому что путь BFS-изоляции СПРЯТАЛ бы всё вне кластера, а
      // нужно ощущение "приблизились к папке, а остальной граф виден по краям".
      const focusCluster = (gi: number) => {
        const h = hulls[gi];
        if (!h) return;
        // Фильтруем по текущему `active`, чтобы скрытые фильтром тегов/таймлайна
        // заметки не раздували границы и не отдаляли камеру зря.
        const visible: number[] = [];
        for (const idx of h.members) if (nodes[idx].active) visible.push(idx);
        const t = computeBoundsTarget(visible);
        if (!t) return; // все члены скрыты фильтром, ничего не делаем
        tweenCameraTo(t.x, t.y, t.s);
      };
      const stepCamera = (dms: number) => {
        if (!camTarget) return;
        // Ограничиваем дельту на кадр. Подвисший кадр (тяжёлая работа на клик:
        // ре-фокус плюс пересчёт холлов, пауза GC или троттлинг вкладки) задирает
        // deltaMS, и с экспоненциальным сглаживанием, гонящим k к 1, камера
        // телепортируется за один кадр (тот самый "быстрый прыжок без анимации"
        // при частых кликах). Потолок dms держит каждый наезд плавным при любых
        // подвисах: просто едет на пару кадров дольше, а не прыгает.
        const dt = Math.min(dms, 32);
        const k = 1 - Math.pow(1 - 0.16, dt / 16.67); // не зависит от частоты кадров
        const x = world.x + (camTarget.x - world.x) * k;
        const y = world.y + (camTarget.y - world.y) * k;
        const s = world.scale.x + (camTarget.s - world.scale.x) * k;
        world.position.set(x, y);
        world.scale.set(s);
        if (
          Math.abs(camTarget.x - x) < 0.4 &&
          Math.abs(camTarget.y - y) < 0.4 &&
          Math.abs(camTarget.s - s) < 5e-4
        ) {
          world.position.set(camTarget.x, camTarget.y); // защёлкиваем и заканчиваем
          world.scale.set(camTarget.s);
          camTarget = null;
        }
        updateLabels();
        syncHulls();
        drawMinimapBox();
      };

      // ── Навигатор-мини-карта (экранное пространство, правый нижний угол).
      //    Дешёвая макро-картинка: полупрозрачные диски кластеров плюс рамка
      //    вьюпорта. Без рёбер, текста и шейдеров. ──────────────────────────
      const minimap = new Container();
      const mmBgG = new Graphics();
      const mmClustersG = new Graphics();
      const mmBoxG = new Graphics();
      minimap.addChild(mmBgG, mmClustersG, mmBoxG);
      app.stage.addChild(minimap);
      let mmXform: MinimapXform = { cx: 0, cy: 0, s: 1 };

      const positionMinimap = () => {
        minimap.position.set(
          app.screen.width - MM_W - MM_MARGIN,
          app.screen.height - MM_H - MM_MARGIN,
        );
        mmBgG
          .clear()
          .roundRect(0, 0, MM_W, MM_H, 8)
          .fill({ color: 0x0a0a0f, alpha: 0.66 })
          .stroke({ width: 1, color: 0xffffff, alpha: 0.12 });
      };
      const cameraCenterWorld = (): { x: number; y: number } => {
        const s = world.scale.x;
        return {
          x: (app.screen.width / 2 - world.x) / s,
          y: (app.screen.height / 2 - world.y) / s,
        };
      };
      // Кладём видимый на экране мировой прямоугольник на мини-карту (отдалил = большая рамка).
      const drawMinimapBox = () => {
        minimap.visible = settingsRef.current.showMinimap;
        if (!minimap.visible) return;
        const s = world.scale.x;
        const a = worldToMinimap(-world.x / s, -world.y / s, mmXform);
        const b = worldToMinimap(
          (app.screen.width - world.x) / s,
          (app.screen.height - world.y) / s,
          mmXform,
        );
        const x0 = clamp(Math.min(a.x, b.x), 0, MM_W);
        const y0 = clamp(Math.min(a.y, b.y), 0, MM_H);
        const x1 = clamp(Math.max(a.x, b.x), 0, MM_W);
        const y1 = clamp(Math.max(a.y, b.y), 0, MM_H);
        mmBoxG
          .clear()
          .rect(x0, y0, Math.max(x1 - x0, 2), Math.max(y1 - y0, 2))
          .fill({ color: 0xe2e8f0, alpha: 0.08 })
          .stroke({ width: 1.5, color: 0xe2e8f0, alpha: 0.85 });
      };
      // Пересчитываем границы мира и перерисовываем диски кластеров (троттлится, медленное макро).
      const recomputeMinimap = () => {
        if (!settingsRef.current.showMinimap) return;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const n of nodes) {
          if (n.x < minX) minX = n.x;
          if (n.y < minY) minY = n.y;
          if (n.x > maxX) maxX = n.x;
          if (n.y > maxY) maxY = n.y;
        }
        if (!Number.isFinite(minX)) return;
        mmXform = {
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          s: Math.min(
            (MM_W * 0.9) / Math.max(maxX - minX, 1),
            (MM_H * 0.9) / Math.max(maxY - minY, 1),
          ),
        };
        mmClustersG.clear();
        for (const members of clusterMembers.values()) {
          let sx = 0;
          let sy = 0;
          let cnt = 0;
          for (const i of members) {
            if (!nodes[i].active) continue;
            sx += nodes[i].x;
            sy += nodes[i].y;
            cnt++;
          }
          if (cnt === 0) continue;
          const ccx = sx / cnt;
          const ccy = sy / cnt;
          let rad = 0;
          for (const i of members) {
            if (!nodes[i].active) continue;
            const dx = nodes[i].x - ccx;
            const dy = nodes[i].y - ccy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > rad) rad = d;
          }
          const p = worldToMinimap(ccx, ccy, mmXform);
          // Зажимаем И радиус, И центр, чтобы кластер, растянутый улетевшим узлом,
          // не вылез за плашку мини-карты (без GPU-маски, детерминированно).
          const r = clamp(rad * mmXform.s, 1.5, Math.min(MM_W, MM_H) / 2 - 2);
          const cx = clamp(p.x, r, MM_W - r);
          const cy = clamp(p.y, r, MM_H - r);
          mmClustersG
            .circle(cx, cy, r)
            .fill({ color: folderFill[members[0]], alpha: 0.7 });
        }
        // Одиночные/свободные узлы (без кластера или в кластере, слишком мелком
        // для диска) всё равно получают точку, иначе граф из одних разрозненных
        // заметок выглядел бы пустым.
        for (let i = 0; i < nodes.length; i++) {
          if (!nodes[i].active) continue;
          const c = clusterId[i];
          if (c >= 0 && clusterMembers.has(c)) continue; // уже внутри диска
          const p = worldToMinimap(nodes[i].x, nodes[i].y, mmXform);
          mmClustersG.circle(p.x, p.y, 1.6).fill({ color: folderFill[i], alpha: 0.85 });
        }
        drawMinimapBox();
      };
      const minimapRect = (): { x: number; y: number } => ({
        x: app.screen.width - MM_W - MM_MARGIN,
        y: app.screen.height - MM_H - MM_MARGIN,
      });
      // Сдвигаем основную камеру так, чтобы мир (cx,cy) оказался в центре экрана.
      const centerOn = (cx: number, cy: number) => {
        const s = world.scale.x;
        world.position.set(app.screen.width / 2 - cx * s, app.screen.height / 2 - cy * s);
        userInteracted = true;
        drawMinimapBox();
        updateLabels();
        syncHulls();
      };

      const drawEdges = () => {
        edgeG.clear();
        if (!settingsRef.current.showEdges) return; // линии связей скрыты, чище картинка
        for (const e of edgesData) {
          const a = nodes[e.a];
          const b = nodes[e.b];
          if (!a.active || !b.active) continue; // прячем рёбра, цепляющие скрытый узел
          const st = EDGE_STYLE[e.kind] ?? EDGE_STYLE.contains;
          // Магистраль = связь между двумя *разными* кластерами (структурные
          // магистрали к центру): толстая и яркая. Связи внутри кластера и теговые
          // считаем внутренними: тонкие и тихие.
          const ca = clusterId[e.a];
          const cb = clusterId[e.b];
          const highway = ca >= 0 && cb >= 0 && ca !== cb;
          const width = highway ? HIGHWAY_WIDTH : st.width * INTERNAL_WIDTH_SCALE;
          const color = highway ? HIGHWAY_COLOR : st.color;
          const alpha = highway ? HIGHWAY_ALPHA : st.alpha * INTERNAL_ALPHA_SCALE;
          edgeG
            .moveTo(a.x, a.y)
            .lineTo(b.x, b.y)
            .stroke({ width, color, alpha, cap: "round" });
        }
      };

      const render = () => {
        for (let i = 0; i < nodes.length; i++) {
          if (!nodes[i].active) continue;
          dots[i].position.set(nodes[i].x, nodes[i].y);
          halos[i].position.set(nodes[i].x, nodes[i].y);
        }
        syncHulls();
        applyHoverVisual(); // гашение точек, рёбра и контур для кластера под курсором
        if (focusIdx !== null) focusRing.position.set(nodes[focusIdx].x, nodes[focusIdx].y);
        if (!userInteracted) fit();
        updateLabels(); // контр-масштаб подписей узлов и кластеров
        drawMinimapBox(); // рамка вьюпорта следует за (возможно авто-подогнанной) камерой
      };

      // ── Двигатель симуляции ────────────────────────────────────────────
      let awake = true;
      let calm = 0;
      let dragIdx = -1;
      const wake = () => {
        awake = true;
        calm = 0;
      };

      // Режим фокуса: активными (видимыми и в физике) держим только узлы в пределах
      // `depth` прыжков от `focusIdx`, всё остальное скрыто и инертно.
      const applyFocus = () => {
        let activeCount = 0;
        if (focusIdx === null) {
          for (let i = 0; i < nodes.length; i++) {
            const on = filterPass[i] === 1;
            nodes[i].active = on;
            if (on) activeCount++;
          }
          focusRing.visible = false;
        } else {
          const depth = Math.max(1, Math.round(settingsRef.current.depth));
          const seen = new Uint8Array(nodes.length);
          seen[focusIdx] = 1;
          let frontier: number[] = [focusIdx];
          for (let d = 0; d < depth && frontier.length; d++) {
            const next: number[] = [];
            for (const u of frontier) {
              for (const v of adjacency[u]) {
                if (!seen[v] && filterPass[v] === 1) {
                  seen[v] = 1;
                  next.push(v);
                }
              }
            }
            frontier = next;
          }
          for (let i = 0; i < nodes.length; i++) {
            const on = seen[i] === 1 && filterPass[i] === 1;
            nodes[i].active = on;
            if (on) activeCount++;
          }
          focusRing.clear();
          focusRing
            .circle(0, 0, radii[focusIdx] + 3)
            .stroke({ width: 1.5, color: 0xe2e8f0, alpha: 0.9 });
          focusRing.visible = true;
        }
        for (let i = 0; i < nodes.length; i++) {
          dots[i].visible = nodes[i].active;
          // Зеркалим видимость на Sprite гало, иначе свечение скрытого узла
          // болтается в режиме фокуса и выдаёт отфильтрованный набор.
          halos[i].visible = nodes[i].active;
        }
        // Поднимаем узел в фокусе, чтобы соседний диск-хаб его не перекрыл.
        for (let i = 0; i < dots.length; i++) dots[i].zIndex = 0;
        if (focusIdx !== null) dots[focusIdx].zIndex = 10;
        sleepEnergy = 0.01 * Math.max(activeCount, 1);
        wake();
      };

      // Пересчитываем гейт фильтра тегов из набора видимых id заметок (null = видно
      // всё), потом заново применяем фокус (он подмешивает гейт в `active` по И).
      // Узел-папка остаётся видимым, пока в его кластере есть видимая заметка.
      const applyTagFilter = (visible: Set<string> | null) => {
        filterActive = visible !== null;
        if (visible === null) {
          filterPass.fill(1);
        } else {
          const clusterVisible = new Set<number>();
          for (let i = 0; i < nodes.length; i++) {
            if (kinds[i] !== "note") continue;
            const pass = visible.has(ids[i].slice(2));
            filterPass[i] = pass ? 1 : 0;
            if (pass && clusterId[i] >= 0) clusterVisible.add(clusterId[i]);
          }
          for (let i = 0; i < nodes.length; i++) {
            if (kinds[i] === "note") continue;
            filterPass[i] = clusterId[i] >= 0 && clusterVisible.has(clusterId[i]) ? 1 : 0;
          }
        }
        applyFocus();
      };

      // Подсветка наведения: наведя курсор куда угодно на каплю кластера, плавно
      // проявляем мягкую цветную границу вокруг. НИЧЕГО не гаснет (остальное не
      // затемняется), только граница, плавно через `hoverFade` (см. animTick).
      const drawHullOutline = () => {
        hullOutlineG.clear();
        if (!hoverLit || hoverFade < 0.01) return;
        const pts: Pt[] = [];
        let first = -1;
        for (const i of hoverLit) {
          if (!nodes[i].active) continue;
          pts.push({ x: nodes[i].x, y: nodes[i].y });
          if (first < 0) first = i;
        }
        if (pts.length < 3 || first < 0) return;
        const hull = convexHull(pts);
        if (hull.length < 3) return;
        const spread = hullSpread(settingsRef.current);
        const pad = blobPad(spread); // примерно внешний край капли
        const ring = catmullRom(inflate(hull, pad), 8);
        const inv = 1 / world.scale.x;
        const color = lighten(folderFill[first], 0.4);
        hullOutlineG.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) hullOutlineG.lineTo(ring[i].x, ring[i].y);
        hullOutlineG
          .closePath()
          .stroke({ width: 2.5 * inv, color, alpha: 0.9 * hoverFade, cap: "round", join: "round" });
      };
      const applyHoverVisual = () => {
        drawEdges();
        drawHullOutline();
      };
      const setClusterHover = (c: number) => {
        if (c === hoverCluster) return;
        hoverCluster = c;
        if (c !== -1) hoverLit = new Set<number>(clusterMembers.get(c) ?? []);
        // При c === -1 оставляем `hoverLit`, чтобы граница могла ПЛАВНО уйти;
        // animTick его сбросит, когда `hoverFade` дойдёт почти до 0. Никакого
        // затемнения и тонировки капли больше нет.
      };
      const clusterAt = (wx: number, wy: number): number => {
        const spread = hullSpread(settingsRef.current);
        const pad = blobPad(spread);
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < nodes.length; i++) {
          if (!nodes[i].active) continue;
          const c = clusterId[i];
          if (c < 0 || !clusterMembers.has(c)) continue;
          const dx = nodes[i].x - wx;
          const dy = nodes[i].y - wy;
          const d = dx * dx + dy * dy;
          const reach = radii[i] * spread + pad; // совпадает с нарисованным контуром наведения (blobPad)
          if (d <= reach * reach && d < bestD) {
            bestD = d;
            best = c;
          }
        }
        return best;
      };

      // Косметический тикер, работает каждый кадр (даже когда физика на парковке),
      // чтобы капли дышали, а переходы наведения и пульс границы шли плавно.
      const animTick = () => {
        const dms = app.ticker.deltaMS;
        animTime += dms / 1000;
        stepCamera(dms); // кинематографичный наезд камеры (идёт даже на парковке)
        const target = hoverCluster === -1 ? 0 : 1;
        hoverFade += (target - hoverFade) * Math.min(1, dms / HOVER_EASE_MS);
        if (hoverFade < 0.01 && hoverCluster === -1 && hoverLit) {
          hoverLit = null; // граница полностью ушла, сбрасываем подсвеченный набор
          hullOutlineG.clear();
        }
        const fading = Math.abs(hoverFade - lastFade) > 0.0005;
        lastFade = hoverFade;
        if (awake) return; // тик физики уже гонит render() в этом кадре
        // Дышим, только если включено, вкладка видима и недавно была активность,
        // нечего грузить GPU без остановки, пока просто смотришь на статичный граф.
        const breathe =
          settingsRef.current.breathing &&
          !document.hidden &&
          performance.now() - lastActivity < BREATH_IDLE_MS;
        if (breathe && animFrame++ % 2 === 0) syncHulls();
        if (fading) drawHullOutline(); // анимируем затухание границы на парковке
      };

      let hullFrame = 0;
      const tick = () => {
        if (!awake) return;
        lastActivity = performance.now(); // раскладка ещё двигается, держим дыхание живым
        // Гоняем симуляцию сил только в полном виде и только без паузы. Пока в
        // фокусе или заморожено, позиции держатся (перетаскивание двигает узлы напрямую).
        const energy =
          focusIdx === null && !settingsRef.current.frozen && !filterActive
            ? engine.step()
            : 0;
        // Троттлим геометрию холлов: раз в N кадров, но каждый кадр, пока узел
        // тащат, чтобы его остров деформировался в реальном времени.
        hullFrame++;
        if (hullFrame % (dragIdx !== -1 ? 1 : HULL_THROTTLE) === 0) recomputeHulls();
        if (hullFrame % MM_THROTTLE === 0) recomputeMinimap();
        render();
        if (dragIdx === -1 && energy < sleepEnergy) {
          if (++calm > SLEEP_FRAMES) {
            awake = false;
            // Раскладка устаканилась, фиксируем камеру, чтобы авто-подгонка её не дёргала.
            userInteracted = true;
          }
        } else {
          calm = 0;
        }
      };
      recomputeHulls(); // начальная геометрия до первой отрисовки
      positionMinimap();
      recomputeMinimap();
      render();
      app.ticker.add(tick);
      app.ticker.add(animTick);

      // Перекрашиваем живой граф из текущей CSS-темы и переопределений кластеров
      // (без перестройки: позиции узлов, камера и устаканенная раскладка остаются).
      const applyTheme = () => {
        clusterPalette = readClusterPalette(CLUSTER_PALETTE);
        recomputeFolderColors();
        for (let i = 0; i < dots.length; i++) drawDot(i, colorByFolderRef.current);
        // Гало делят одну испечённую текстуру; смена темы это только тинт, без
        // перестройки текстуры и геометрии, без дёрганья ресурсов Pixi.
        const byFolder = colorByFolderRef.current;
        for (let i = 0; i < halos.length; i++) {
          halos[i].tint = byFolder ? folderFill[i] : kindFill[i];
        }
        hullManager.recolor(folderFill);
        recomputeMinimap();
        syncHulls();
      };
      // Отдаём живые ручки в React-контролы и эффект настроек.
      engineRef.current = engine;
      wakeRef.current = wake;
      updateLabelsRef.current = updateLabels;
      fitRef.current = () => {
        const t = computeFitTarget();
        if (t) tweenCameraTo(t.x, t.y, t.s); // плавно кадрируем весь граф
      };
      reapplyFocusRef.current = applyFocus;
      applyTagFilterRef.current = applyTagFilter;
      applyThemeRef.current = applyTheme;
      pinIndexRef.current = (i) => {
        if (i < 0 || i >= nodes.length) return;
        nodes[i].fixed = !nodes[i].fixed;
        wake();
      };
      // Поиск, фокус на узел по ключу: изолируем его (как при клике) и центрируем
      // камеру на нём, сохраняя текущий зум.
      focusNodeRef.current = (key) => {
        const i = indexById.get(key);
        if (i === undefined) return;
        focusIdx = i;
        applyFocus();
        const s = world.scale.x;
        tweenCameraTo(
          app.screen.width / 2 - nodes[i].x * s,
          app.screen.height / 2 - nodes[i].y * s,
          s,
        );
        setSelectedKey(key);
      };

      // ── Указатель: тащим узел (физика) или панорамируем камеру ──────────
      const canvas = app.canvas;
      // Кэшируем client rect канваса. getBoundingClientRect() форсит
      // синхронный layout, а screenToWorld зовёт его на КАЖДЫЙ pointermove, то
      // есть это сброс layout с частотой опроса ОС (до 1000-8000 Гц на современных
      // игровых мышах). Инвалидируем на resize окна и resize Pixi, чтобы кэш не
      // врал после смены вьюпорта. Тот же приём, что у движка вайтборда для своего
      // прямоугольника указателя.
      let rectCache: DOMRect | null = null;
      const invalidateRect = () => {
        rectCache = null;
      };
      const getRect = (): DOMRect => {
        if (!rectCache) rectCache = canvas.getBoundingClientRect();
        return rectCache;
      };
      window.addEventListener("resize", invalidateRect);
      window.addEventListener("scroll", invalidateRect, true);
      const screenToWorld = (clientX: number, clientY: number) => {
        const rect = getRect();
        return {
          x: (clientX - rect.left - world.x) / world.scale.x,
          y: (clientY - rect.top - world.y) / world.scale.y,
        };
      };
      const hitTest = (wx: number, wy: number): number => {
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < nodes.length; i++) {
          if (!nodes[i].active) continue; // скрытый узел не схватить и не сфокусировать
          const dx = nodes[i].x - wx;
          const dy = nodes[i].y - wy;
          const d = dx * dx + dy * dy;
          const r = radii[i] + HIT_PAD_PX;
          if (d <= r * r && d < bestD) {
            bestD = d;
            best = i;
          }
        }
        return best;
      };
      // Hit-тест по экранной плашке-подписи кластера (яркое имя папки над каждой
      // каплей). Скрытые подписи пропускаем, чтобы клик проваливался в панораму,
      // когда кластер невидим (отдалили или отфильтровали фокусом).
      //
      // ЕДИНИЦЫ: подписи холлов контр-масштабированы до inv = 1/sx в updateLabels,
      // так что Pixi отдаёт `ht.width = bounds.width * abs(ht.scale.x) =
      // bounds.width / sx`, то есть МИРОВЫЕ единицы, а не экранные px. Чтобы
      // сравнить с clientX (CSS px), проецируем bbox в экранное пространство,
      // умножая обратно на sx/sy. (По сути выходит тот же неотмасштабированный
      // `bounds.width`, но через `ht.width * sx` мы устойчивы к пересчёту метрик шрифта.)
      const clusterLabelHitTest = (clientX: number, clientY: number): number => {
        // Глушим клики по подписям, пока в фокусе узел: юзер исследует подграф, и
        // внезапный наезд камеры на весь кластер сбивает с толку (придирка из ревью).
        if (focusIdx !== null) return -1;
        const rect = getRect();
        const sx = world.scale.x;
        const sy = world.scale.y;
        for (let gi = 0; gi < hulls.length; gi++) {
          if (!hullOn[gi]) continue; // подпись скрыта (кластер отфильтрован)
          const ht = hullTexts[gi];
          if (!ht.visible) continue;
          // Якорь (0.5, 1): центр по экрану это (ht.x в мире, ht.y это базовая
          // линия текста). Bbox охватывает всю ширину текста по центру и высоту
          // текста вверх от базовой линии (плюс пара px отступа, как у тёмной
          // подложки из updateLabels).
          const cx = rect.left + ht.x * sx + world.x;
          const baselineY = rect.top + ht.y * sy + world.y;
          const halfW = (ht.width * sx) / 2 + 8;
          const top = baselineY - ht.height * sy - 3;
          const bottom = baselineY + 3;
          if (
            clientX >= cx - halfW &&
            clientX <= cx + halfW &&
            clientY >= top &&
            clientY <= bottom
          ) {
            return gi;
          }
        }
        return -1;
      };

      let mode: "none" | "pan" | "node" | "minimap" = "none";
      let mmGrabDX = 0; // смещение захвата (мир) при перетаскивании рамки вьюпорта на мини-карте
      let mmGrabDY = 0;
      let lastX = 0;
      let lastY = 0;
      let downX = 0;
      let downY = 0;
      let moved = false; // отличает клик (фокус) от перетаскивания/панорамы
      // Ставится в onDown, когда нажатие попало на плашку-подпись кластера (и НЕ на
      // узел: узлы всегда побеждают, ведь подпись висит на HULL_LABEL_GAP выше
      // верхнего узла). Ветка !moved в onUp использует это, чтобы плавно
      // сфокусироваться на кластере; сбрасываем в конце каждого жеста, чтобы не
      // протекало между кликами.
      let clickedLabelGi = -1;

      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return; // только основная кнопка, правый клик открывает меню
        userInteracted = true;
        lastActivity = performance.now();
        downX = e.clientX;
        downY = e.clientY;
        moved = false;
        setClusterHover(-1); // сбрасываем подсветку наведения на время перетаскивания/панорамы
        const rect = getRect();
        const lx = e.clientX - rect.left;
        const ly = e.clientY - rect.top;
        const mm = minimapRect();
        if (
          settingsRef.current.showMinimap &&
          lx >= mm.x &&
          lx <= mm.x + MM_W &&
          ly >= mm.y &&
          ly <= mm.y + MM_H
        ) {
          // Над мини-картой, навигируем, граф не трогаем.
          mode = "minimap";
          const wp = minimapToWorld(lx - mm.x, ly - mm.y, mmXform);
          const s = world.scale.x;
          const inBox =
            wp.x >= -world.x / s &&
            wp.x <= (app.screen.width - world.x) / s &&
            wp.y >= -world.y / s &&
            wp.y <= (app.screen.height - world.y) / s;
          if (inBox) {
            const center = cameraCenterWorld();
            mmGrabDX = wp.x - center.x; // держим точку захвата под курсором
            mmGrabDY = wp.y - center.y;
          } else {
            mmGrabDX = 0;
            mmGrabDY = 0;
            // клик вне рамки, кинематографичный прыжок и центрирование туда
            const s = world.scale.x;
            tweenCameraTo(
              app.screen.width / 2 - wp.x * s,
              app.screen.height / 2 - wp.y * s,
              s,
            );
          }
          canvas.style.cursor = "grabbing";
          return;
        }
        const w = screenToWorld(e.clientX, e.clientY);
        const hit = hitTest(w.x, w.y);
        // Hit узла побеждает hit подписи, ведь подпись висит на HULL_LABEL_GAP (34
        // world-px) выше верхнего узла, так что пересечение редкое, а если уж
        // случилось, юзер явно метил в диск узла. Считаем кликом по подписи, только
        // если под курсором больше ничего не было.
        clickedLabelGi = hit === -1 ? clusterLabelHitTest(e.clientX, e.clientY) : -1;
        if (hit !== -1) {
          mode = "node";
          dragIdx = hit;
          const node = nodes[hit];
          node.fixed = true;
          node.x = w.x;
          node.y = w.y;
          node.px = w.x; // Verlet: px == x значит нулевая скорость (без рывка при захвате)
          node.py = w.y;
          wake();
        } else {
          // С подписи тоже панорамируем: если юзер вдруг потянет, проваливаемся в
          // обычный путь панорамы, а защита `!moved` в onUp не даёт фокус-наезду
          // сработать на оборванном клике.
          mode = "pan";
          lastX = e.clientX;
          lastY = e.clientY;
        }
        canvas.style.cursor = "grabbing";
      };
      const onMove = (e: PointerEvent) => {
        lastActivity = performance.now();
        if (mode !== "none") camTarget = null; // прямое управление отменяет любой наезд
        if (mode === "minimap") {
          const rect = getRect();
          const mm = minimapRect();
          const wp = minimapToWorld(
            e.clientX - rect.left - mm.x,
            e.clientY - rect.top - mm.y,
            mmXform,
          );
          centerOn(wp.x - mmGrabDX, wp.y - mmGrabDY);
          moved = true;
          return;
        }
        if (mode === "none") {
          // В простое: подсвечиваем кластер под курсором и показываем, схватываемо ли.
          const w = screenToWorld(e.clientX, e.clientY);
          const overNode = hitTest(w.x, w.y) !== -1;
          // Hit-тест подписи только если под курсором нет узла (узел бьёт подпись
          // везде, тот же приоритет, что и в onDown).
          const overLabel = !overNode && clusterLabelHitTest(e.clientX, e.clientY) !== -1;
          setClusterHover(focusIdx === null ? clusterAt(w.x, w.y) : -1);
          canvas.style.cursor =
            overNode || overLabel || hoverCluster !== -1 ? "pointer" : "";
          return;
        }
        if (!moved && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) {
          moved = true;
        }
        if (mode === "pan") {
          world.position.set(world.x + (e.clientX - lastX), world.y + (e.clientY - lastY));
          lastX = e.clientX;
          lastY = e.clientY;
          syncHulls(); // капли в экранном пространстве, перерисовываем под новый сдвиг камеры
          drawMinimapBox(); // рамка вьюпорта едет за панорамой
        } else if (mode === "node" && dragIdx !== -1) {
          const w = screenToWorld(e.clientX, e.clientY);
          nodes[dragIdx].x = w.x;
          nodes[dragIdx].y = w.y;
          nodes[dragIdx].px = w.x; // держим скорость на нуле, пока тащим
          nodes[dragIdx].py = w.y;
        }
      };
      const onUp = () => {
        const clickMode = mode;
        const clickIdx = dragIdx;
        const labelGi = clickedLabelGi;
        if (mode === "node" && dragIdx !== -1) {
          // Настоящее перетаскивание ЗАКРЕПЛЯЕТ узел там, где бросили (fixed
          // остаётся true), и раскладка обтекает его, а не пружинит на старое
          // место. Тап (без движения) отпускает узел. Чтобы подвинуть закреплённый,
          // тащим снова, чтобы открепить, тапаем; пересев сбрасывает все пины.
          if (!moved) nodes[dragIdx].fixed = false;
          wake();
        }
        mode = "none";
        dragIdx = -1;
        clickedLabelGi = -1; // один сброс на все случаи: перетаскивание, клик, оборванный жест
        canvas.style.cursor = "";
        if (!moved) {
          // Клик по подписи в приоритете: плавно кадрируем кластер, фокус и выбор не
          // трогаем (это чистое движение камеры, без изоляции).
          if (labelGi !== -1) {
            focusCluster(labelGi);
            return;
          }
          // Тап, а не перетаскивание, значит фокус: изолируем кликнутый узел и всё в
          // пределах `depth` прыжков (вложенность папок плюс [[ссылки]]), остальное
          // ПРЯЧЕМ. Тап по тому же узлу или по пустоте снимает фокус.
          const prevFocus = focusIdx;
          if (clickMode === "node" && clickIdx !== -1) {
            focusIdx = focusIdx === clickIdx ? null : clickIdx;
          } else if (clickMode === "pan") {
            focusIdx = null;
          }
          if (focusIdx !== prevFocus) {
            applyFocus();
            // Фокус только прячет остальное, камера остаётся ровно на месте (без
            // авто-перекадровки по клику, узел не сдвигается на экране).
            setSelectedKey(focusIdx === null ? null : ids[focusIdx]);
          }
        }
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        userInteracted = true;
        camTarget = null; // зум колесом прямой, сбрасываем любой текущий наезд
        lastActivity = performance.now();
        const rect = getRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const next = clamp(
          world.scale.x * (e.deltaY < 0 ? 1.1 : 1 / 1.1),
          MIN_ZOOM,
          MAX_ZOOM,
        );
        const wx = (mx - world.x) / world.scale.x;
        const wy = (my - world.y) / world.scale.y;
        world.scale.set(next);
        world.position.set(mx - wx * next, my - wy * next);
        updateLabels(); // порог и контр-масштаб зависят от зума
        syncHulls(); // перерисовка поля плотности под новый трансформ камеры
        if (hoverCluster !== -1) drawHullOutline(); // перерисовка обводки под новую ширину зума
        drawMinimapBox(); // рамка вьюпорта растёт/сужается с зумом
      };

      const onLeave = () => setClusterHover(-1);
      // Правый клик - контекстное меню для узла/кластера под курсором.
      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation(); // канвас владеет своими правыми кликами (не даём
        // document-level обработчику contextmenu закрыть меню до нашего переоткрытия)
        const w = screenToWorld(e.clientX, e.clientY);
        const hit = hitTest(w.x, w.y);
        if (hit === -1) {
          openMenuRef.current(null); // меню только для узлов
          return;
        }
        openMenuRef.current({
          x: e.clientX,
          y: e.clientY,
          target: {
            index: hit,
            nodeKind: kinds[hit],
            key: ids[hit],
            fixed: nodes[hit].fixed,
          },
        });
      };

      canvas.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("pointerleave", onLeave);
      canvas.addEventListener("contextmenu", onContextMenu);

      dispose = () => {
        app.ticker.remove(tick);
        app.ticker.remove(animTick);
        canvas.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("pointerleave", onLeave);
        canvas.removeEventListener("contextmenu", onContextMenu);
        // Инвалидаторы кэша rect, добавлены в setup выше.
        window.removeEventListener("resize", invalidateRect);
        window.removeEventListener("scroll", invalidateRect, true);
        app.renderer.off("resize", onRendererResize);
        hullManager.destroy();
        engineRef.current = null;
        fitRef.current = () => {};
        reapplyFocusRef.current = () => {};
        applyTagFilterRef.current = () => {};
        focusNodeRef.current = () => {};
        recolorRef.current = () => {};
        applyThemeRef.current = () => {};
        pinIndexRef.current = () => {};
        openMenuRef.current(null);
        app.destroy(true, { children: true, texture: true });
      };
    })();

    return () => {
      destroyed = true;
      dispose();
    };
  }, [graph]);

  return (
    <div className="flex-1 relative overflow-hidden">
      <div ref={hostRef} className="absolute inset-0" style={{ background: GRAPH_BG }} />
      {/* Виньетка, тонкая рамка над канвасом, пропускает указатель. */}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: VIGNETTE }} />

      {/* Настройки вида и физики (живые) */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2 items-start">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowControls((v) => !v)}
            title={t("Настройки физики")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <SlidersHorizontal size={12} strokeWidth={2} />
            {t("Физика")}
          </button>
          <button
            type="button"
            onClick={() => fitRef.current()}
            title={t("Вместить весь граф")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <Maximize2 size={12} strokeWidth={2} />
            {t("Вместить")}
          </button>
          <button
            type="button"
            onClick={() => setShowTags((v) => !v)}
            title={t("Фильтр по тегам")}
            className={
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors " +
              (tagMode.size > 0
                ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
                : "bg-[var(--color-bg-overlay)] border-[var(--color-border-strong)] text-zinc-300 hover:text-white hover:bg-white/[0.06]")
            }
          >
            <Hash size={12} strokeWidth={2} />
            {t("Теги")}{tagMode.size > 0 ? ` · ${tagMode.size}` : ""}
          </button>
          <button
            type="button"
            onClick={() => setShowTimeline((v) => !v)}
            title={t("Таймлайн (по дате создания)")}
            className={
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors " +
              (showTimeline
                ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
                : "bg-[var(--color-bg-overlay)] border-[var(--color-border-strong)] text-zinc-300 hover:text-white hover:bg-white/[0.06]")
            }
          >
            <Clock size={12} strokeWidth={2} />
            {t("Время")}
          </button>
        </div>
        {showControls && (
          <div
            className="w-60 p-3 rounded-lg bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] shadow-[var(--shadow-float)] backdrop-blur-xl backdrop-saturate-[1.7] flex flex-col gap-3 overflow-y-auto overflow-x-hidden"
            style={{ maxHeight: "calc(100vh - 5rem)" }}
          >
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-400">{t("Симуляция")}</span>
              <div className="flex gap-0.5 p-0.5 rounded-md bg-black/25 border border-[var(--color-border)]">
                <SegButton
                  active={!settings.frozen}
                  onClick={() => setSettings((s) => ({ ...s, frozen: false }))}
                >
                  {t("Активна")}
                </SegButton>
                <SegButton
                  active={settings.frozen}
                  onClick={() => setSettings((s) => ({ ...s, frozen: true }))}
                >
                  {t("Пауза")}
                </SegButton>
              </div>
            </div>
            <Slider
              label={t("Отталкивание")}
              value={settings.repulsion}
              min={2000}
              max={60000}
              step={1000}
              onChange={(repulsion) => setSettings((s) => ({ ...s, repulsion }))}
            />
            <Slider
              label={t("Разделение островов")}
              value={settings.interCluster}
              min={0}
              max={200000}
              step={2000}
              onChange={(interCluster) => setSettings((s) => ({ ...s, interCluster }))}
            />
            <Slider
              label={t("Отталкивание в холле")}
              value={settings.intraRepulsion}
              min={0}
              max={200000}
              step={2000}
              onChange={(intraRepulsion) => setSettings((s) => ({ ...s, intraRepulsion }))}
            />
            <Slider
              label={t("Сплочённость")}
              value={settings.cohesion}
              min={0}
              max={0.3}
              step={0.005}
              onChange={(cohesion) => setSettings((s) => ({ ...s, cohesion }))}
            />
            <Slider
              label={t("Трение (инерция)")}
              value={settings.damping}
              min={0.5}
              max={0.97}
              step={0.01}
              onChange={(damping) => setSettings((s) => ({ ...s, damping }))}
            />
            <Slider
              label={t("Глубина связей")}
              value={settings.depth}
              min={1}
              max={5}
              step={1}
              onChange={(depth) => setSettings((s) => ({ ...s, depth }))}
            />
            <Slider
              label={t("Порог подписей")}
              value={settings.labelZoom}
              min={0}
              max={3}
              step={0.05}
              onChange={(labelZoom) => setSettings((s) => ({ ...s, labelZoom }))}
            />
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-400">{t("Цвет узлов")}</span>
              <div className="flex gap-0.5 p-0.5 rounded-md bg-black/25 border border-[var(--color-border)]">
                <SegButton active={!colorByFolder} onClick={() => setColorByFolder(false)}>
                  {t("По типу")}
                </SegButton>
                <SegButton active={colorByFolder} onClick={() => setColorByFolder(true)}>
                  {t("По папке")}
                </SegButton>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-400">{t("Связи (линии)")}</span>
              <div className="flex gap-0.5 p-0.5 rounded-md bg-black/25 border border-[var(--color-border)]">
                <SegButton
                  active={settings.showEdges}
                  onClick={() => setSettings((s) => ({ ...s, showEdges: true }))}
                >
                  {t("Показать")}
                </SegButton>
                <SegButton
                  active={!settings.showEdges}
                  onClick={() => setSettings((s) => ({ ...s, showEdges: false }))}
                >
                  {t("Скрыть")}
                </SegButton>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-400">{t("Дыхание капель")}</span>
              <div className="flex gap-0.5 p-0.5 rounded-md bg-black/25 border border-[var(--color-border)]">
                <SegButton
                  active={settings.breathing}
                  onClick={() => setSettings((s) => ({ ...s, breathing: true }))}
                >
                  {t("Вкл")}
                </SegButton>
                <SegButton
                  active={!settings.breathing}
                  onClick={() => setSettings((s) => ({ ...s, breathing: false }))}
                >
                  {t("Выкл")}
                </SegButton>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-400">{t("Мини-карта")}</span>
              <div className="flex gap-0.5 p-0.5 rounded-md bg-black/25 border border-[var(--color-border)]">
                <SegButton
                  active={settings.showMinimap}
                  onClick={() => setSettings((s) => ({ ...s, showMinimap: true }))}
                >
                  {t("Показать")}
                </SegButton>
                <SegButton
                  active={!settings.showMinimap}
                  onClick={() => setSettings((s) => ({ ...s, showMinimap: false }))}
                >
                  {t("Скрыть")}
                </SegButton>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSettings(DEFAULT_SETTINGS)}
              className="flex items-center justify-center gap-1.5 mt-0.5 py-1.5 rounded-md text-[11px] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
            >
              <RotateCcw size={11} strokeWidth={2} />
              {t("Сбросить")}
            </button>
          </div>
        )}
      </div>

      {/* Отладочная панель: засеять/очистить тестовые данные. */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <span className="text-[10px] font-mono text-zinc-600 mr-1 select-none">
          узлов: {graph.order}
        </span>
        <select
          value={seedCount}
          onChange={(e) => setSeedCount(Number(e.target.value))}
          disabled={busy}
          title={t("Сколько записей создать")}
          className="px-1.5 py-1.5 rounded-md text-[11px] font-medium bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] text-zinc-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer outline-none"
        >
          {[50, 100, 250, 500, 1000, 2000].map((n) => (
            <option key={n} value={n} className="bg-zinc-900 text-zinc-200">
              {n}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={runSeed}
          disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] text-zinc-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? (
            <Loader2 size={12} strokeWidth={2} className="animate-spin" />
          ) : (
            <Plus size={12} strokeWidth={2} />
          )}
          {t("Засеять")}
        </button>
        <button
          type="button"
          onClick={runClear}
          disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] text-zinc-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Trash2 size={12} strokeWidth={2} />
          {t("Очистить тест")}
        </button>
      </div>

      {/* Карточка превью узла (открывается по клику). */}
      {/* Ползунок таймлайна (по центру внизу): показывает заметки по дате создания. */}
      {showTimeline && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 w-[clamp(300px,40vw,520px)] px-3 py-2.5 rounded-lg bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] shadow-[var(--shadow-float)] backdrop-blur-xl backdrop-saturate-[1.7]">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex items-center gap-1.5 text-[10px] text-zinc-400 shrink-0">
                <Clock size={11} strokeWidth={2} />
                {t("Таймлайн")}
              </span>
              <span className="text-[11px] font-medium text-zinc-100 tabular-nums truncate">
                {timeline >= timelineRange.max ? t("всё время") : `${t("по")} ${fmtDate(timeline)}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowTimeline(false)}
              title={t("Закрыть")}
              className="shrink-0 -mr-1 p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>
          <input
            type="range"
            min={timelineRange.min}
            max={timelineRange.max}
            step="any"
            value={timeline}
            onChange={(e) => setTimeline(Number(e.target.value))}
            className="w-full h-1 accent-[var(--color-accent)] cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-zinc-600 mt-1 tabular-nums">
            <span>{fmtDate(timelineRange.min)}</span>
            <span>{fmtDate(timelineRange.max)}</span>
          </div>
        </div>
      )}

      {/* Фильтр по тегам: включение/исключение заметок по тегу (внизу слева). */}
      {showTags && (
        <div
          className="absolute bottom-3 left-3 z-30 w-64 rounded-lg bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] shadow-[var(--shadow-float)] backdrop-blur-xl backdrop-saturate-[1.7] flex flex-col overflow-hidden"
          style={{ maxHeight: "calc(100vh - 6rem)" }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-[11px] font-medium text-zinc-200">{t("Фильтр по тегам")}</span>
            <div className="flex items-center gap-0.5">
              {tagMode.size > 0 && (
                <button
                  type="button"
                  onClick={() => setTagMode(new Map())}
                  title={t("Сбросить фильтр")}
                  className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
                >
                  <RotateCcw size={12} strokeWidth={2} />
                </button>
              )}
                <button
                  type="button"
                  onClick={() => setShowTags(false)}
                  title={t("Закрыть")}
                className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          </div>
          <div className="px-2.5 py-2 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/25 border border-[var(--color-border)]">
              <Search size={12} strokeWidth={2} className="text-zinc-500 shrink-0" />
              <input
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                placeholder={t("Поиск тегов\u2026")}
                className="w-full bg-transparent text-[11px] text-zinc-200 placeholder:text-zinc-600 outline-none"
              />
            </div>
          </div>
          <div className="overflow-y-auto overflow-x-hidden py-1">
            {visibleTags.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-zinc-600">
                {allTags.length === 0 ? t("Нет тегов") : t("Ничего не найдено")}
              </div>
            ) : (
              visibleTags.map(([tag, count]) => {
                const mode = tagMode.get(tag);
                return (
                  <div
                    key={tag}
                    className="flex items-center gap-2 px-2.5 py-1 hover:bg-white/[0.04]"
                  >
                    <span className="flex-1 min-w-0 truncate text-[11px] text-zinc-300">
                      #{tag}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-600">{count}</span>
                    <button
                      type="button"
                      onClick={() => cycleTag(tag, "in")}
                      title={t("Показывать только эти")}
                      className={
                        "p-0.5 rounded transition-colors " +
                        (mode === "in"
                          ? "bg-emerald-500/80 text-white"
                          : "text-zinc-500 hover:text-emerald-300 hover:bg-emerald-500/10")
                      }
                    >
                      <Plus size={12} strokeWidth={2.5} />
                    </button>
                    <button
                      type="button"
                      onClick={() => cycleTag(tag, "ex")}
                      title={t("Исключить эти")}
                      className={
                        "p-0.5 rounded transition-colors " +
                        (mode === "ex"
                          ? "bg-red-500/80 text-white"
                          : "text-zinc-500 hover:text-red-300 hover:bg-red-500/10")
                      }
                    >
                      <Minus size={12} strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {preview && (
        <div
          className={
            "absolute bottom-3 z-20 w-72 rounded-lg bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] shadow-[var(--shadow-float)] backdrop-blur-xl backdrop-saturate-[1.7] overflow-hidden " +
            (showTags ? "left-[17.5rem]" : "left-3")
          }
        >
          <div className="flex items-start gap-2.5 p-3">
            <div className="mt-0.5 shrink-0">
              {preview.kind === "note" ? (
                preview.icon ? (
                  <span className="text-base leading-none">{preview.icon}</span>
                ) : (
                  <FileText size={16} strokeWidth={1.8} className="text-[#a7b0c2]" />
                )
              ) : (
                <Folder size={16} strokeWidth={1.8} className="text-[#7c86b8]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-zinc-100 truncate">
                {preview.kind === "folder" ? preview.name : preview.title}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {preview.kind === "folder"
                  ? `${preview.folders} ${pluralRu(preview.folders, t("папка"), t("папки"), t("папок"))} · ${preview.notes} ${pluralRu(preview.notes, t("заметка"), t("заметки"), t("заметок"))}`
                  : t("Заметка")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedKey(null)}
              title={t("Закрыть")}
              className="shrink-0 -mr-1 -mt-1 p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          {preview.kind === "note" && (
            <div className="px-3 -mt-1 pb-2 text-[11px] leading-relaxed text-zinc-400 line-clamp-3">
              {preview.text.trim() || t("Пустая заметка")}
            </div>
          )}
          <button
            type="button"
            onClick={openPreview}
            className="flex items-center justify-center gap-1.5 w-full px-3 py-2 border-t border-[var(--color-border)] text-[11px] font-medium text-zinc-200 hover:bg-white/[0.06] transition-colors"
          >
            {preview.kind === "note" ? t("Открыть заметку") : t("Открыть в Файлах")}
            <ArrowRight size={12} strokeWidth={2} />
          </button>
        </div>
      )}

      {graph.order === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center pointer-events-none">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-[var(--color-border)] flex items-center justify-center">
            <Network size={20} strokeWidth={1.6} className="text-zinc-600" />
          </div>
          <div className="text-zinc-400 text-sm font-medium">{t("Граф пуст")}</div>
          <div className="text-zinc-600 text-xs max-w-xs">
            Появятся заметки и папки, а связи , из{" "}
            <span className="font-mono text-zinc-500">[[ссылок]]</span>.
          </div>
        </div>
      )}

      {/* Контекстное меню по правому клику (узлы/кластеры). */}
      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}

// ─── Подкомпоненты ─────────────────────────────────────────────────────────

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-zinc-400">{label}</span>
        <span className="font-mono text-zinc-500">
          {Math.round(value * 1000) / 1000}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 accent-[var(--color-accent)] cursor-pointer"
      />
    </label>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 py-1 rounded text-[10px] font-medium transition-colors " +
        (active
          ? "bg-[var(--color-accent)] text-white"
          : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]")
      }
    >
      {children}
    </button>
  );
}

