// src/editor2026/blocks/whiteboard/NodeOverlay.tsx
//
// Плавающий React "контекстный оверлей", рендерится ПОВЕРХ доски когда
// активируется нода, чтобы редактировать данные которые canvas намеренно
// не рисует, прежде всего SQL-запрос БД-ноды.
//
// Vanilla-движок не знает про React: он вызывает колбэк с простым state
// объектом (уже в viewport-пикселях), а React рисует этот оверлей.
// Позиционируем через `position: fixed` используя screenX/screenY
// (пиксели viewport), аналогично текстовому textarea-оверлею в WhiteboardCanvas.
//
// Семантика коммита (общасть для всех типов):
//   "Сохранить", Ctrl/Cmd+Enter, кнопка X и Escape всё КОММИТЯТ и закрывают.
//   Escape НЕ отбрасывает -- сохраняет текущие правки, как и текстовый оверлей.
//   onCommit получает ТОЛЬКО изменившиеся поля.
//   keydown / pointerdown останавливаются, чтобы ProseMirror и canvas не
//   видели события оверлея.
//
// Вся визуальная стилизация в CSS (классы e26-wb-nodeov / e26-wb-nodeov__*).
// Единственный инлайн-стиль это фиксированное left/top позиционирование,
// которое невозможно сделать на CSS (данные драйвят позицию).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Database, Save, X } from "lucide-react";
import { t } from "../../../lib/i18n";

export type NodeOverlayState =
  | { kind: "db"; id: string; title: string; query: string; screenX: number; screenY: number }
  | { kind: "action"; id: string; label: string; screenX: number; screenY: number }
  | { kind: "note"; id: string; text: string; screenX: number; screenY: number };

export type NodeOverlayProps = {
  state: NodeOverlayState | null;
  onCommit: (id: string, patch: { title?: string; query?: string; label?: string; text?: string }) => void;
  onClose: () => void;
};

/** Примерная ширина панели (должна совпадать с CSS `width`), для viewport-clamping. */
const PANEL_W = 360;
/** Примерная высота панели, чтобы нижний край оставался на экране. */
const PANEL_H_EST = 340;
/** Отступ от краёв viewport при clamping. */
const MARGIN = 12;

/** Локальный редактируемый черновик. Используются только поля relevant для текущего kind. */
type Draft = { title: string; query: string; label: string; text: string };

function draftFromState(s: NodeOverlayState): Draft {
  switch (s.kind) {
    case "db":
      return { title: s.title, query: s.query, label: "", text: "" };
    case "action":
      return { title: "", query: "", label: s.label, text: "" };
    case "note":
      return { title: "", query: "", label: "", text: s.text };
  }
}

/** Clamp фиксированной позиции, чтобы панель не вылезала за viewport. */
function clampPos(screenX: number, screenY: number): { left: number; top: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let left = screenX;
  let top = screenY;
  if (left + PANEL_W + MARGIN > vw) left = vw - PANEL_W - MARGIN;
  if (left < MARGIN) left = MARGIN;
  if (top + PANEL_H_EST + MARGIN > vh) top = vh - PANEL_H_EST - MARGIN;
  if (top < MARGIN) top = MARGIN;
  return { left, top };
}

