// src/editor2026/blocks/whiteboard/ColorPicker.tsx
//
// Маленький плавающий пикер цвета: палитра на OKLCH (строки читаются как
// одна семья) + нативный color input для кастомных цветов. Применяет LIVE
// через onPick (style panel коммитит в движок). position:fixed на (x,y),
// clamped в viewport; закрывается по клику снаружи / Escape.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { PALETTE_ROWS } from "./color";
import { t } from "../../../lib/i18n";

export type ColorPickerProps = {
  x: number;
  y: number;
  value: string | null;
  onPick: (hex: string) => void;
  onClose: () => void;
};

const PW = 236;
const PH = 226;

/** Нормализует произвольный цвет к 7-символьному hex для нативного <input>. */
function toInputHex(v: string | null): string {
  if (!v) return "#888888";
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v.trim());
  if (!m) return "#888888"; // rgba()/именованные: нативному input нужен #rrggbb
  const h = m[1];
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
}

function sameColor(a: string, b: string | null): boolean {
  return b != null && a.toLowerCase() === b.toLowerCase();
}

export default function ColorPicker(props: ColorPickerProps): JSX.Element {
  const { x, y, value, onPick, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let left = x;
  let top = y;
  if (left + PW + 8 > vw) left = vw - PW - 8;
  if (left < 8) left = 8;
  if (top + PH + 8 > vh) top = Math.max(8, vh - PH - 8);

  // Portal в <body>: пикер НЕ должен жить внутри stacking context style-panel
  // (панель это position:fixed z-index:10002, а модал доски ставит
  // backdrop-filter, что создаёт containing block). Там popover мог бы
  // отрисоваться в неверном слое / обрезаться, и клик по свотчу выглядел бы
  // как "ничего не происходит". Как child body это обычный верхнеуровневый
  // оверлей.
  return createPortal(
    <div
      ref={ref}
      className="e26-wb-cpick"
      style={{ left: `${left}px`, top: `${top}px` }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {PALETTE_ROWS.map((row, i) => (
        <div className="e26-wb-cpick__row" key={i}>
          {row.map((c) => (
            <button
              key={c}
              type="button"
              className={
                "e26-wb-cpick__sw" +
                (sameColor(c, value) ? " e26-wb-cpick__sw--on" : "")
              }
              style={{ background: c }}
              title={c}
              aria-label={c}
              onClick={() => onPick(c)}
            />
          ))}
        </div>
      ))}
      <label className="e26-wb-cpick__custom">
        <input
          type="color"
          value={toInputHex(value)}
          onChange={(e) => onPick(e.target.value)}
        />
        <span>{t("Свой цвет")}</span>
      </label>
    </div>,
    document.body,
  );
}
