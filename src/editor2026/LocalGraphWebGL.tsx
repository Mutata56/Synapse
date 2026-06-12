// src/editor2026/LocalGraphWebGL.tsx
//
// Инлайновый LOCAL-граф (в стиле Obsidian), рендерится на Pixi + force-directed
// раскладка. Аналог SVG `components/LocalGraph.tsx`: тот же источник данных
// (`useLocalGraph`), те же ребра (wiki-ссылки), тот же клик-для-навигации,
// но с физической раскладкой и GPU-рендерингом, чтобы оставаться плавным
// при большем количестве узлов (40 -> 200+) и выглядеть как глобальный
// граф при малых размерах.
//
// Зоны ответственности:
//   1. Монтирует один Pixi `Application`, подогнанный под CSS-бокс контейнера.
//   2. Строит `PhysicsNode[]` / `PhysicsEdge[]` из вывода `useLocalGraph`;
//      начальные позиции -- маленькое случайное облако, чтобы force-directed
//      было с чего начать.
//   3. Запускает `ForceLayout` (существующий общий движок глобального графа)
//      на отдельном rAF-тике, пока кинетическая энергия не упадет ниже
//      SETTLE_KE, потом останавливает цикл, чтобы простой граф ничего не
//     消耗овал.
//   4. Подгонка + центрирование камеры каждый кадр, пока симуляция активна
//      (дешево), потом один раз при остановке для стабильного кадрирования.
//   5. Ховер (подсветка узла + инцидентные ребра) + клик (selectNote).
//   6. Снятие Pixi + ResizeObserver + слушателей при размонтировании.
//
// Что намеренно НЕ делает (как и существующая SVG-версия):
//   - Нет панорамирования/зума -- автоподгонка достаточна для инлайн-панели,
//     а панорамирование в узкой боковой панели путает больше, чем помогает.
//   - Нет мультивыбора, редактирования, контекстного меню -- только навигация
//     в режиме чтения.
//
// Все визуальные константы наверху файла, чтобы правки дизайна не
// приходилось искать.

import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { useEffect, useRef } from "react";
import { Network } from "lucide-react";
import {
  DEFAULT_FORCE_SETTINGS,
  ForceLayout,
  type PhysicsEdge,
  type PhysicsNode,
} from "../lib/forceLayout";
import { useNotesStore } from "../store/notes";
import { useLocalGraph } from "./useLocalGraph";
import { DEFAULT_NOTE_TITLE } from "../lib/format";

// todo брать цвета из CSS-переменных а не хардкодить
const NODE_R_BASE = 4.5;
const NODE_R_GAIN = 1.2; // r += gain * sqrt(degree)
const NODE_R_CAP = 12;

// Заливка по расстоянию (уровень 0 = активная заметка, 1 = прямой сосед, 2+ = дальше).
const COLOR_CENTER = 0x818cf8; // акцентный индиго
const COLOR_L1 = 0x9aa1ad;
const COLOR_L2 = 0x5a5e6a;
const COLOR_HOVER = 0xc7d2fe;
const COLOR_RING = 0xffffff;
const COLOR_EDGE = 0x3a3d47;
const COLOR_EDGE_HI = 0x818cf8;
const COLOR_BG = 0x0d0d11;

const EDGE_REST_PX = 90;
const SETTLE_KE = 0.4; // останавливаем симуляцию, когда KE падает ниже этого
const FIT_PADDING = 24;
const HIT_PAD = 6;

// Лейблы -- размер в CSS-пикселях на экране (делим на world.scale, чтобы
// оставался постоянным независимо от зума). Скрываются при очень низком
// зуме, когда текст сливается.
const LABEL_FONT = "Inter, system-ui, -apple-system, sans-serif";
const LABEL_PX = 11;
const LABEL_COLOR = "#d4d4d8";
const LABEL_COLOR_DIM = "#71717a"; // для узлов уровня 2 (дальние)
const LABEL_MIN_ZOOM = 0.45; // скрыть лейблы ниже этого world.scale
const LABEL_GAP = 4; // пиксели между краем узла и верхом лейбла

