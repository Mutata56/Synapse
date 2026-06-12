// src/editor2026/blocks/whiteboard/whiteboardBlock.tsx
//
// Бесконечный canvas whiteboard-блок (фаза 6). content:"non原子", non-atom.
// Документ живёт как JSON-снапшот строкой в пропе `snapshot`, поэтому едет
// внутри lossless BlockNote JSON заметки без изменений в хранилище.
// Markdown-экспорт деградирует до плейсхолдера "[Доска]".
//
// В заметке блок это КОМПАКТНАЯ КАРТОЧКА: иконка, "Доска", количество шейпов
// и маленький СТАТИЧЕСКИЙ превью доски (рендерится на offscreen canvas, без
// движка, без rAF, дёшево). "Открыть доску" открывает FULLSCREEN модалку
// через portal в document.body с live <WhiteboardCanvas/>. Canvas это source
// of truth пока открыт; правки дебаунсятся обратно в проп `snapshot`.

import { createReactBlockSpec } from "@blocknote/react";
import { PenLine, X } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { boardBounds, parseBoard, serializeBoard } from "./model";
import { t } from "../../../lib/i18n";
import type { Board, Shape } from "./model";

const WhiteboardCanvas = lazy(() => import("./WhiteboardCanvas"));

const PERSIST_DEBOUNCE_MS = 600;
const THUMB_W = 320;
const THUMB_H = 140;

