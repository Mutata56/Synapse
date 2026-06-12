// src/editor2026/blocks/whiteboard/camera.ts
//
// Рантайм-камера бесконечной доски. Мутируемая, движковая сторона
// простого типа данных Camera из модели. Хранит аффинное преобразование
// (однородное масштабирование zoom + трансляция x,y в экранных координатах)
// и предоставляет точные конверсии экран/мир, панорамирование, зум к курсору,
// хелпер setTransform с учётом devicePixelRatio и фрустум-каттинг.

// СОГЛАШЕНИЕ (должно точно совпадать с model.ts):
//     screen = world * zoom + (x, y)
//     world  = (screen - (x, y)) / zoom
// x,y хранятся в CSS-пикселях (НЕ в device-пикселях). DPR подмешивается
// только в applyToCtx, поэтому вся геометрия/hit-testing в CSS-пространстве.

import type { Bounds, Camera, Pt } from "./model";
import { clampZoom } from "./model";

export class WhiteboardCamera {
  x: number;
  y: number;
  zoom: number;

  constructor(x = 0, y = 0, zoom = 1) {
    this.x = x;
    this.y = y;
    this.zoom = clampZoom(zoom);
  }

  // ── конверсии (точные обратные) ────────────────────────────────────────

  /** Экран (CSS px) в мир. Обратная к worldToScreen. */
  screenToWorld(sx: number, sy: number): Pt {
    return {
      x: (sx - this.x) / this.zoom,
      y: (sy - this.y) / this.zoom,
    };
  }

  /** Мир в экран (CSS px). Обратная к screenToWorld. */
  worldToScreen(wx: number, wy: number): Pt {
    return {
      x: wx * this.zoom + this.x,
      y: wy * this.zoom + this.y,
    };
  }

  /**
   * Панорамирование по дельте в ЭКРАННЫХ (CSS) пикселях. Поскольку
   * трансляция хранится в экранных координатах, это простое сложение.
   */
  panByScreen(dxScreen: number, dyScreen: number): void {
    this.x += dxScreen;
    this.y += dyScreen;
  }

  /**
   * Зум с центром в экранных координатах (курсор). Точка мира под
   * (screenX, screenY) остаётся под тем же пикселем после зума.
   *
   * Вывод: w = screenToWorld(anchor) до обновления. После обновления
   * zoom нужно, чтобы worldToScreen(w) == anchor:
   *     anchor = w * zoom' + (x', y')   =>   x' = anchor - w * zoom'
   * Клип zoom применяем первым, чтобы anchor оставался точным даже
   * на границах MIN/MAX_ZOOM.
   */
  zoomToPoint(factor: number, screenX: number, screenY: number): void {
    const next = clampZoom(this.zoom * factor);
    if (next === this.zoom) return;
    const wx = (screenX - this.x) / this.zoom;
    const wy = (screenY - this.y) / this.zoom;
    this.zoom = next;
    this.x = screenX - wx * next;
    this.y = screenY - wy * next;
  }

  /**
   * Настраивает ctx так, чтобы рисовать в МИРОВЫХ координатах. Подмешивает
   * devicePixelRatio в матрицу, так что буфер канваса = cssSize * dpr, а мы
   * работаем в мировых единицах.
   *
   * Итоговое преобразование (столбцовый вектор):
   *     device = dpr * (world * zoom + (x, y))
   * setTransform(a,b,c,d,e,f) кодирует как:
   *     a = dpr*zoom, d = dpr*zoom, e = dpr*x, f = dpr*y, b = c = 0.
   */
  applyToCtx(ctx: CanvasRenderingContext2D, dpr: number): void {
    const s = this.zoom * dpr;
    ctx.setTransform(s, 0, 0, s, this.x * dpr, this.y * dpr);
  }

  // ── каттинг ───────────────────────────────────────────────────────────

  /**
   * Мировой прямоугольник видимой области viewport'а cssW × cssH.
   * Для фрустум-каттинга: шейпы, чьи bounds не пересекают эту область,
   * можно пропускать. Углы , просто экранные углы, переведённые в мир.
   */
  viewportWorldBounds(cssW: number, cssH: number): Bounds {
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(cssW, cssH);
    return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
  }

  /** Снимок в простой тип Camera, хранимый в доске. */
  toData(): Camera {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  /** Восстановление из простого Camera (zoom повторно клипается). */
  static fromData(c: Camera): WhiteboardCamera {
    return new WhiteboardCamera(c.x, c.y, c.zoom);
  }
}
