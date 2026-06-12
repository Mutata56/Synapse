// src/editor2026/blocks/whiteboard/BoardContextMenu.tsx
//
// Правый клик STYLE PANEL для доски. Движок выделяет то, на что кликнули,
// и шлёт запрос (с текущим стилем основного элемента); тут рисуем панель:
// заливка / обводка / цвет текста (через OKLCH-пикер), толщина обводки,
// прозрачность, z-порядок, лок, дублирование, удаление -- и дёргаем
// обратно в движок. position:fixed на курсоре.

import { useEffect, useRef, useState } from "react";
import {
  BringToFront,
  Copy,
  Lock,
  SendToBack,
  Trash2,
  Unlock,
} from "lucide-react";
import ColorPicker from "./ColorPicker";
import { t } from "../../../lib/i18n";

export type PanelStyle = {
  fill: string | null;
  stroke: string | null;
  textColor: string | null;
  strokeWidth: number | null;
  opacity: number;
};

export type ContextMenuState = {
  screenX: number;
  screenY: number;
  hasShapes: boolean;
  hasEdge: boolean;
  locked: boolean;
  style: PanelStyle;
};

export type StylePatch = {
  fill?: string;
  stroke?: string;
  textColor?: string;
  strokeWidth?: number;
  opacity?: number;
};

export type BoardContextMenuProps = {
  state: ContextMenuState | null;
  onStyle: (patch: StylePatch) => void;
  onZFront: () => void;
  onZBack: () => void;
  onDuplicate: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
  onClose: () => void;
};

const PANEL_W = 232;
const PANEL_H_EST = 360;
const WIDTHS = [1, 2, 4, 8];

type PickTarget = "fill" | "stroke" | "text";