// ── Граница BlockNote (явный `any` допускается только тут) ───────────────────
function WhiteboardView({ block, editor }: { block: any; editor: any }) {
  const snapshot: string = block.props.snapshot ?? "";
  const [open, setOpen] = useState(false);

  // Доска парсится лениво из снапшота для превью карточки. Мемоизируем
  // по сырой строке, чтобы правка снапшота пересчитывалась.
  const board = useMemo<Board>(() => parseBoard(snapshot), [snapshot]);

  // Имя доски живёт в СВОЁМ пропе блока (не в canvas-снапшоте), поэтому
  // переименование не перезаписывает документ. Локальный state для быстрого
  // ввода; коммитим в блон blur / Enter. BlockNote мержит частичные пропы,
  // поэтому запись { name } не трогает `snapshot` (и запись snapshot не
  // трогает name). Эффект пересинкается если проп поменялся извне.
  const [name, setName] = useState<string>(block.props.name ?? "");
  useEffect(() => {
    setName(block.props.name ?? "");
  }, [block.props.name]);

  // Дебаунс-персистентность: live canvas вызывает onChange часто;
  // консолидируем записи в editor.updateBlock чтобы не громить ProseMirror
  // историю.
  const timerRef = useRef<number | null>(null);
  const persist = useCallback(
    (b: Board) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        editor.updateBlock(block, {
          type: "whiteboard",
          props: { snapshot: serializeBoard(b) },
        });
      }, PERSIST_DEBOUNCE_MS);
    },
    [editor, block],
  );

  // Флешим все незакоммиченные записи при закрытии модалки или анмаунте
  // блока, чтобы быстрая правка с немедленным закрытием не теряла финальное
  // состояние.
  const flush = useCallback(
    (b?: Board) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (b) {
        editor.updateBlock(block, {
          type: "whiteboard",
          props: { snapshot: serializeBoard(b) },
        });
      }
    },
    [editor, block],
  );

  const latestRef = useRef<Board>(board);
  const handleChange = useCallback(
    (b: Board) => {
      latestRef.current = b;
      persist(b);
    },
    [persist],
  );

  const closeModal = useCallback(() => {
    setOpen(false);
    flush(latestRef.current);
  }, [flush]);

  const commitName = useCallback(() => {
    const next = name.trim();
    if (next === (block.props.name ?? "")) return;
    editor.updateBlock(block, { type: "whiteboard", props: { name: next } });
  }, [name, editor, block]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    // contentEditable=false + bubble stopPropagation: карточка и модалка
    // владеют своим pointer/keyboard вводом; останавливаем события до
    // ProseMirror, чтобы canvas и текстовый редактор не конфликтовали.
    <div
      className="e26-wb"
      contentEditable={false}
      // Останавливаем клавиши от ProseMirror ТОЛЬКО когда модалка закрыта
      // (чтобы кнопка блока в заметке не триггерила шорткаты редактора).
      // Когда модалка открыта, portal доски это React-tree ребёнок этой
      // карточки, поэтому события всплывают сюда -- мы НЕ должны их
      // останавливать, иначе глобальные шорткаты (Ctrl+K/F) не дойдут до
      // command palette. Движок хватает свои hotkeys доски на capture-phase
      // и останавливает только их.
      onKeyDown={(e) => {
        if (!open) e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="e26-wb__card">
        <div className="e26-wb__namerow">
          <PenLine size={15} className="e26-wb__nameicon" aria-hidden />
          <input
            className="e26-wb__name"
            value={name}
            placeholder="Без названия"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              // Enter коммитит (blur); Escape откатывает к сохранённому имени
              // и снимает фокус, чтобы юзер мог быстро выйти из правки без
              // Ctrl+Z. Остальное перехватывается wrapper'ом и не доходит
              // до ProseMirror пока доска закрыта.
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setName(block.props.name ?? "");
                e.currentTarget.blur();
              }
            }}
          />
        </div>

        <BoardThumb board={board} />

        <button
          type="button"
          className="e26-wb__open"
          onClick={() => setOpen(true)}
        >
          Открыть доску
        </button>
      </div>

      {open && (
        <WhiteboardModal
          board={board}
          name={name}
          onChange={handleChange}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

function WhiteboardModal({
  board,
  name,
  onChange,
  onClose,
}: {
  board: Board;
  name: string;
  onChange: (b: Board) => void;
  onClose: () => void;
}) {
  // Esc закрывает; блокируем скролл body пока открыта.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Защита в глубину: если фокусированный редактируемый элемент
      // (textarea / input / contenteditable) не (или забыл) остановить
      // всплытие своего Escape, НЕ закрываем всю доску -- юзер почти
      // наверняка хотел закрыть поле, а не весь canvas. Движок и
      // оверлейные Escape-хэндлеры останавливают всплытие когда обрабатывают
      // Escape, поэтому тут ловится только "stray Escape над canvas",
      // который должен закрыть доску.
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          t.isContentEditable
        ) {
          return;
        }
      }
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    // BUBBLE-фаза (не capture): движок, style panel, color picker и
    // текстовый/SQL оверлеи обрабатывают Escape первыми и останавливают
    // всплытие когда обработали (закрыли себя / сняли выделение).
    // Сюда доходит только необработанный Escape и закрывает всю доску.
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    // NB: мы намеренно НЕ останавливаем всплытие keydown тут. Движок
    // хватает hotkeys доски на capture-phase и останавливает только свои
    // (undo/clipboard/delete), поэтому глобальные шорткаты приложения
    // типа Ctrl+K / Ctrl+F по-прежнему доходят до своих window-листенеров
    // пока доска открыта.
    <div className="e26-wb__overlay" onPointerDown={(e) => e.stopPropagation()}>
      <div className="e26-wb__modal">
        <div className="e26-wb__modaltitle">{name.trim() || "Без названия"}</div>
        <button
          type="button"
          className="e26-wb__close"
          title="Закрыть (Esc)"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <Suspense
          fallback={<div className="e26-wb__loading">{t("Загрузка холста…")}</div>}
        >
          <WhiteboardCanvas board={board} onChange={onChange} />
        </Suspense>
      </div>
    </div>,
    document.body,
  );
}

function BoardThumb({ board }: { board: Board }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(THUMB_W * dpr);
    canvas.height = Math.round(THUMB_H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawThumb(ctx, board.shapes, THUMB_W, THUMB_H, dpr);
  }, [board]);

  // Backing store размер THUMB_W x THUMB_H x dpr (задаётся в эффекте);
  // ОТОБРАЖАЕМЫЙ размер задаётся CSS (width:100% + aspect-ratio), поэтому
  // превью заполняет карточку.
  return <canvas ref={ref} className="e26-wb__thumb" />;
}

/**
 * Рисует превью доски, вписанное в bounds. Самостоятельный (без camera
 * класса) -- считает один uniform scale + offset чтобы вписать bounds доски
 * в thumbnail с паддингом, потом рисует упрощённые шейпы.
 */
