/**
 * Маленький мостик между поиском "В графе" в командной палитре и живым
 * GraphView. GraphView владеет Pixi-симуляцией, поэтому, пока смонтирован,
 * регистрирует здесь focus-handler. Палитра зовёт `requestGraphFocus(key)`,
 * когда выбрали результат-узел. Развязывает два компонента, не таская
 * внутренности графа через стор.
 */

let handler: ((key: string) => void) | null = null;

/** GraphView регистрирует (при mount) / сбрасывает (при unmount) свой focus-handler здесь. */
export function setGraphFocusHandler(fn: ((key: string) => void) | null): void {
  handler = fn;
}

/** Палитра фокусирует узел по его ключу в графе (`f:` папка / `n:` заметка).
 *  Ничего не делает, если граф не смонтирован. */
export function requestGraphFocus(key: string): void {
  handler?.(key);
}