export default function NodeOverlay(props: NodeOverlayProps): JSX.Element | null {
  const { state, onCommit, onClose } = props;

  // Контролируемый локальный черновик, переинициализируется при открытии
  // другой *ноды*.
  const [draft, setDraft] = useState<Draft>(() =>
    state ? draftFromState(state) : { title: "", query: "", label: "", text: "" },
  );

  // Пересеиваем черновик при смене целевой ноды (id) или (ре)открытии оверлея.
  // Ключ по id + kind, чтобы реоткрытие той же ноды тоже обновляло.
  const id = state?.id;
  const kind = state?.kind;
  useEffect(() => {
    if (state) setDraft(draftFromState(state));
    // Зависим ТОЛЬКО от id/kind: живые наборы обновляют `draft` локально
    // и их НЕЛЬЗЯ затереть повторной передачей того же state от родителя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);

  // Фокус на основное поле при маунте панели для конкретной ноды.
  const titleRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!state) return;
    const raf = requestAnimationFrame(() => {
      if (state.kind === "db") titleRef.current?.focus();
      else if (state.kind === "action") labelRef.current?.select();
      else textRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);

  // Собираем минимальный патч (только изменившиеся поля) и коммитим + закрываем.
  const commit = useCallback(() => {
    if (!state) return;
    const patch: { title?: string; query?: string; label?: string; text?: string } = {};
    switch (state.kind) {
      case "db":
        if (draft.title !== state.title) patch.title = draft.title;
        if (draft.query !== state.query) patch.query = draft.query;
        break;
      case "action":
        if (draft.label !== state.label) patch.label = draft.label;
        break;
      case "note":
        if (draft.text !== state.text) patch.text = draft.text;
        break;
    }
    onCommit(state.id, patch);
    onClose();
  }, [state, draft, onCommit, onClose]);

  // Вставляем два пробела в каретку SQL-редактора, потом восстанавливаем
  // каретку. Мутируем DOM value + selection СИНХРОННО (чтобы каретка
  // встала точно куда надо, без гонки rAF с React value sync), и
  // зеркалим результат в React state -- controlled value совпадает с DOM,
  // поэтому React commit это no-op который не сбивает каретку.
  const insertTabIndent = useCallback(() => {
    const ta = queryRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const next = value.slice(0, start) + "  " + value.slice(end);
    ta.value = next;
    ta.selectionStart = ta.selectionEnd = start + 2;
    setDraft((d) => ({ ...d, query: next }));
  }, []);

  // Один keydown-хэндлер для всей панели: останавливаем всплытие чтобы ни
  // canvas, ни ProseMirror не реагировали, и подключаем шорткаты коммита.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        commit(); // Escape коммитит текущие правки и закрывает (НЕ отбрасывает).
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
        return;
      }
      // Tab внутри SQL-редактора вставляет два пробела вместо ухода из поля.
      if (e.key === "Tab" && e.target === queryRef.current) {
        e.preventDefault();
        insertTabIndent();
      }
    },
    [commit, insertTabIndent],
  );

  if (!state) return null;

  const { left, top } = clampPos(state.screenX, state.screenY);

  return (
    <div
      className="e26-wb-nodeov"
      role="dialog"
      aria-modal="true"
      style={{ left: `${left}px`, top: `${top}px` }}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="e26-wb-nodeov__head">
        <span className="e26-wb-nodeov__title">
          {state.kind === "db" ? (
            <>
              <Database size={15} strokeWidth={2} aria-hidden />
              База данных
            </>
          ) : state.kind === "action" ? (
            t("Действие")
          ) : (
            t("Заметка")
          )}
        </span>
        <button
          type="button"
          className="e26-wb-nodeov__x"
          title="Закрыть и сохранить"
          aria-label="Закрыть и сохранить"
          onClick={commit}
        >
          <X size={16} strokeWidth={2.2} aria-hidden />
        </button>
      </header>

      <div className="e26-wb-nodeov__body">
        {state.kind === "db" && (
          <>
            <label className="e26-wb-nodeov__field">
              <span className="e26-wb-nodeov__label">{t("Имя / таблица")}</span>
              <input
                ref={titleRef}
                className="e26-wb-nodeov__input"
                type="text"
                value={draft.title}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                placeholder="users"
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </label>
            <label className="e26-wb-nodeov__field">
              <span className="e26-wb-nodeov__label">SQL-запрос</span>
              <textarea
                ref={queryRef}
                className="e26-wb-nodeov__code"
                value={draft.query}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                wrap="off"
                rows={7}
                placeholder={"SELECT *\nFROM users\nWHERE active = true;"}
                onChange={(e) => setDraft((d) => ({ ...d, query: e.target.value }))}
              />
            </label>
          </>
        )}

        {state.kind === "action" && (
          <label className="e26-wb-nodeov__field">
            <span className="e26-wb-nodeov__label">{t("Действие")}</span>
            <input
              ref={labelRef}
              className="e26-wb-nodeov__input"
              type="text"
              value={draft.label}
              spellCheck={false}
              placeholder="Обработать заказ"
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            />
          </label>
        )}

        {state.kind === "note" && (
          <label className="e26-wb-nodeov__field">
            <span className="e26-wb-nodeov__label">{t("Заметка")}</span>
            <textarea
              ref={textRef}
              className="e26-wb-nodeov__textarea"
              value={draft.text}
              rows={5}
              placeholder="Свободный текст…"
              onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            />
          </label>
        )}
      </div>

      <footer className="e26-wb-nodeov__foot">
        <span className="e26-wb-nodeov__hint">⌘/Ctrl+Enter</span>
        <button type="button" className="e26-wb-nodeov__save" onClick={commit}>
          <Save size={15} strokeWidth={2.2} aria-hidden />
          {t("Сохранить")}
        </button>
      </footer>
    </div>
  );
}