function drawThumb(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  cssW: number,
  cssH: number,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const b = boardBounds(shapes);
  if (!b) return;

  const pad = 8;
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const scale = Math.min((cssW - pad * 2) / bw, (cssH - pad * 2) / bh, 4);
  // Центрируем замасштабированную доску в thumbnail.
  const offX = (cssW - bw * scale) / 2 - b.minX * scale;
  const offY = (cssH - bh * scale) / 2 - b.minY * scale;

  const X = (wx: number) => wx * scale + offX;
  const Y = (wy: number) => wy * scale + offY;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const s of shapes) {
    ctx.lineWidth = Math.max(0.5, s.sw * scale);
    ctx.strokeStyle = s.color;
    switch (s.type) {
      case "pen": {
        if (!s.points.length) break;
        ctx.beginPath();
        ctx.moveTo(X(s.points[0].x), Y(s.points[0].y));
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(X(s.points[i].x), Y(s.points[i].y));
        }
        ctx.stroke();
        break;
      }
      case "rect": {
        if (s.fill && s.fill !== "transparent") {
          ctx.fillStyle = s.fill;
          ctx.fillRect(X(s.x), Y(s.y), s.w * scale, s.h * scale);
        }
        ctx.strokeRect(X(s.x), Y(s.y), s.w * scale, s.h * scale);
        break;
      }
      case "ellipse": {
        ctx.beginPath();
        ctx.ellipse(
          X(s.x + s.w / 2),
          Y(s.y + s.h / 2),
          Math.abs(s.w * scale) / 2,
          Math.abs(s.h * scale) / 2,
          0,
          0,
          Math.PI * 2,
        );
        if (s.fill && s.fill !== "transparent") {
          ctx.fillStyle = s.fill;
          ctx.fill();
        }
        ctx.stroke();
        break;
      }
      case "arrow": {
        ctx.beginPath();
        ctx.moveTo(X(s.x1), Y(s.y1));
        ctx.lineTo(X(s.x2), Y(s.y2));
        ctx.stroke();
        break;
      }
      case "text": {
        ctx.fillStyle = s.color;
        const fs = Math.max(2, s.size * scale * 0.7);
        ctx.font = `${fs}px sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(s.text.slice(0, 24) || " ", X(s.x), Y(s.y));
        break;
      }
      // Упрощённые силуэты нод flowchart, чтобы превью не было пустым
      // для досок целиком из db/action/note нод.
      case "db": {
        const x = X(s.x);
        const y = Y(s.y);
        const w = s.w * scale;
        const h = s.h * scale;
        const ry = Math.min(h * 0.16, 5);
        ctx.fillStyle = s.fill;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + ry, w / 2, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x, y + ry, w, Math.max(0, h - ry * 2));
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h - ry, w / 2, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case "action": {
        const x = X(s.x);
        const y = Y(s.y);
        const w = s.w * scale;
        const h = s.h * scale;
        ctx.fillStyle = s.fill;
        if (s.variant === "decision") {
          ctx.beginPath();
          ctx.moveTo(x + w / 2, y);
          ctx.lineTo(x + w, y + h / 2);
          ctx.lineTo(x + w / 2, y + h);
          ctx.lineTo(x, y + h / 2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(x, y, w, h);
          ctx.strokeRect(x, y, w, h);
        }
        break;
      }
      case "note": {
        const x = X(s.x);
        const y = Y(s.y);
        const w = s.w * scale;
        const h = s.h * scale;
        ctx.fillStyle = s.fill;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        break;
      }
    }
  }
}

export const whiteboardBlock = createReactBlockSpec(
  {
    type: "whiteboard",
    content: "none",
    propSchema: { snapshot: { default: "" }, name: { default: "" } },
  },
  {
    // Non-atom чтобы клик ставил TEXT-caret в следующую строку, а не
    // NodeSelection на карточку (фикс бага caret-after-block).
    meta: { isolating: false, selectable: false },
    render: (props) => (
      <WhiteboardView block={props.block} editor={props.editor} />
    ),
    toExternalHTML: () => <p data-whiteboard="1">[Доска]</p>,
    parse: (el) =>
      el.getAttribute("data-whiteboard") === "1" ? { snapshot: "" } : undefined,
  },
);
