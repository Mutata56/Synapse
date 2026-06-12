import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";

/**
 * Полноэкранный просмотр картинки. Открывается по клику на изображение в
 * редакторе (или в отрендеренном markdown / превью галереи), потому что в
 * заметке картинки часто мелкие и нечитаемые. Колесо = зум, тянуть = двигать,
 * Esc / клик по бэкдропу = закрыть.
 *
 * Монтируется в App один раз. Вешает один click-листенер на document и в
 * остальном инертен (ничего не рендерит), пока картинку не откроют, так что DOM
 * BlockNote и его модель блоков не трогает.
 */

// [data-lightbox-target] это явный opt-in атрибут: его ставят поверхности вне
// редактора (превью галереи, обложки и т.п.), когда их вложенный <img> должен
// открывать лайтбокс по клику. Чище, чем тащить для этого .md-content, и нет
// протечки CSS от правил рендера markdown.
const CONTENT_SELECTOR = ".bn-editor, .md-content, [data-lightbox-target]";
const MIN_SCALE = 0.5;
const MAX_SCALE = 8;

export function ImageLightbox() {
  const [src, setSrc] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Открываем по одиночному клику на картинку внутри opt-in поверхности. НЕ
  // зовём preventDefault: за BlockNote остаётся своё меню блока-картинки, ручки
  // ресайза, постановка каретки, всё это срабатывает на pointerdown/mousedown
  // ДО этого click-хендлера. Открыть лайтбокс параллельно норм: он рендерится в
  // portal поверх редактора и забирает фокус только пока открыт. Клик всплывает
  // от <img>, так что побеждает любой opt-in предок (обёртка
  // data-lightbox-target, .bn-editor, .md-content).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return; // средний/правый клик игнорим
      const target = e.target as HTMLElement | null;
      if (!target || target.tagName !== "IMG") return;
      if (!target.closest(CONTENT_SELECTOR)) return;
      const img = target as HTMLImageElement;
      setSrc(img.currentSrc || img.src);
      setScale(1);
      setOffset({ x: 0, y: 0 });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Закрытие по Esc на совести общей оболочки Modal.

  const close = () => setSrc(null);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) =>
      Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)),
      ),
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: offset.x,
      oy: offset.y,
    };
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* игнорим */
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <Modal
      open={!!src}
      onClose={close}
      variant="lightbox"
      ariaLabel="Просмотр изображения"
      onBackdropWheel={onWheel}
      // Панель = сама картинка. Абсолютные дети (кнопка закрытия, плашка-подсказка)
      // позиционируются относительно бэкдропа, а не панели, поэтому держим
      // содержимое панели через contents() инлайном.
      panelClassName="contents"
    >
      <button
        type="button"
        onClick={close}
        title="Закрыть (Esc)"
        aria-label="Закрыть"
        className="absolute top-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
      >
        <X size={18} strokeWidth={2} />
      </button>

      {/* w/h по вьюпорту плюс object-contain: мелкая картинка растягивается
          до читаемого размера, большая вписывается. scale/offset зумят и
          двигают поверх. */}
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            cursor: dragging ? "grabbing" : "grab",
          }}
          className="max-h-[92vh] max-w-[92vw] select-none object-contain"
        />
      )}

      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[11px] text-zinc-300">
        Колесо , масштаб · тянуть , двигать · Esc , закрыть
      </div>
    </Modal>
  );
}
