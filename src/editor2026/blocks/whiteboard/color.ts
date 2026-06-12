// src/editor2026/blocks/whiteboard/color.ts
//
// Конвертация OKLCH в sRGB hex + палитра с равномерным восприятием для пикера
// цветов доски. Храним как hex (безопасно для Canvas 2D fillStyle и CSS);
// OKLCH используется только для генерации вариантов (фиксированная яркость
// и насыщенность, меняется тон), поэтому палитра выглядит как единое семейство,
// а не набор случайных цветов.

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Линейный канал в гамма-кодированный sRGB (0..1). */
function srgbGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function hex2(v: number): string {
  return Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * OKLCH в "#rrggbb". L в 0..1, C в 0..~0.4, H в градусах. Цвета за
 * гамутом клипаются по каналам (для UI-палитры достаточно).
 */
export function oklchToHex(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  // OKLab в LMS (кубический корень), затем линейный LMS.
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // LMS в линейный sRGB.
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return `#${hex2(srgbGamma(r))}${hex2(srgbGamma(g))}${hex2(srgbGamma(bl))}`;
}

// Круг оттенков, шаг 30°. Индиго (~265°) первый, основной акцент приложения.
const HUES = [265, 295, 325, 355, 25, 55, 90, 130, 165, 200, 230, 245];

/**
 * Строки пикера, все hex:
 *   0 , яркие (одна яркость/насыщенность, меняется тон), читается как "один набор"
 *   1 , мягкие/пастельные (светлее, меньше насыщенность)
 *   2 , глубокие (темнее, похожая насыщенность)
 *   3 , нейтральные (серые + почти белый + почти черный)
 */
export const PALETTE_ROWS: string[][] = [
  HUES.map((h) => oklchToHex(0.72, 0.14, h)),
  HUES.map((h) => oklchToHex(0.85, 0.08, h)),
  HUES.map((h) => oklchToHex(0.5, 0.13, h)),
  [0.16, 0.3, 0.45, 0.6, 0.74, 0.88, 0.96, 1].map((l) => oklchToHex(l, 0, 0)),
];

/** Плоский список (например, для компактной полоски). */
export const PALETTE_FLAT: string[] = PALETTE_ROWS.flat();