export default function BoardContextMenu(
  props: BoardContextMenuProps,
): JSX.Element | null {
  const { state, onStyle, onZFront, onZBack, onDuplicate, onToggleLock, onDelete, onClose } =
    props;

  // Локальная зеркальная копия стиля, чтобы панель показывала правки в
  // реальном времени (движок перевыпускает запрос только на новый правый
  // клик, а не при каждом изменении стиля).
  const [local, setLocal] = useState<PanelStyle | null>(state?.style ?? null);
  const [picker, setPicker] = useState<{ target: PickTarget; x: number; y: number } | null>(
    null,
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocal(state?.style ?? null);
    setPicker(null);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onDown = (e: PointerEvent) => {
      // Пока пикер открыт, он владеет кликами снаружи (он portaled в
      // <body>, поэтому "содержит" нас): дадим ему закрыться первым и
      // оставим панель на месте. Следующий клик без открытого пикера
      // закроет панель.
      if (picker) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // Пикер открыт -> его хэндлер закроет его. Иначе Escape закрывает панель
      // и перехватывается, чтобы хэндлер закрытия модалки доски тоже не сработал.
      if (e.key === "Escape" && !picker) {
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
  }, [state, picker, onClose]);

  if (!state || !local) return null;

  const apply = (patch: StylePatch) => {
    setLocal((l) => (l ? { ...l, ...patch } : l));
    onStyle(patch);
  };

  const openPicker = (target: PickTarget, e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Открываем СЛЕВА от панели (к центру canvas) если есть место.
    // Панель обычно прижата к правому краю экрана, где right-якорный пикер
    // был бы зажат СВЕРХУ панели; открытие влево это решает.
    const PICK_W = 244; // ширина ColorPicker (236) + 8px зазор
    const x = r.left - PICK_W >= 8 ? r.left - PICK_W : r.right + 8;
    setPicker({ target, x, y: r.top - 4 });
  };
  const pickValue =
    picker?.target === "fill"
      ? local.fill
      : picker?.target === "stroke"
        ? local.stroke
        : local.textColor;
  const onPick = (hex: string) => {
    if (!picker) return;
    if (picker.target === "fill") apply({ fill: hex });
    else if (picker.target === "stroke") apply({ stroke: hex });
    else apply({ textColor: hex });
  };

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let left = state.screenX;
  let top = state.screenY;
  if (left + PANEL_W + 8 > vw) left = vw - PANEL_W - 8;
  if (left < 8) left = 8;
  if (top + PANEL_H_EST + 8 > vh) top = Math.max(8, vh - PANEL_H_EST - 8);

  const swatch = (c: string | null) => (
    <span
      className="e26-wb-sp__swatch"
      style={c ? { background: c } : undefined}
      data-empty={c ? undefined : "1"}
    />
  );

  return (
    <div
      ref={ref}
      className="e26-wb-sp"
      role="dialog"
      style={{ left: `${left}px`, top: `${top}px` }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
        {(state.hasShapes || state.hasEdge) && (
          <>
            {local.fill !== null && (
              <button type="button" className="e26-wb-sp__row" onClick={(e) => openPicker("fill", e)}>
                <span className="e26-wb-sp__label">{t("Заливка")}</span>
                {swatch(local.fill)}
              </button>
            )}
            {local.stroke !== null && (
              <button type="button" className="e26-wb-sp__row" onClick={(e) => openPicker("stroke", e)}>
                <span className="e26-wb-sp__label">{t("Обводка")}</span>
                {swatch(local.stroke)}
              </button>
            )}
            {local.textColor !== null && (
              <button type="button" className="e26-wb-sp__row" onClick={(e) => openPicker("text", e)}>
                <span className="e26-wb-sp__label">{t("Текст")}</span>
                {swatch(local.textColor)}
              </button>
            )}

            {local.strokeWidth !== null && (
              <div className="e26-wb-sp__row e26-wb-sp__row--static">
                <span className="e26-wb-sp__label">{t("Толщина")}</span>
                <div className="e26-wb-sp__widths">
                  {WIDTHS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      className={
                        "e26-wb-sp__wbtn" +
                        (Math.round(local.strokeWidth ?? 0) === w ? " e26-wb-sp__wbtn--on" : "")
                      }
                      title={`${w}px`}
                      onClick={() => apply({ strokeWidth: w })}
                    >
                      <span style={{ width: w + 2, height: w + 2 }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {state.hasShapes && (
              <div className="e26-wb-sp__row e26-wb-sp__row--static">
                <span className="e26-wb-sp__label">{t("Прозрачн.")}</span>
                <input
                  className="e26-wb-sp__range"
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round(local.opacity * 100)}
                  onChange={(e) => apply({ opacity: Number(e.target.value) / 100 })}
                />
                <span className="e26-wb-sp__pct">{Math.round(local.opacity * 100)}%</span>
              </div>
            )}

            <div className="e26-wb-sp__sep" />
          </>
        )}

        {state.hasShapes && (
          <div className="e26-wb-sp__zrow">
            <button type="button" className="e26-wb-sp__item e26-wb-sp__item--half" onClick={() => { onZFront(); onClose(); }}>
              <BringToFront size={15} aria-hidden /> Вперёд
            </button>
            <button type="button" className="e26-wb-sp__item e26-wb-sp__item--half" onClick={() => { onZBack(); onClose(); }}>
              <SendToBack size={15} aria-hidden /> Назад
            </button>
          </div>
        )}

        {state.hasShapes && (
          <button type="button" className="e26-wb-sp__item" onClick={() => { onDuplicate(); onClose(); }}>
            <Copy size={15} aria-hidden /> Дублировать
          </button>
        )}
        {state.hasShapes && (
          <button type="button" className="e26-wb-sp__item" onClick={() => { onToggleLock(); onClose(); }}>
            {state.locked ? <Unlock size={15} aria-hidden /> : <Lock size={15} aria-hidden />}
            {state.locked ? "Разблокировать" : "Заблокировать"}
          </button>
        )}
        <button type="button" className="e26-wb-sp__item e26-wb-sp__item--danger" onClick={() => { onDelete(); onClose(); }}>
          <Trash2 size={15} aria-hidden /> Удалить
        </button>

        {/* ColorPicker портится в <body> и сам управляет outside-click /
            Escape; панель уступает пока он открыта. */}
        {picker && (
          <ColorPicker
            x={picker.x}
            y={picker.y}
            value={pickValue}
            onPick={onPick}
            onClose={() => setPicker(null)}
          />
        )}
    </div>
  );
}
