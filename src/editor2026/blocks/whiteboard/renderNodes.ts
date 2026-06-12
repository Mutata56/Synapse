// src/editor2026/blocks/whiteboard/renderNodes.ts
//
// Мировые Canvas-2D.painter'ы для флоучарт-слоя самописной бесконечной доски:
// три связываемых типа узлов (цилиндр БД, процесс/решение, карточка заметки),
// коннекторы между ними и хром инструмента связей (якорные хэндлы + черновик).
// Без React, без состояния движка , чистые функции, принимающие контекст +
// данные и рисующие, точно повторяя контракт drawShape из render.ts.

// ─────────────────────────────────────────────────────────────────────────────
// СОГЛАШЕНИЕ ПО КООРИДНАТНОМУ ПРОСТРАНСТВУ , ЧИТАЙ ПЕРЕД ПРАВКАМИ
// ─────────────────────────────────────────────────────────────────────────────
// Каждый экспортируемый.painter в этом файле работает в МИРОВОМ пространстве.
// Движок применяет камеру ПЕРЕД вызовом:
//
//     cam.applyToCtx(ctx, dpr)
//       === ctx.setTransform(zoom*dpr, 0, 0, zoom*dpr, x*dpr, y*dpr)
//
// поэтому device-трансформ = device = dpr * (world * zoom + (x, y)). Практические
// последствия для всего в этом файле:
//
//   -  Рисуем геометрию по СЫРЫМ МИРОВЫМ координатам. Никогда не умножаем
//     позиции или размеры на `cam.zoom` , контекст уже масштабирует через
//     zoom и подмешивает devicePixelRatio. Повторное умножение удвоит зум.
//
//   -  Значение, которое должно быть ПОСТОЯННЫМ НА ЭКРАНЕ независимо от зума
//     (толщины хрома, радиус якорных хэндлов, размер наконечника, длины
//     штрихов, линии селекции) ОБЯЗАН делиться на `cam.zoom`. Причина:
//     контекст умножает каждую длину на `zoom`, поэтому чтобы на экране
//     получилось `K` device-единиц, нужно подать `K / zoom`; два множителя
//     сокращаются. Вот почему везде дальше для *хрома* вы видите `/ z`.
//
//   -  Значение, которое является ЧЕРНИЛАМИ НА ХОЛСТЕ , толщина обводки узла
//     `n.sw`, размеры шрифтов тела/заголовка, которые должны расти при зуме ,
//     остаётся в МИРОВЫХ единицах и намеренно масштабируется вместе с зумом.
//     Мы НЕ делим их на zoom. (Толщина обводки грани , хром, поэтому делится;
//     чернильная обводка узла `sw` , контент, поэтому нет.)
//
//   -  Каждый.painter делает ctx.save() в начале и ctx.restore() в конце, чтобы
//     свободно мутировать strokeStyle / lineWidth / font / lineDash без утечки
//     состояния к соседним рисованиям. lineJoin/lineCap ставятся в "round"
//     там, где результат выглядит мягче и премиальнее.
//
// Painter коннекторов МОЖЕТ делегировать математику пути в ./routing (общую
// с хит-тестингом движка). См. JSDoc на `drawEdge` для точной формы
// контракта роутинга, который предполагает этот файл.

import type { WhiteboardCamera } from "./camera";
import type {
  ActionNode,
  AnchorSide,
  Bounds,
  DbNode,
  Edge,
  NoteNode,
  Pt,
  Rect,
} from "./model";
import { anchorPoint } from "./model";
import {
  arrowHead,
  pointAtFraction,
  routeBezier,
  routeOrthogonal,
  sampleCubic,
} from "./routing";
import { t } from "../../../lib/i18n";

// ─────────────────────────────────────────────────────────────────────────────
// Дизайн-токены (refined-indigo, dark-first палитра, общая с render.ts).
// Размеры хрома выражены в ЭКРАННЫХ единицах и делятся на zoom при рисовании;
// размеры чернил узлов , в мировых единицах.
// ─────────────────────────────────────────────────────────────────────────────
const ACCENT = "#818cf8"; // indigo-400, основной акцент
const ACCENT_SOFT = "#a5b4fc"; // indigo-300, мягкий акцент / конец черновика
const CHIP_BG = "rgba(14,14,16,0.92)"; // фон лейбл-чипа грани (темнее канваса)
const CHIP_TEXT = "#e5e7eb"; // текст лейбл-чипа (slate-200)
const CHIP_BORDER = "rgba(255,255,255,0.10)"; // hairline обводка лейбл-чипа
const HANDLE_FILL = "#0a0a0b"; // внутренность полого кольца хэндла
const HANDLE_STROKE = "rgba(229,231,235,0.92)"; // светлое кольцо, читается на тёмном
const MUTED_TEXT = "rgba(229,231,235,0.45)"; // плейсхолдер ("SQL")

