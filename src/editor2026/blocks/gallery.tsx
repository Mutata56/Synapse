// src/editor2026/blocks/gallery.tsx
//
// Блок gallery (фаза 2): изображения как отзывчивая сетка или бесконечная
// карусель (один слайд, prev/next, точки, счетчик, плавный скролл с
// зацикливанием последний->первый как будто это следующий слайд -- через
// клонированные краевые слайды). Элементы хранятся как JSON-строка в пропе
// `items`; при экспорте деградируют до последовательности <img>.

import { createReactBlockSpec } from "@blocknote/react";
import {
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { importFile, resolveAssetUrl, toPortableAssetRef } from "../lib/assets";
import { t } from "../../lib/i18n";

type GalleryItem = { url: string; name: string; caption?: string };
type GalleryMode = "grid" | "carousel";

function parseItems(raw: string): GalleryItem[] {
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? (a as GalleryItem[]) : [];
  } catch {
    return [];
  }
}

// ── Бесконечная карусель ─────────────────────────────────────────────────────
// Клонирует первый слайд после последнего (и последний перед первым), чтобы
// next-from-last анимировался на один шаг вперед в клон, а потом молча
// перескакивал на настоящий первый слайд после завершения перехода.
// Аналогично для prev-from-first.
function Carousel({
  items,
  onRemove,
}: {
  items: GalleryItem[];
  onRemove: (realIndex: number) => void;
}) {
  const n = items.length;
  const [pos, setPos] = useState(1); // 1..n = настоящие; 0 = клон(последний); n+1 = клон(первый)
  const [anim, setAnim] = useState(true);

  // Держим pos валидным и отключаем анимацию при смене количества элементов.
  useEffect(() => {
    setAnim(false);
    setPos((p) => Math.min(Math.max(1, p), Math.max(1, n)));
  }, [n]);

  if (n === 0) return null;

  const single = n === 1;
  // Для одной картинки клонов/навигации нет.
  const slides = single ? items : [items[n - 1], ...items, items[0]];
  const realIndex = single ? 0 : ((pos - 1) % n + n) % n;

  const go = (delta: -1 | 1) => {
    if (single) return;
    if (pos === 0 || pos === n + 1) return; // игнорируем клики во время перескока
    setAnim(true);
    setPos((p) => p + delta);
  };
  const goReal = (i: number) => {
    setAnim(true);
    setPos(i + 1);
  };
  const onTransitionEnd = () => {
    if (pos === n + 1) {
      setAnim(false);
      setPos(1);
    } else if (pos === 0) {
      setAnim(false);
      setPos(n);
    }
  };

  return (
    <div className="e26-carousel">
      <div className="e26-carousel__viewport">
        <div
          className="e26-carousel__track"
          style={{
            transform: `translateX(-${single ? 0 : pos * 100}%)`,
            transition: anim ? undefined : "none",
          }}
          onTransitionEnd={onTransitionEnd}
        >
          {slides.map((it, i) => (
            <div className="e26-carousel__slide" key={i}>
              <img src={resolveAssetUrl(it.url)} alt={it.caption || it.name || ""} />
            </div>
          ))}
        </div>

        {!single && (
          <>
            <button
              type="button"
              className="e26-carousel__nav e26-carousel__nav--prev"
              onClick={() => go(-1)}
              title="Предыдущее"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="e26-carousel__nav e26-carousel__nav--next"
              onClick={() => go(1)}
              title="Следующее"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}

        <button
          type="button"
          className="e26-carousel__del"
          onClick={() => onRemove(realIndex)}
          title={t("Удалить это изображение")}
        >
          <Trash2 size={15} />
        </button>
        <div className="e26-carousel__counter">
          {realIndex + 1} / {n}
        </div>
      </div>

      {!single && (
        <div className="e26-carousel__dots">
          {items.map((_, i) => (
            <button
              type="button"
              key={i}
              className={i === realIndex ? "is-active" : ""}
              onClick={() => goReal(i)}
              title={`Слайд ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GalleryView({ block, editor }: { block: any; editor: any }) {
  const items = parseItems(block.props.items);
  const mode = (block.props.mode === "carousel" ? "carousel" : "grid") as GalleryMode;
  const inputRef = useRef<HTMLInputElement>(null);

  const setItems = (next: GalleryItem[]) =>
    editor.updateBlock(block, {
      type: "gallery",
      props: { items: JSON.stringify(next) },
    });

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: GalleryItem[] = [];
    // Дедуп по портабельной форме: храним `.assets/<имя>`, чтобы галерея
    // переезжала между ОС вместе с бэкапом (а не тянула абсолютный путь).
    const have = new Set(items.map((it) => toPortableAssetRef(it.url)));
    for (const f of Array.from(files)) {
      try {
        const a = await importFile(f);
        const url = toPortableAssetRef(a.url);
        // URL после SHA-дедупа совпадают детерминированно, если та же
        // картинка импортируется дважды (например, дубликат файла при
        // перетаскивании). Оставляем одну, также гарантирует уникальность
        // React-ключа `it.url` между ре-рендерами.
        if (have.has(url)) continue;
        have.add(url);
        added.push({ url, name: a.name });
      } catch (e) {
        console.error("gallery: import failed:", e);
      }
    }
    if (added.length) setItems([...items, ...added]);
  };

  const removeAt = (i: number) => setItems(items.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  const toggleMode = () =>
    editor.updateBlock(block, {
      type: "gallery",
      props: { mode: mode === "grid" ? "carousel" : "grid" },
    });

  return (
    <div className="e26-gallery" contentEditable={false}>
      <div className="e26-gallery__bar">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          title="Добавить изображения"
        >
          <ImagePlus size={14} /> Добавить
        </button>
        {items.length > 0 && (
          <button type="button" onClick={toggleMode} title="Сетка / карусель">
            {mode === "grid" ? "Карусель" : "Сетка"}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <button
          type="button"
          className="e26-gallery__empty"
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus size={18} /> Перетащи или выбери изображения
        </button>
      ) : mode === "grid" ? (
        <div className="e26-gallery__grid">
          {items.map((it, i) => (
            <figure key={it.url} className="e26-gallery__item">
              <img src={resolveAssetUrl(it.url)} alt={it.caption || it.name || ""} />
              <div className="e26-gallery__ctl">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title="Левее"
                >
                  <ChevronLeft size={14} />
                </button>
                <button type="button" onClick={() => removeAt(i)} title={t("Удалить")}>
                  <X size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1}
                  title="Правее"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </figure>
          ))}
        </div>
      ) : (
        <Carousel items={items} onRemove={removeAt} />
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void onPick(e.target.files)}
      />
    </div>
  );
}

export const galleryBlock = createReactBlockSpec(
  {
    type: "gallery",
    content: "none",
    propSchema: {
      items: { default: "[]" },
      mode: { default: "grid", values: ["grid", "carousel"] },
    },
  },
  {
    // Не изолированный/выделяемый атом: клик ставит текстовый курсор в
    // соседний параграф вместо NodeSelection на этом блоке (старый баг
    // caret-after-block).
    meta: { isolating: false, selectable: false },
    render: (props) => <GalleryView block={props.block} editor={props.editor} />,
    toExternalHTML: (props) => {
      const items = parseItems(props.block.props.items);
      return (
        <div data-gallery="1">
          {items.map((it, i) => (
            <img key={i} src={resolveAssetUrl(it.url)} alt={it.caption || it.name || ""} />
          ))}
        </div>
      );
    },
    parse: (el) =>
      el.getAttribute("data-gallery") === "1" ? { items: "[]" } : undefined,
  },
);
