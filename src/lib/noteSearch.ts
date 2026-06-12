/**
 * Кирпичики поиска внутри заметки, общие для режима "in note" в палитре команд.
 * Ищем по живому BlockNote DOM (ProseMirror), а найденное подсвечиваем через
 * CSS Custom Highlight API, то есть поверх DOM, а не внутри него. Так мы не
 * вставляем никаких тегов в редактируемую область ProseMirror.
 */

export const HL_ALL = "note-search";
export const HL_CURRENT = "note-search-current";

const BN_EDITOR_SELECTOR = ".bn-editor";
const SCROLL_CONTAINER_SELECTOR = "[data-editor-scroll]";

/** Сколько символов контекста оставляем с каждой стороны совпадения в строке-сниппете. */
const SNIPPET_CONTEXT_CHARS = 48;
/** Жёсткий потолок на число собранных совпадений. Ограничивает работу
 *  TreeWalker и рендера на огромных заметках. С большим запасом от того, что
 *  кто-то реально пролистает за один поиск. */
const MATCH_LIMIT = 300;
const SCROLL_PADDING_PX = 80;

export type NoteMatch = {
  /** Живой DOM-range, валиден пока DOM редактора не трогали. */
  range: Range;
  /** Текст прямо перед совпадением (уже обрезан и с многоточием). */
  before: string;
  /** Само совпадение, в исходном регистре. */
  text: string;
  /** Текст сразу после совпадения. */
  after: string;
};

type HighlightLike = { add: (range: Range) => void };
export type HighlightApi = {
  paint: (name: string, ranges: Range[]) => void;
  clear: (name: string) => void;
};

// ─── Адаптер над CSS Custom Highlight API ──────────────────────────────────────────

/**
 * Типизированная обёртка над CSS Custom Highlight API. Возвращает null, если в
 * рантайме нет `CSS.highlights` / `Highlight` (тогда поиск деградирует до "без
 * визуальной подсветки, список всё равно работает"). `paint` с пустым массивом
 * заодно работает как `clear`.
 */
export function getHighlightApi(): HighlightApi | null {
  const w = window as unknown as {
    CSS?: { highlights?: Map<string, unknown> };
    Highlight?: new () => HighlightLike;
  };
  const map = w.CSS?.highlights;
  const Ctor = w.Highlight;
  if (!map || !Ctor) return null;

  const clear = (name: string): void => {
    try {
      map.delete(name);
    } catch {
      /* по спеке Map.delete не кидает, но на всякий случай */
    }
  };
  return {
    paint: (name, ranges) => {
      if (ranges.length === 0) {
        clear(name);
        return;
      }
      const h = new Ctor();
      for (const r of ranges) h.add(r);
      map.set(name, h as unknown as object);
    },
    clear,
  };
}

/** Скроллящийся контейнер вокруг редактора (помечен в Editor.tsx). */
export function findEditorScrollContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
}

function findEditableRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(BN_EDITOR_SELECTOR);
}

// ─── Сбор совпадений ──────────────────────────────────────────────────────────

/**
 * Обходит DOM редактора и отдаёт по одному NoteMatch на каждое вхождение
 * `query` (регистр игнорим). В каждом живой Range плюс обрезанный сниппет
 * (before / match / after) для показа. Предфильтр `acceptNode` пропускает
 * текстовые ноды без совпадений, чтобы не плодить Range в частом случае "не
 * нашли".
 */
export function collectNoteMatches(query: string): NoteMatch[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const editable = findEditableRoot();
  if (!editable) return [];

  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.nodeValue && node.nodeValue.toLowerCase().includes(q)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const matches: NoteMatch[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? "";
    const lower = text.toLowerCase();
    let from = 0;
    let idx = lower.indexOf(q, from);
    while (idx !== -1) {
      const end = idx + q.length;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, end);

      const rawBefore = text.slice(Math.max(0, idx - SNIPPET_CONTEXT_CHARS), idx);
      const rawAfter = text.slice(end, end + SNIPPET_CONTEXT_CHARS);
      matches.push({
        range,
        text: text.slice(idx, end),
        before: (idx > SNIPPET_CONTEXT_CHARS ? "…" : "") + rawBefore,
        after: rawAfter + (end + SNIPPET_CONTEXT_CHARS < text.length ? "…" : ""),
      });

      if (matches.length >= MATCH_LIMIT) return matches;
      from = end;
      idx = lower.indexOf(q, from);
    }
  }
  return matches;
}

// ─── Скролл ─────────────────────────────────────────────────────────────────────

/**
 * Плавно скроллит контейнер так, чтобы `range` оказался примерно по центру.
 * Ничего не делает, если range оторван от DOM (rect нулевого размера) или и так
 * нормально виден.
 */
export function scrollRangeIntoView(
  range: Range,
  container: HTMLElement | null,
): void {
  if (!container) return;
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const cRect = container.getBoundingClientRect();
  const outOfView =
    rect.top < cRect.top + SCROLL_PADDING_PX ||
    rect.bottom > cRect.bottom - SCROLL_PADDING_PX;
  if (outOfView) {
    container.scrollBy({
      top: rect.top - cRect.top - container.clientHeight / 2,
      behavior: "smooth",
    });
  }
}