const ANCHOR_R_SCREEN = 5; // радиус кольца якорного хэндла (экран px)
const ANCHOR_R_ACTIVE_SCREEN = 6.5; // радиус активного якоря (чуть больше)
const EDGE_W_SCREEN = 2; // толщина обводки коннектора (экран px)
const ARROW_SIZE_SCREEN = 12; // длина наконечника (экран px)
const DRAFT_DOT_SCREEN = 4; // радиус точки конца черновика (экран px)

const DB_LID_RATIO = 0.18; // высота эллиптической крышки как доля высоты узла
const NOTE_PAD = 14; // внутренний отступ текста заметки (мировые единицы)
const NOTE_DOGEAR = 22; // размер подгиба уголка (мировые единицы)
const NOTE_RADIUS = 12; // радиус скругления карточки заметки (мировые единицы)
const ACTION_RADIUS = 14; // радиус скругления узла процесса (мировые единицы)
const GEAR_R_RATIO = 0.5; // радиус шестерёнки как доля глиф-бокса

// ─────────────────────────────────────────────────────────────────────────────
// УЗЕЛ БД , чистый цилиндр базы данных.
//
// Геометрия (все мировые координаты): тело , прямоугольник высотой `bodyH`
// между эллиптической крышей сверху и эллиптическим дном снизу, обе с вертикальным
// радиусом `ry`. Рисуем заливку бока, потом дугу дна, потом эллипс крыши сверху,
// чтобы стык крыши корректно читался. Тонкая полоса блика под крышкой даёт
// цилиндру глубину. Рендерится только `title` (SQL `query` никогда).
// ─────────────────────────────────────────────────────────────────────────────
export function drawDbNode(
  ctx: CanvasRenderingContext2D,
  n: DbNode,
  cam: WhiteboardCamera,
): void {
  const z = cam.zoom || 1;
  const w = n.w;
  const h = n.h;
  // Защита от нулевых/отрицательных размеров , рисовать нечего, и математика
  // эллипсов выдаст NaN.
  if (w <= 0 || h <= 0) return;

  const x = n.x;
  const y = n.y;
  const cx = x + w / 2;
  const rx = w / 2;
  const ry = Math.min(h * DB_LID_RATIO, w / 2); // вертикальный радиус крышки/дна
  const topCy = y + ry; // центр-у верхнего эллипса крышки
  const botCy = y + h - ry; // центр-у нижнего эллипса
  const fill = useColor(n.fill, "#1e1b4b");
  const stroke = useColor(n.color, ACCENT);
  const sw = n.sw > 0 ? n.sw : 1.5; // чернильная обводка в мировых единицах (масштабируется с зумом)

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 1) Силуэт тела: левая сторона ↓, нижняя полу-эллиптическая дуга, правая
  //    сторона ↑. Залито, чтобы стенка цилиндра была сплошной; эллипс крыши
  //    рисуется поверх стыка.
  ctx.beginPath();
  ctx.moveTo(x, topCy);
  ctx.lineTo(x, botCy);
  ctx.ellipse(cx, botCy, rx, ry, 0, Math.PI, 0, true); // передняя дуга дна
  ctx.lineTo(x + w, topCy);
  // замыкаем обратно через левую (скрытую) верхнюю дугу, чтобы получить заливаемую область
  ctx.ellipse(cx, topCy, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // 2) Видимый нижний обод (передняя половина эллипса дна).
  ctx.beginPath();
  ctx.ellipse(cx, botCy, rx, ry, 0, 0, Math.PI, false);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = sw;
  ctx.stroke();

  // 3) Вертикальные стороны.
  ctx.beginPath();
  ctx.moveTo(x, topCy);
  ctx.lineTo(x, botCy);
  ctx.moveTo(x + w, topCy);
  ctx.lineTo(x + w, botCy);
  ctx.stroke();

  // 4) Тонкая внутренняя полоса блика под крышкой, читается как изогнутый блик.
  ctx.beginPath();
  ctx.ellipse(cx, topCy + ry * 0.85, rx * 0.88, ry * 0.7, 0, 0, Math.PI, false);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = sw * 0.7;
  ctx.stroke();

  // 5) Эллипс крыши (полный), рисуется последним, чтобы аккуратно сидеть
  //    поверх стыка.
  ctx.beginPath();
  ctx.ellipse(cx, topCy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = sw;
  ctx.stroke();

  // 6) Заголовок , одна строка, по центру между крышкой и дном, обрезается по ширине.
  //    Пустой заголовок , приглушённый плейсхолдер "SQL". Шрифт в мировых единицах
  //    (масштабируется с зумом), поэтому лейбл растёт вместе с узлом, а не экраном.
  const fontSize = clampNum(h * 0.2, 11, 22);
  ctx.font = fontFor(fontSize, 600);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const labelY = (topCy + botCy) / 2;
  const maxTextW = w - 18;
  if (n.title.trim()) {
    ctx.fillStyle = useColor(n.textColor ?? "", readableInk(fill));
    ctx.fillText(ellipsize(ctx, n.title.trim(), maxTextW), cx, labelY);
  } else {
    ctx.fillStyle = MUTED_TEXT;
    ctx.fillText("SQL", cx, labelY);
  }

  void z; // узел БД не использует хром, постоянный на экране; оставлено для контракта
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// УЗЕЛ ДЕЙСТВИЯ , процесс (прямоугольник со скруглёнными углами) или решение
// (ромб). Маленькая рукописная иконка шестерёнки в левом верхнем углу;
// лейбл переносится по словам и центрируется по вертикали в боксе.
// ─────────────────────────────────────────────────────────────────────────────
export function drawActionNode(
  ctx: CanvasRenderingContext2D,
  n: ActionNode,
  cam: WhiteboardCamera,
): void {
  const z = cam.zoom || 1;
  const w = n.w;
  const h = n.h;
  if (w <= 0 || h <= 0) return;

  const x = n.x;
  const y = n.y;
  const fill = useColor(n.fill, "#111827");
  const stroke = useColor(n.color, ACCENT);
  const sw = n.sw > 0 ? n.sw : 1.5;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Контур зависит от варианта, но заливка/обводка общие.
  if (n.variant === "decision") {
    // Ромб, вписанный в бокс: середины каждого ребра.
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(x + w, cy);
    ctx.lineTo(cx, y + h);
    ctx.lineTo(x, cy);
    ctx.closePath();
  } else {
    roundRectPath(ctx, x, y, w, h, Math.min(ACTION_RADIUS, w / 2, h / 2));
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = sw;
  ctx.stroke();

  // Иконка шестерёнки, левый верх. Размер привязан к узлу (мировые единицы),
  // чтобы масштабироваться естественно. Для ромба левый верх , пустое пространство,
  // поэтому сдвигаем глиф ближе к визуальному центру.
  const glyph = clampNum(Math.min(w, h) * 0.16, 9, 22);
  const gx = n.variant === "decision" ? x + w * 0.3 : x + glyph * 0.9 + 6;
  const gy = n.variant === "decision" ? y + h * 0.3 : y + glyph * 0.9 + 6;
  drawGear(ctx, gx, gy, glyph * GEAR_R_RATIO, stroke, sw);

  // Лейбл , перенос по словам под ширину бокса, блок отцентрирован по вертикали.
  if (n.label.trim()) {
    const fontSize = clampNum(Math.min(w, h) * 0.16, 11, 20);
    ctx.font = fontFor(fontSize, 500);
    ctx.fillStyle = useColor(n.textColor ?? "", readableInk(fill));
    const lineH = fontSize * 1.28;
    // У ромбов полезная ширина в центре меньше; добавляем паддинг к текстовому боксу.
    const pad = n.variant === "decision" ? w * 0.2 : 14;
    const boxX = x + pad;
    const boxW = w - pad * 2;
    const boxY = y + 8;
    const boxH = h - 16;
    drawWrappedCentered(ctx, n.label.trim(), boxX, boxY, boxW, boxH, lineH);
  }

  void z;
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// УЗЕЛ-ЗАМЕТКА , карточка с подогнутым правым верхним уголком (dog-ear),
// мягкой заливкой и hairline-обводкой. Текст переносится, выравнивается
// по левому верхнему углу с паддингом.
// ─────────────────────────────────────────────────────────────────────────────
export function drawNoteNode(
  ctx: CanvasRenderingContext2D,
  n: NoteNode,
  cam: WhiteboardCamera,
): void {
  void cam; // заметка использует только чернила в мировых единицах (без хрома)
  const w = n.w;
  const h = n.h;
  if (w <= 0 || h <= 0) return;

  const x = n.x;
  const y = n.y;
  const fill = useColor(n.fill, "#fde68a"); // тёплая бумага (заменяет старый sticky)
  const stroke = useColor(n.color, "rgba(0,0,0,0.22)");
  const sw = n.sw > 0 ? n.sw : 1.25;
  const dog = Math.min(NOTE_DOGEAR, w * 0.3, h * 0.3);
  const r = Math.max(0, Math.min(NOTE_RADIUS, w / 5, h / 5));

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Тело: скруглённая карточка с подогнутым правым верхним уголком. Тонкий
  // вертикальный градиент бумаги (чуть светлее вверху) даёт глубину ,
  // одноразово запекается в спрайт шейпа, нулевая стоимость за кадр.
  noteBodyPath(ctx, x, y, w, h, r, dog);
  const top = lighten(fill, 0.1);
  if (top !== fill) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, top);
    g.addColorStop(1, fill);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = fill;
  }
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = sw;
  ctx.stroke();

  // Подогнутый треугольник (dog-ear): чуть более тёмная полоска, чтобы подгиб
  // читался.
  ctx.beginPath();
  ctx.moveTo(x + w - dog, y);
  ctx.lineTo(x + w - dog, y + dog);
  ctx.lineTo(x + w, y + dog);
  ctx.closePath();
  ctx.fillStyle = darken(fill, 0.16);
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = sw;
  ctx.stroke();

  // Текст , авто-контраст (тёмный на тёплой бумаге), с паддингом, перенос
  // по словам. Пустой , приглушённый плейсхолдер, чтобы свежая заметка не
  // выглядела как пустая карточка.
  const fontSize = clampNum(w * 0.075, 12, 18);
  ctx.font = fontFor(fontSize, 400);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const lineH = fontSize * 1.34;
  if (n.text.trim()) {
    ctx.fillStyle = useColor(n.textColor ?? "", readableInk(fill));
    drawWrappedTopLeft(
      ctx,
      n.text.trim(),
      x + NOTE_PAD,
      y + NOTE_PAD,
      w - NOTE_PAD * 2,
      h - NOTE_PAD * 2,
      lineH,
    );
  } else {
    ctx.fillStyle = mutedInk(fill);
    ctx.fillText(t("Заметка"), x + NOTE_PAD, y + NOTE_PAD);
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// ГРАНЬ (коннектор) между двумя прямоугольниками узлов.
//
// КОНТРАКТ РОУТИНГА (точно совпадает с ./routing):
//   -  routeOrthogonal(from: Pt, fromSide, to: Pt, toSide): Pt[]
//       , упорядоченная полилиния в мировых координатах (>= 2 точек);
//         points[0] === `from` (исходный якорь), последняя === `to` (целевой).
//   -  routeBezier(from: Pt, fromSide, to: Pt, toSide): { c1: Pt; c2: Pt }
//       , только две контрольные точки кубика; концы кривой , `from` и `to`,
//         которые у нас уже есть, передаём их в bezierCurveTo.
//   -  arrowHead(tip: Pt, dir: Pt, size: number): { b1: Pt; b2: Pt }
//       , две точки барбов; залитый треугольник , [tip, b1, b2]. `dir` , вектор,
//         смотрящий В кончик (направление движения при приближении); `size` ,
//         длина барба в МИРОВЫХ единицах; передаём ARROW_SIZE_SCREEN / zoom,
//         чтобы наконечник был постоянных ~12 px на экране.
//
//   ВАЖНО: роутеры принимают ТОЧКИ якорей, а не прямоугольники, поэтому
//   конвертируем якорные мировые точки из прямоугольников через
//   model.anchorPoint() перед вызовом. Направление приближения вычисляется
//   из геометрии пути (последние две различные точки / касательная кривой),
//   поэтому наконечник всегда выровнен с обводкой независимо от типа роутинга.
//
// Толщина обводки грани и размер наконечника , ХРОМ, делятся на zoom,
// чтобы коннектор оставался постоянной толщины на экране при любом зуме.
// ─────────────────────────────────────────────────────────────────────────────
export function drawEdge(
  ctx: CanvasRenderingContext2D,
  edge: Edge,
  fromRect: Rect,
  toRect: Rect,
  cam: WhiteboardCamera,
): void {
  if (fromRect.w <= 0 || fromRect.h <= 0 || toRect.w <= 0 || toRect.h <= 0) {
    return;
  }
  const z = cam.zoom || 1;
  const color = useColor(edge.color, ACCENT);
  const labelT = edge.labelT ?? 0.5; // позиция лейбл-чипа по длине дуги

  // Конвертируем две мировые точки якорей, с которыми работают роутеры.
  const fromPt = anchorPoint(fromRect, edge.fromSide);
  const toPt = anchorPoint(toRect, edge.toSide);

  // `tip` , целевой якорь; `approach` , точка, через которую путь проходит
  // перед кончиком; вместе дают направление приближения. `mid` , центр
  // опционального лейбл-чипа.
  let tip: Pt;
  let approach: Pt;
  let mid: Pt;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.lineWidth = EDGE_W_SCREEN / z; // хром, постоянный на экране

  if (edge.routing === "bezier") {
    const { c1, c2 } = routeBezier(fromPt, edge.fromSide, toPt, edge.toSide);
    ctx.beginPath();
    ctx.moveTo(fromPt.x, fromPt.y);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, toPt.x, toPt.y);
    ctx.stroke();
    tip = toPt;
    // Направление приближения ≈ касательная при t=1, смотрит от c2 , tip.
    // Откат на исходный якорь, если контрольная точка вырожденная.
    approach = samePt(c2, toPt) ? fromPt : c2;
    mid = pointAtFraction(sampleCubic(fromPt, c1, c2, toPt, 24), labelT);
  } else {
    const pts = routeOrthogonal(fromPt, edge.fromSide, toPt, edge.toSide);
    if (pts.length < 2) {
      // Вырожденный роут , прямой сегмент якорь-якорь, чтобы хоть что-то
      // отрендерилось.
      ctx.beginPath();
      ctx.moveTo(fromPt.x, fromPt.y);
      ctx.lineTo(toPt.x, toPt.y);
      ctx.stroke();
      tip = toPt;
      approach = fromPt;
      mid = pointAtFraction([fromPt, toPt], labelT);
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      tip = pts[pts.length - 1];
      approach = lastDistinct(pts) ?? pts[0];
      mid = pointAtFraction(pts, labelT);
    }
  }

  // Наконечник на целевом конце. `dir` смотрит В кончик (направление движения);
  // arrowHead возвращает две точки барбов, треугольник , [tip, b1, b2].
  const dir: Pt = { x: tip.x - approach.x, y: tip.y - approach.y };
  const { b1, b2 } = arrowHead(tip, dir, ARROW_SIZE_SCREEN / z);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(b1.x, b1.y);
  ctx.lineTo(b2.x, b2.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // Опциональный лейбл-чип в геометрическом центре. Фон чуть темнее канваса;
  // всё, связанное с чипом , хром, делится на zoom.
  if (edge.label && edge.label.trim()) {
    drawEdgeLabelChip(ctx, edge.label.trim(), mid, z);
  }

  ctx.restore();
}

/** Рисует маленький скруглённый лейбл-чип для грани, отцентрированный на `mid`. */
function drawEdgeLabelChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  mid: Pt,
  z: number,
): void {
  const fontSize = 11 / z; // хром-текст, постоянный на экране
  const padX = 7 / z;
  const padY = 4 / z;
  const radius = 6 / z;

  ctx.save();
  ctx.font = fontFor(fontSize, 500);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Ограничиваем ширину чипа, чтобы длинный лейбл не рос бесконечно.
  const maxChipW = 220 / z;
  const label = ellipsize(ctx, text, maxChipW);
  const tw = ctx.measureText(label).width;
  const cw = tw + padX * 2;
  const ch = fontSize + padY * 2;

  roundRectPath(ctx, mid.x - cw / 2, mid.y - ch / 2, cw, ch, radius);
  ctx.fillStyle = CHIP_BG;
  ctx.fill();
  ctx.strokeStyle = CHIP_BORDER;
  ctx.lineWidth = 1 / z;
  ctx.stroke();

  ctx.fillStyle = CHIP_TEXT;
  ctx.fillText(label, mid.x, mid.y + 0.5 / z);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// ЯКОРНЫЕ ХЭНДЛЫ , четыре точки-коннектора на середине ребра, показываемые
// при активном инструменте link. Полые светлые кольца; активная сторона
// (текущая цель привязки) залита акцентом и нарисована чуть крупнее.
// Все размеры , хром, делятся на zoom.
// ─────────────────────────────────────────────────────────────────────────────
export function drawAnchorHandles(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  cam: WhiteboardCamera,
  active?: AnchorSide | null,
): void {
  if (r.w <= 0 || r.h <= 0) return;
  const z = cam.zoom || 1;
  const baseR = ANCHOR_R_SCREEN / z;
  const activeR = ANCHOR_R_ACTIVE_SCREEN / z;
  const lw = 1.5 / z;

  ctx.save();
  ctx.lineWidth = lw;
  const sides: readonly AnchorSide[] = ["top", "right", "bottom", "left"];
  for (const side of sides) {
    const p = anchorPoint(r, side);
    const isActive = side === active;
    ctx.beginPath();
    ctx.arc(p.x, p.y, isActive ? activeR : baseR, 0, Math.PI * 2);
    if (isActive) {
      ctx.fillStyle = ACCENT;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    } else {
      ctx.fillStyle = HANDLE_FILL;
      ctx.fill();
      ctx.strokeStyle = HANDLE_STROKE;
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// ЧЕРНОВИК СВЯЗИ , пунктирный коннектор, рисуемый пока пользователь тащит
// из якоря до отпускания на цели. Акцентный цвет, пунктир, мягкая точка
// на конце у курсора. Весь хром делится на zoom.
// ─────────────────────────────────────────────────────────────────────────────
export function drawLinkDraft(
  ctx: CanvasRenderingContext2D,
  from: Pt,
  to: Pt,
  cam: WhiteboardCamera,
): void {
  const z = cam.zoom || 1;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.75 / z;
  ctx.setLineDash([6 / z, 4 / z]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Мягкая точка конца: залитый акцентный диск с тонким глоу, чтобы читалась
  // как живая цель курсора.
  const r = DRAFT_DOT_SCREEN / z;
  ctx.beginPath();
  ctx.arc(to.x, to.y, r * 1.9, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(129,140,248,0.18)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT_SOFT;
  ctx.fill();

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// ХЭНДЛЫ ИЗМЕНЕНИЯ РАЗМЕРА , восемь маленьких акцентных квадратиков вокруг
// выбранного прямоугольного шейпа. Постоянный размер на экране (÷ zoom).
// Мировое пространство (камера уже применена).
// ─────────────────────────────────────────────────────────────────────────────
export function drawResizeHandles(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  cam: WhiteboardCamera,
): void {
  if (r.w <= 0 || r.h <= 0) return;
  const z = cam.zoom || 1;
  const hs = 8 / z; // ребро хэндла (экран px)
  const rad = 2.5 / z; // скругление углов
  const lw = 1.25 / z;
  const { x, y, w, h } = r;
  const pts: Pt[] = [
    { x, y },
    { x: x + w / 2, y },
    { x: x + w, y },
    { x: x + w, y: y + h / 2 },
    { x: x + w, y: y + h },
    { x: x + w / 2, y: y + h },
    { x, y: y + h },
    { x, y: y + h / 2 },
  ];
  ctx.save();
  for (const p of pts) {
    // Мягкая тень, потом чёткий белый хэндл с hairline акцентной обводкой ,
    // лук Figma/Linear. Постоянный размер на экране (÷ zoom).
    roundRectPath(ctx, p.x - hs / 2, p.y - hs / 2 + 0.6 / z, hs, hs, rad);
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.fill();
    roundRectPath(ctx, p.x - hs / 2, p.y - hs / 2, hs, hs, rad);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// МАРКИЗ , прямоугольник box-выделения (пунктирная акцентная обводка +
// тонкая заливка). Мировое пространство; `a`/`b` , углы перетаскивания.
// Пунктир и толщина постоянны на экране.
// ─────────────────────────────────────────────────────────────────────────────
export function drawMarquee(
  ctx: CanvasRenderingContext2D,
  a: Pt,
  b: Pt,
  cam: WhiteboardCamera,
): void {
  const z = cam.zoom || 1;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 3 / z);
  ctx.fillStyle = "rgba(129,140,248,0.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(165,180,252,0.9)";
  ctx.lineWidth = 1 / z;
  ctx.setLineDash([4 / z, 3 / z]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// БЭЙДЖ БЛОКИРОВКИ , крошечный значок замка в левом верхнем углу заблокированного
// шейпа, чтобы было очевидно, что его нельзя двигать/менять размер/удалять.
// Мировое пространство, постоянный размер.
// ─────────────────────────────────────────────────────────────────────────────
export function drawLockBadge(
  ctx: CanvasRenderingContext2D,
  b: Bounds,
  cam: WhiteboardCamera,
): void {
  const z = cam.zoom || 1;
  const size = 13 / z; // ребро бокса бэйджа (экран px)
  const pad = 3 / z;
  const x = b.minX + pad;
  const y = b.minY + pad;

  ctx.save();
  // Фон бэйджа.
  roundRectPath(ctx, x, y, size, size, 3 / z);
  ctx.fillStyle = "rgba(10,10,12,0.88)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1 / z;
  ctx.stroke();

  // Глиф замка.
  const cx = x + size / 2;
  const bodyTop = y + size * 0.48;
  const bodyW = size * 0.5;
  const bodyH = size * 0.32;
  ctx.strokeStyle = "rgba(229,231,235,0.92)";
  ctx.fillStyle = "rgba(229,231,235,0.92)";
  ctx.lineWidth = Math.max(1 / z, size * 0.09);
  ctx.beginPath();
  ctx.arc(cx, bodyTop, size * 0.17, Math.PI, 0); // дужка
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(cx - bodyW / 2, bodyTop, bodyW, bodyH); // тело
  ctx.fill();
  ctx.restore();
}

// ═════════════════════════════════════════════════════════════════════════════
// ЧАСТНЫЕ ХЕЛПЕРЫ , автономные (НЕ импортируются из render.ts), чтобы модуль
// был самодостаточным. Все работают в пространстве вызывающего.
// ═════════════════════════════════════════════════════════════════════════════

/** Стандартный UI-стек шрифтов, `px` мировых единиц и указанная толщина. */
function fontFor(px: number, weight = 400): string {
  return `${weight} ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
}

/** Клип `v` в [lo, hi]. */
function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Непустая строка цвета или `fallback` при пустом / "none" / "transparent". */
function useColor(c: string, fallback: string): string {
  return c && c !== "none" && c !== "transparent" ? c : fallback;
}

/**
 * Выбирает тёмную или светлую чернильность для читаемого текста поверх `bg`.
 * Парсим ведущий hex (#rgb / #rrggbb) для быстрой оценки яркости; не-hex
 * заливки (rgba/именованные) по умолчанию дают светлые чернила, что подходит
 * dark-first палитре.
 */
function readableInk(bg: string): string {
  const rgb = parseHex(bg);
  if (!rgb) return "#e5e7eb";
  // Яркость по Rec. 601.
  const luma = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luma > 0.6 ? "#1f2937" : "#f3f4f6";
}

/** Парсит #rgb / #rrggbb , {r,g,b} (0-255) или null, если не hex-цвет. */
function parseHex(c: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/** Рисует подпуть скруглённого прямоугольника (не заливает/обводит). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Рисует тело карточки заметки: скруглённый прямоугольник, чей ПРАВЫЙ ВЕРХНИЙ
 * уголок подогнут (диагональный срез размером `dog`) вместо скругления , силуэт
 * dog-ear. Остальные три угла скруглены на `r`.
 */
function noteBodyPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  dog: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - dog, y); // верхнее ребро , начало подгиба
  ctx.lineTo(x + w, y + dog); // диагональный подгиб
  ctx.lineTo(x + w, y + h - r); // правое ребро
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r); // правый нижний
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r); // левый нижний
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r); // левый верхний
  ctx.closePath();
}

/** Смешивает hex-цвет к белому на `amt` (0..1). Не-hex входы проходят как есть. */
function lighten(c: string, amt: number): string {
  const rgb = parseHex(c);
  if (!rgb) return c;
  const m = (v: number) => Math.round(v + (255 - v) * amt);
  return `rgb(${m(rgb.r)},${m(rgb.g)},${m(rgb.b)})`;
}

/** Смешивает hex-цвет к чёрному на `amt` (0..1). Не-hex входы проходят как есть. */
function darken(c: string, amt: number): string {
  const rgb = parseHex(c);
  if (!rgb) return c;
  const m = (v: number) => Math.round(v * (1 - amt));
  return `rgb(${m(rgb.r)},${m(rgb.g)},${m(rgb.b)})`;
}

/** Приглушённые чернила, остающиеся читаемыми поверх `bg`. */
function mutedInk(bg: string): string {
  return readableInk(bg) === "#1f2937"
    ? "rgba(0,0,0,0.40)"
    : "rgba(255,255,255,0.40)";
}

/**
 * Обрезает `text` по `maxW` (с текущим шрифтом ctx), добавляя "…".
 * Возвращает оригинальную строку, если уже влезает. Защищает от <= 0.
 */
function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string {
  if (maxW <= 0) return "";
  if (ctx.measureText(text).width <= maxW) return text;
  const ell = "…";
  const ellW = ctx.measureText(ell).width;
  if (ellW > maxW) return ""; // даже многоточие не влезает
  let lo = 0;
  let hi = text.length;
  // Бинарный поиск самого длинного префикса, влезающего с многоточием.
  while (lo < hi) {
    const midN = (lo + hi + 1) >> 1;
    const w = ctx.measureText(text.slice(0, midN)).width + ellW;
    if (w <= maxW) lo = midN;
    else hi = midN - 1;
  }
  return text.slice(0, lo).trimEnd() + ell;
}

/**
 * Разбивает `text` на строки не шире `maxW` (с текущим шрифтом ctx),
 * учитывая явные "\n". Последняя строка, которая пересекает `maxLines`
 * (вычисляется из `maxH`/`lineH`), обрезается многоточием. Возвращает
 * строки, не рисует.
 */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  lineH: number,
  maxH: number,
): string[] {
  if (maxW <= 0 || lineH <= 0) return [];
  const maxLines = Math.max(1, Math.floor(maxH / lineH));
  const out: string[] = [];

  const paragraphs = text.split("\n");
  for (const para of paragraphs) {
    if (out.length >= maxLines) break;
    if (para === "") {
      out.push("");
      continue;
    }
    // Сохраняем пробельные токены, чтобы перенос читался естественно.
    const tokens = para.split(/(\s+)/);
    let line = "";
    for (const tok of tokens) {
      const test = line + tok;
      if (ctx.measureText(test).width > maxW && line.trim() !== "") {
        out.push(line.trimEnd());
        if (out.length >= maxLines) break;
        line = tok.trimStart();
      } else {
        line = test;
      }
    }
    if (out.length < maxLines && line.trim() !== "") out.push(line.trimEnd());
  }

  // Если достигнут лимит и текст ещё есть, обрезаем последнюю видимую строку.
  if (out.length >= maxLines) {
    const truncated = out.slice(0, maxLines);
    const last = truncated[maxLines - 1] ?? "";
    truncated[maxLines - 1] = ellipsize(ctx, last + "…", maxW) || last;
    return truncated;
  }
  return out;
}

/** Рисует текст с переносом, выровненный по левому верхнему углу в боксе.
 *  textBaseline должен быть установлен вызывающим (мы используем "top"). */
function drawWrappedTopLeft(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  lineH: number,
): void {
  const lines = wrapLines(ctx, text, maxW, lineH, maxH);
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * lineH);
  }
}

/** Рисует текст с переносом, отцентрированный по горизонтали и вертикали
 *  в боксе. Внутри ставит textAlign/textBaseline на center. */
function drawWrappedCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  lineH: number,
): void {
  const lines = wrapLines(ctx, text, maxW, lineH, maxH);
  if (!lines.length) return;
  const prevAlign = ctx.textAlign;
  const prevBaseline = ctx.textBaseline;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = x + maxW / 2;
  const blockH = lines.length * lineH;
  let cy = y + maxH / 2 - blockH / 2 + lineH / 2;
  for (const line of lines) {
    ctx.fillText(line, cx, cy);
    cy += lineH;
  }
  ctx.textAlign = prevAlign;
  ctx.textBaseline = prevBaseline;
}

/**
 * Рукописная иконка шестерёнки, отцентрированная на (cx, cy) с радиусом тела
 * `r`. Зубчатое кольцо (8 трапециевидных зубьев) + втулка. Обводится в `color`;
 * толщина обводки , чернильная обводка узла `sw`, чтобы глиф совпадал по весу
 * с узлом.
 */
function drawGear(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  sw: number,
): void {
  if (r <= 0) return;
  const teeth = 8;
  const rOuter = r;
  const rInner = r * 0.74;
  const rHub = r * 0.34;
  const half = (Math.PI / teeth) * 0.5; // полуширина зуба в радианах

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(sw * 0.8, 0.5);
  ctx.lineJoin = "round";

  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    // Каждый зуб: подъём до внешнего на центре зуба, затем на внутреннем
    // радиусе между зубьями.
    const aTipL = a - half;
    const aTipR = a + half;
    const aValleyR = a + half + (Math.PI / teeth - half); // начало следующей впадины
    if (i === 0) ctx.moveTo(cx + Math.cos(aTipL) * rOuter, cy + Math.sin(aTipL) * rOuter);
    else ctx.lineTo(cx + Math.cos(aTipL) * rOuter, cy + Math.sin(aTipL) * rOuter);
    ctx.lineTo(cx + Math.cos(aTipR) * rOuter, cy + Math.sin(aTipR) * rOuter);
    ctx.lineTo(cx + Math.cos(aValleyR) * rInner, cy + Math.sin(aValleyR) * rInner);
    ctx.lineTo(
      cx + Math.cos(aValleyR + (2 * half)) * rInner,
      cy + Math.sin(aValleyR + (2 * half)) * rInner,
    );
  }
  ctx.closePath();
  ctx.stroke();

  // Втулка.
  ctx.beginPath();
  ctx.arc(cx, cy, rHub, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ── крошечные утилиты геометрии (направление пути / середина) ──────────

/** true, если две точки (числовое совпадение) , одна и та же позиция. */
function samePt(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

/** Последняя точка полилинии, отличная от конечной, для определения направления. */
function lastDistinct(pts: Pt[]): Pt | null {
  const end = pts[pts.length - 1];
  for (let i = pts.length - 2; i >= 0; i--) {
    if (!samePt(pts[i], end)) return pts[i];
  }
  return null;
}
