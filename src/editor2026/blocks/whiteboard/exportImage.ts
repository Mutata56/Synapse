// src/editor2026/blocks/whiteboard/exportImage.ts
//
// Экспорт доски в PNG-картинку. Рендерит всю доску (грани + шейпы)
// по содержимому в offscreen-канвасе с нужным масштабом, используя те же
// мировые.painter'ы, что и живой движок (WYSIWYG), потом сохраняет
// через Tauri dialog + fs плагины (тот же путь записи, что lib/backup.ts).

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { WhiteboardCamera } from "./camera";
import { drawShape } from "./render";
import {
  drawActionNode,
  drawDbNode,
  drawEdge,
  drawNoteNode,
} from "./renderNodes";
import { boardBounds, nodeRect, type Board, type Shape } from "./model";

const BG = "#0a0a0b"; // фон экспорта (совпадает с поверхностью доски)
const PADDING = 48; // отступ в device-пикселях вокруг контента
const MAX_DIM = 4096; // макс. размер большей стороны экспорта

/** Диспатчит шейп на нужный.painter (зеркалит drawShapeFast движка). */
function paint(
  ctx: CanvasRenderingContext2D,
  s: Shape,
  cam: WhiteboardCamera,
): void {
  switch (s.type) {
    case "db":
      drawDbNode(ctx, s, cam);
      return;
    case "action":
      drawActionNode(ctx, s, cam);
      return;
    case "note":
      drawNoteNode(ctx, s, cam);
      return;
    default:
      drawShape(ctx, s, cam);
  }
}

/**
 * Рендерит содержимое доски (без сетки) в новый канвас, вписанный в bounds
 * с масштабом scale device-пикселей на мировую единицу (клипается, чтобы
 * ни одна сторона не превышала MAX_DIM). Пустая доска = null.
 */
export function renderBoardToCanvas(
  board: Board,
  scale = 2,
): HTMLCanvasElement | null {
  const b = boardBounds(board.shapes);
  if (!b) return null;

  const cw = Math.max(1, b.maxX - b.minX);
  const ch = Math.max(1, b.maxY - b.minY);
  // Клипаем масштаб, чтобы битмап влез в MAX_DIM по обеим осям.
  const cap = Math.min(MAX_DIM / cw, MAX_DIM / ch);
  const s = Math.max(0.1, Math.min(scale, cap));

  const W = Math.max(1, Math.ceil(cw * s + PADDING * 2));
  const H = Math.max(1, Math.ceil(ch * s + PADDING * 2));

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Непрозрачный фон.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Камера: мир в пиксели канваса при масштабе s, левый верхний угол контента
  // в PADDING. dpr = 1, т.к. канвас уже нужного размера.
  const cam = new WhiteboardCamera(PADDING - b.minX * s, PADDING - b.minY * s, s);
  cam.applyToCtx(ctx, 1);

  // Грани ПОД шейпами (одноразовый O(E·N) поиска для экспорта норм).
  for (const e of board.edges) {
    const from = board.shapes.find((x) => x.id === e.from);
    const to = board.shapes.find((x) => x.id === e.to);
    const ra = from ? nodeRect(from) : null;
    const rb = to ? nodeRect(to) : null;
    if (ra && rb) drawEdge(ctx, e, ra, rb, cam);
  }
  for (const sh of board.shapes) paint(ctx, sh, cam);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

/**
 * Рендерит доску в PNG и сохраняет по пути, выбранному пользователем.
 * Возвращает путь или null если диалог отменён. Бросает при пустой доске
 * или ошибке PNG-кода.
 */
export async function exportBoardPng(board: Board): Promise<string | null> {
  const canvas = renderBoardToCanvas(board, 2);
  // Пустая доска = null вместо ошибки, чтобы UI мог обработать
  // (disabled-кнопка + тултип), в нормальном использовании сюда не попадём.
  // Ошибка PNG-кода ниже , это исключение, которое стоит показать.
  if (!canvas) return null;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Не удалось создать PNG");

  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, "-")
    .replace("T", "_");
  const path = await save({
    defaultPath: `board-${stamp}.png`,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!path) return null; // отмена

  const buf = new Uint8Array(await blob.arrayBuffer());
  await writeFile(path, buf);
  return path;
}
