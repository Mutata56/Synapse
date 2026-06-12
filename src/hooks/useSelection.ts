import { useCallback, useEffect, useState } from "react";

/**
 * Универсальный мультивыбор для списков/сеток.
 *
 * Операции: `toggle`, `select`, `clear`, `selectAll`, плюс флаги
 * `has`, `size`, `isSelecting`. Глобальный слушатель `Esc` снимает
 * выделение автоматически -- классический "отмена" шорткат.
 *
 * Ограничение `T extends string` намеренное: Set использует SameValueZero,
 * поэтому ссылочные типы (например NoteMeta) молча не совпадут между
 * рендерами. Только id / пути.
 */
export function useSelection<T extends string>() {
  // Ленивая инициализация: `new Set()` запускается один раз при маунте,
  // а не создаёт новый Set на каждый рендер (React всё равно берёт первый).
  const [selection, setSelection] = useState<Set<T>>(() => new Set());

  // Вычисляем один раз и переиспользуем -- и в consumer, и в deps эффекта ниже.
  // Булево значение (вместо `selection.size`) как зависимость эффекта значит,
  // что keydown listener регистрируется на переходе 0 -> 1 и остаётся на
  // всю сессию выбора, а не пересоздаётся при каждом toggle.
  const isSelecting = selection.size > 0;

  const toggle = useCallback((id: T) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const select = useCallback((id: T) => {
    setSelection((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Функциональная форма экономит лишний ререндер, когда вызывающий чистит
  // и так пустой selection (например, при анмаунте в родительском view).
  const clear = useCallback(() => {
    setSelection((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const selectAll = useCallback((ids: T[]) => {
    setSelection(new Set(ids));
  }, []);

  // Глобальный Esc снимает текущее выделение.
  useEffect(() => {
    if (!isSelecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelection((prev) => (prev.size === 0 ? prev : new Set()));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSelecting]);

  return {
    selection,
    has: (id: T) => selection.has(id),
    size: selection.size,
    isSelecting,
    toggle,
    select,
    clear,
    selectAll,
  };
}
