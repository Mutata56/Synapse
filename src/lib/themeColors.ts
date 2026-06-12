/**
 * Мостик между CSS-переменными темы и тинтами Pixi.js.
 *
 * Граф живёт на WebGL-канвасе, но его палитра (заливки нод, цвета метаболов
 * кластеров) должна совпадать с DOM-темой из index.css. Pixi хочет цвета как
 * целые 0xRRGGBB, а CSS даёт произвольный синтаксис: `#rrggbb`, `rgb(...)`,
 * именованные цвета, современный `oklch(...)`, даже `var(--x)`.
 *
 * Вместо того чтобы парсить каждое цветовое пространство руками (и проворонить
 * тот же `oklch`), даём разрулить браузеру: скрытому пробному <span> присваиваем
 * цвет в `color`, а `getComputedStyle(probe).color` всегда возвращается обычным
 * `rgb(...)` / `rgba(...)`, какое бы пространство ни было на входе. Так граф и
 * стили делят ОДИН источник правды, и смена темы или живая перекраска кластеров
 * это просто "перечитать переменные и перетинтить", без пересборки.
 */

/** Сколько слотов цветов кластеров, как `--cluster-0 … --cluster-{N-1}`. */
export const CLUSTER_SLOTS = 12;

let probe: HTMLSpanElement | null = null;
function probeEl(): HTMLSpanElement | null {
  if (probe) return probe;
  if (typeof document === "undefined" || !document.body) return null;
  probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  return probe;
}

/** Парсит обычную строку `#hex` / `rgb()` / `rgba()` в int 0xRRGGBB. */
function parseRgb(s: string): number | null {
  const t = s.trim();
  if (t.startsWith("#")) {
    if (t.length === 7) return parseInt(t.slice(1), 16);
    if (t.length === 4) {
      const r = t[1];
      const g = t[2];
      const b = t[3];
      return parseInt(r + r + g + g + b + b, 16);
    }
  }
  const m = t.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (p.length >= 3 && p.slice(0, 3).every((n) => Number.isFinite(n))) {
      return ((p[0] & 255) << 16) | ((p[1] & 255) << 8) | (p[2] & 255);
    }
  }
  return null;
}

/**
 * Резолвит любое CSS-выражение цвета (hex / rgb / именованный / `oklch(...)` /
 * `var(--x)`) в int 0xRRGGBB через браузерный движок computed-value.
 */
function resolveToInt(expr: string): number | null {
  const el = probeEl();
  if (el) {
    el.style.color = "";
    el.style.color = expr; // неподдерживаемое значение CSSOM выкинет, останется ""
    if (el.style.color) {
      const n = parseRgb(getComputedStyle(el).color);
      if (n !== null) return n;
    }
  }
  return parseRgb(expr); // на крайний случай (SSR или уже hex)
}

/** Резолвит любую CSS-строку цвета в Pixi-int 0xRRGGBB (с oklch). */
export function cssColorToInt(css: string, fallback = 0xffffff): number {
  return resolveToInt(css) ?? fallback;
}

/** Читает CSS-проперти (например "--accent") как int 0xRRGGBB. */
export function cssVarToInt(name: string, fallback = 0xffffff): number {
  return resolveToInt(`var(${name})`) ?? fallback;
}

/**
 * Читает палитру кластеров (`--cluster-0 … --cluster-{N-1}`) как int. CSS-тема
 * это источник правды, `fallback` (встроенная палитра приложения) заполняет
 * слоты, которых тема не задала. Зови один раз при сборке графа и ещё раз после
 * смены темы для живой перекраски. Число слотов берётся из `fallback`, если он есть.
 */
export function readClusterPalette(fallback: readonly number[] = []): number[] {
  const slots = fallback.length || CLUSTER_SLOTS;
  const out: number[] = [];
  for (let i = 0; i < slots; i++) {
    const fb = fallback.length ? fallback[i % fallback.length] : 0x9aa0ad;
    out.push(resolveToInt(`var(--cluster-${i})`) ?? fb);
  }
  return out;
}

/** Читает палитру кластеров как нормализованные hex-строки (для плашек в DOM). */
export function readClusterHexes(): string[] {
  return readClusterPalette().map(
    (n) => "#" + n.toString(16).padStart(6, "0"),
  );
}