// Панорамирование/зум -- как в глобальном графе. Колесо зумит
// мультипликативно, чтобы тачпад-пинч и колесо мыши одинаково хорошо
// работали. Ограничители не дают пользователю зумить в ничто или
// бесконечно далеко.
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3.5;
const ZOOM_STEP = 1.15;
const DRAG_THRESHOLD_PX = 4; // указатель должен сместиться больше этого, чтобы драг перебил клик

function radiusFor(degree: number, isCenter: boolean): number {
  if (isCenter) return NODE_R_CAP * 0.85;
  return Math.min(NODE_R_CAP, NODE_R_BASE + NODE_R_GAIN * Math.sqrt(degree));
}
function fillFor(level: number): number {
  if (level === 0) return COLOR_CENTER;
  if (level === 1) return COLOR_L1;
  return COLOR_L2;
}
function labelText(t: string): string {
  const trimmed = (t || "").trim() || DEFAULT_NOTE_TITLE;
  return trimmed.length > 24 ? trimmed.slice(0, 23) + "..." : trimmed;
}

export type LocalGraphWebGLProps = {
  /** Компактный = вариант для узкой боковой панели (меньше лимит узлов, без лейблов). */
  compact?: boolean;
};

export function LocalGraphWebGL({
  compact = false,
}: LocalGraphWebGLProps): JSX.Element | null {
  const activeId = useNotesStore((s) => s.activeId);
  const selectNote = useNotesStore((s) => s.selectNote);
  // Лимит совпадает с MAX_NODES (40) SVG-версии для компактного режима,
  // удвоен для полной панели -- WebGL рисует это без проблем, а широкий
  // бокс размещает узлы без кашы.
  const maxNodes = compact ? 40 : 80;
  const data = useLocalGraph(activeId, 2, { maxNodes });

  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Рефы на долгоживущие экземпляры Pixi/ForceLayout, чтобы ре-рендеры
  // не уничтожали их (вместо этого ключим по сигнатуре данных, см. эффект).
  const appRef = useRef<Application | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);

  // Сигнатура входных данных, влияющих на раскладку/рисование. Когда набор
  // узлов или ребер меняется, пересоздаем физику; движение курсора/ховер
  // не меняет сигнатуру.
  const dataSig = data.nodes
    .map((n) => `${n.id}:${n.level}:${n.degree}`)
    .join("|") + "##" + data.edges.map((e) => `${e.a}-${e.b}`).join(",");

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (data.nodes.length === 0) return; // нечего рисовать

    let cancelled = false;
    // Вызов Pixi `init` асинхронный (договаривается о WebGL). При быстром
    // размонтировании/пересоздании НЕЛЬЗЯ монтировать canvas после отмены
    // эффекта -- иначе appRef утечет между пересозданиями.
    const app = new Application();
    appRef.current = app;

    app
      .init({
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
        resizeTo: wrap,
      })
      .then(() => {
        if (cancelled) {
          app.destroy(true, { children: true });
          return;
        }
        wrap.appendChild(app.canvas);
        app.canvas.style.display = "block";
        app.canvas.style.width = "100%";
        app.canvas.style.height = "100%";

        // ── Контейнер мира (все рисуемые элементы живут здесь, чтобы камера
        //    могла панорамировать/зумить через Container.position/scale). ──
        const world = new Container();
        app.stage.addChild(world);

        const edgesGfx = new Graphics();
        const nodesGfx = new Graphics();
        const hoverGfx = new Graphics();
        // Контейнер лейблов -- один Text на узел. Живет НАД узлами; масштаб
        // каждого текста инверсно world.scale, чтобы шрифт читался как LABEL_PX
        // независимо от зума (и скрывался при LABEL_MIN_ZOOM).
        const labelsContainer = new Container();
        world.addChild(edgesGfx);
        world.addChild(nodesGfx);
        world.addChild(hoverGfx);
        world.addChild(labelsContainer);

        // ── Строим физические тела ────────────────────────────────────────
        const idIndex = new Map<string, number>();
        const nodes: PhysicsNode[] = data.nodes.map((n, i) => {
          idIndex.set(n.id, i);
          const r = radiusFor(n.degree, n.level === 0);
          // Начальное рассеивание: центр в начале координат, кольцо по
          // уровню. Случайный джиттер, чтобы интегратор имел градиент
          // для движения (вырожденные совпадающие тела заставляют Verlet
          // простаивать первые кадры).
          const ringR = n.level === 0 ? 0 : (n.level * 80 + 40);
          const a = Math.random() * Math.PI * 2;
          const x = Math.cos(a) * ringR + (Math.random() - 0.5) * 6;
          const y = Math.sin(a) * ringR + (Math.random() - 0.5) * 6;
          return {
            x,
            y,
            px: x,
            py: y,
            mass: 1 + Math.sqrt(n.degree) * 0.3,
            charge: 14 + Math.sqrt(n.degree) * 4,
            radius: r,
            active: true,
            fixed: n.level === 0, // фиксируем активную заметку в центре
          };
        });
        const edges: PhysicsEdge[] = [];
        for (const e of data.edges) {
          const a = idIndex.get(e.a);
          const b = idIndex.get(e.b);
          if (a === undefined || b === undefined) continue;
          edges.push({ a, b, rest: EDGE_REST_PX });
        }

        // Лейблы: по одному на узел. Resolution=2x рендерера для четкого
        // текста на HiDPI. Без anchor -- позиционируем текст по центру над
        // узлом и инверсно масштабируем каждый кадр, чтобы оставался
        // LABEL_PX на экране.
        const labels: Text[] = data.nodes.map((n) => {
          const style = new TextStyle({
            fontFamily: LABEL_FONT,
            fontSize: LABEL_PX,
            fill: n.level >= 2 ? LABEL_COLOR_DIM : LABEL_COLOR,
            fontWeight: n.level === 0 ? "600" : "400",
          });
          const t = new Text({ text: labelText(n.title), style });
          t.resolution = Math.max(2, app.renderer.resolution);
          t.anchor.set(0.5, 0); // по центру сверху
          labelsContainer.addChild(t);
          return t;
        });

        // ForceLayout(nodes, edges, settings?, groups?, clusterId?). Более
        // жесткие пружины + меньшая гравитация для малого инлайн-графа --
        // глобальные дефолты настроены на сотни узлов.
        const sim = new ForceLayout(nodes, edges, {
          ...DEFAULT_FORCE_SETTINGS,
          repulsion: 1800,
          stiffness: 0.12,
          gravity: 0.04,
          maxSpeed: 40,
          dt: 0.6,
        });

        let parked = false;
        let hoverIdx = -1;
        // Состояние камеры. `userInteracted` -- автопилот-выключатель: как
        // только юзер панорамирует или зумит, перестаем цеплять камеру
        // к подгонке, чтобы не конфликтовать. Сбрасывается при смене
        // сигнатуры данных (новая заметка -> новый граф -> свежая автоподгонка).
        let userInteracted = false;
        // Математика подгонки камеры -- держит граф отцентрированным на canvas
        // с равномерным масштабом и отступом `FIT_PADDING` по краям.
        const fitCamera = () => {
          let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
          for (const n of nodes) {
            const r = n.radius;
            if (n.x - r < minX) minX = n.x - r;
            if (n.y - r < minY) minY = n.y - r;
            if (n.x + r > maxX) maxX = n.x + r;
            if (n.y + r > maxY) maxY = n.y + r;
          }
          const w = Math.max(1, maxX - minX);
          const h = Math.max(1, maxY - minY);
          const cw = app.canvas.width / app.renderer.resolution;
          const ch = app.canvas.height / app.renderer.resolution;
          const innerW = Math.max(1, cw - FIT_PADDING * 2);
          const innerH = Math.max(1, ch - FIT_PADDING * 2);
          const s = Math.min(innerW / w, innerH / h, 2.5); // никогда больше 2.5x
          world.scale.set(s);
          world.position.set(
            cw / 2 - ((minX + maxX) / 2) * s,
            ch / 2 - ((minY + maxY) / 2) * s,
          );
        };

        // ── Рисование ─────────────────────────────────────────────────────
        const paint = () => {
          edgesGfx.clear();
          for (const e of edges) {
            const a = nodes[e.a];
            const b = nodes[e.b];
            const highlight =
              hoverIdx >= 0 && (e.a === hoverIdx || e.b === hoverIdx);
            const color = highlight ? COLOR_EDGE_HI : COLOR_EDGE;
            edgesGfx
              .moveTo(a.x, a.y)
              .lineTo(b.x, b.y)
              .stroke({ color, width: highlight ? 1.4 : 0.9, alpha: highlight ? 0.9 : 0.55 });
          }

          nodesGfx.clear();
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const meta = data.nodes[i];
            const isHover = i === hoverIdx;
            const fill = isHover ? COLOR_HOVER : fillFor(meta.level);
            nodesGfx.circle(n.x, n.y, n.radius).fill({ color: fill, alpha: 1 });
            if (meta.level === 0) {
              // Центр получает тонкое кольцо, чтобы было понятно -- это активная заметка.
              nodesGfx
                .circle(n.x, n.y, n.radius + 2.5)
                .stroke({ color: COLOR_RING, width: 1.2, alpha: 0.7 });
            }
          }

          // Лейблы -- позиция под каждым узлом + инверсное масштабирование,
          // чтобы размер шрифта оставался LABEL_PX на экране независимо от
          // зума. Скрываются при низком зуме, где текст нечитаем.
          const s = world.scale.x || 1;
          const invS = 1 / s;
          const labelsVisible = s >= LABEL_MIN_ZOOM;
          labelsContainer.visible = labelsVisible;
          if (labelsVisible) {
            for (let i = 0; i < labels.length; i++) {
              const n = nodes[i];
              const t = labels[i];
              t.scale.set(invS);
              // Позиция под узлом. n.radius в мировых единицах; LABEL_GAP в
              // экранных пикселях -> делим для конвертации.
              t.position.set(n.x, n.y + n.radius + LABEL_GAP * invS);
            }
          }
        };

        // ── Тик: интеграция + перерисовка. Парковка при стабилизации. ──────
        let calmFrames = 0;
        const tick = () => {
          if (parked) {
            return;
          }
          const ke = sim.step();
          // Автоподгонка только пока симуляция движется И юзер не
          // взял управление. Как только панорамирует/зумит, камеру
          // не трогаем (автоподгонка выглядела бы как борьба).
          if (!userInteracted) fitCamera();
          paint();
          if (ke < SETTLE_KE) {
            calmFrames++;
            if (calmFrames > 12) {
              parked = true;
              if (!userInteracted) {
                fitCamera();
                paint();
              }
            }
          } else {
            calmFrames = 0;
          }
        };
        app.ticker.add(tick);

        // ── Hit-тест + подключение указателя ──────────────────────────────
        // Позиция -- canvas-local CSS пиксели; конвертируем в мир через
        // обратное преобразование `world.position/scale`. Кэшируем
        // bounding rect (избегаем force-layout, как и в GraphView).
        let rectCache: DOMRect | null = null;
        const invalidateRect = () => {
          rectCache = null;
        };
        const getRect = (): DOMRect => {
          if (!rectCache) rectCache = app.canvas.getBoundingClientRect();
          return rectCache;
        };
        window.addEventListener("resize", invalidateRect);
        window.addEventListener("scroll", invalidateRect, true);
        const hitTest = (clientX: number, clientY: number): number => {
          const rect = getRect();
          const lx = clientX - rect.left;
          const ly = clientY - rect.top;
          const wx = (lx - world.position.x) / world.scale.x;
          const wy = (ly - world.position.y) / world.scale.y;
          let best = -1;
          let bestD = Infinity;
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const dx = wx - n.x;
            const dy = wy - n.y;
            const d = dx * dx + dy * dy;
            const r = n.radius + HIT_PAD / world.scale.x;
            if (d <= r * r && d < bestD) {
              bestD = d;
              best = i;
            }
          }
          return best;
        };
        // ── Панорамирование / зум ──────────────────────────────────────────
        // Драг пустой области = панорамирование; драг, начавшийся на узле = no-op
        // (одиночный драг узла конфликтовал бы с физической симуляцией).
        // Колесо зумит вокруг курсора. Первый драг/зум переключает
        // `userInteracted`, автопилот автоподгонки отключается.
        let dragging = false;
        let dragDownX = 0;
        let dragDownY = 0;
        let dragOriginCX = 0;
        let dragOriginCY = 0;
        let dragMoved = false; // пересекли DRAG_THRESHOLD? -> отличаем от клика
        let activePointerId: number | null = null;

        const onPointerDown = (e: PointerEvent) => {
          if (e.button !== 0) return; // только основная кнопка
          if (activePointerId !== null) return;
          // Если указатель стартовал на узле, не начинаем панораму -- даем
          // сработать клику.
          const onNode = hitTest(e.clientX, e.clientY) >= 0;
          if (onNode) return;
          activePointerId = e.pointerId;
          dragging = true;
          dragMoved = false;
          dragDownX = e.clientX;
          dragDownY = e.clientY;
          dragOriginCX = world.position.x;
          dragOriginCY = world.position.y;
          try {
            app.canvas.setPointerCapture(e.pointerId);
          } catch {
            /* игнорируем */
          }
          app.canvas.style.cursor = "grabbing";
        };
        const onPointerUp = (e: PointerEvent) => {
          if (e.pointerId !== activePointerId) return;
          activePointerId = null;
          dragging = false;
          app.canvas.style.cursor =
            hitTest(e.clientX, e.clientY) >= 0 ? "pointer" : "default";
        };

        const onMove = (e: PointerEvent) => {
          // Драг-для-панорамы приоритетнее -- пока панорамируем, не проверяем ховер.
          if (dragging) {
            const dx = e.clientX - dragDownX;
            const dy = e.clientY - dragDownY;
            if (
              !dragMoved &&
              Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PX
            ) {
              dragMoved = true;
              userInteracted = true; // отключаем автопилот
              parked = true; // замораживаем симуляцию, чтобы юзер управлял камерой
            }
            if (dragMoved) {
              world.position.set(dragOriginCX + dx, dragOriginCY + dy);
              paint();
            }
            return;
          }
          const next = hitTest(e.clientX, e.clientY);
          if (next !== hoverIdx) {
            hoverIdx = next;
            app.canvas.style.cursor = next >= 0 ? "pointer" : "default";
            // Принудительная перерисовка даже на парковке -- только paint, без шага физики.
            paint();
          }
        };
        const onLeave = () => {
          if (hoverIdx !== -1) {
            hoverIdx = -1;
            app.canvas.style.cursor = "default";
            paint();
          }
        };
        const onClick = (e: MouseEvent) => {
          // Гасим клик, если он шел за драг-панорамой (юзер ожидает
          // "для панорамы", а не "для перехода").
          if (dragMoved) {
            dragMoved = false;
            return;
          }
          const i = hitTest(e.clientX, e.clientY);
          if (i < 0) return;
          const target = data.nodes[i];
          if (target.id === activeId) return; // клик по центру = no-op
          void selectNote(target.id);
        };
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          userInteracted = true;
          parked = true;
          const rect = getRect();
          // Позиция курсора в canvas-local CSS пикселях.
          const lx = e.clientX - rect.left;
          const ly = e.clientY - rect.top;
          const prevS = world.scale.x || 1;
          const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
          const nextS = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prevS * factor));
          if (nextS === prevS) return;
          // Фиксируем мировую точку под курсором на экране:
          //   newPos = cursorScreen - (cursorScreen - oldPos) * (newS/oldS)
          const f = nextS / prevS;
          world.position.set(
            lx - (lx - world.position.x) * f,
            ly - (ly - world.position.y) * f,
          );
          world.scale.set(nextS);
          paint();
        };
        const onRendererResize = () => {
          invalidateRect();
          if (!userInteracted) fitCamera();
          paint();
        };
        app.canvas.addEventListener("pointerdown", onPointerDown);
        app.canvas.addEventListener("pointermove", onMove);
        app.canvas.addEventListener("pointerup", onPointerUp);
        app.canvas.addEventListener("pointercancel", onPointerUp);
        app.canvas.addEventListener("pointerleave", onLeave);
        app.canvas.addEventListener("click", onClick);
        app.canvas.addEventListener("wheel", onWheel, { passive: false });
        app.renderer.on("resize", onRendererResize);

        disposeRef.current = () => {
          app.ticker.remove(tick);
          window.removeEventListener("resize", invalidateRect);
          window.removeEventListener("scroll", invalidateRect, true);
          app.canvas.removeEventListener("pointerdown", onPointerDown);
          app.canvas.removeEventListener("pointermove", onMove);
          app.canvas.removeEventListener("pointerup", onPointerUp);
          app.canvas.removeEventListener("pointercancel", onPointerUp);
          app.canvas.removeEventListener("pointerleave", onLeave);
          app.canvas.removeEventListener("click", onClick);
          app.canvas.removeEventListener("wheel", onWheel);
          app.renderer.off("resize", onRendererResize);
          // Текстовые экземпляры уничтожаются Pixi через destroy({ children: true }).
          app.destroy(true, { children: true, texture: true });
        };
      })
      .catch((err) => {
        console.error("LocalGraphWebGL: Pixi init failed:", err);
      });

    return () => {
      cancelled = true;
      const dispose = disposeRef.current;
      disposeRef.current = null;
      appRef.current = null;
      // Если init завершился, dispose установлен и убирает всё. Иначе
      // (еще инициализируется), флаг cancelled в .then() уничтожит app,
      // когда Pixi закончит то, что делал.
      if (dispose) dispose();
    };
    // Пересоздаем физику + Pixi при смене набора узлов/ребер. Движение
    // курсора / ховер не зависит от этой сигнатуры.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSig, activeId, compact]);

  // Нечего показывать, когда у заметки нет связей вообще (по контракту с
  // SVG LocalGraph -- устаревший компонент возвращает null в этом случае,
  // вызывающие ожидают no-op).
  if (data.nodes.length <= 1) return null;

  return (
    <div
      className={
        compact
          ? "w-full mt-2"
          : "max-w-3xl mx-auto w-full px-5 sm:px-12 pb-6 pt-6"
      }
    >
      <div
        className={
          compact
            ? ""
            : "border-t border-[var(--color-border)] pt-6"
        }
      >
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
          <Network size={12} strokeWidth={2} />
          Локальный граф · {data.nodes.length - 1}
          <span className="sr-only">{DEFAULT_NOTE_TITLE}</span>
        </h3>
        <div
          ref={wrapRef}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] relative overflow-hidden"
          style={{
            // Компактный = вариант для боковой панели (короче); полный = панель в потоке.
            height: compact ? 220 : 320,
            backgroundColor: `#${COLOR_BG.toString(16).padStart(6, "0")}`,
          }}
        />
      </div>
    </div>
  );
}

