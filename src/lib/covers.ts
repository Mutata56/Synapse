/**
 * Токены обложек, лежат во фронтматтере заметки.
 *
 * Каждая обложка это строка `<префикс>:<значение>`, так различаем три источника
 * без лишних полей:
 *   gradient:<id>     один из встроенных GRADIENTS ниже
 *   file:<имя>        наш ассет в .assets/<имя>
 *   url:<абсолютный>  удалённая картинка (например с CDN Unsplash)
 */

export const COVER_PREFIX = {
  gradient: "gradient:",
  file: "file:",
  url: "url:",
} as const;

/**
 * Дискриминатор разобранных обложек. Префиксные варианты выводятся из ключей
 * `COVER_PREFIX`, так что новый префикс в том объекте сам протекает сюда и в
 * `PREFIX_KINDS` (его юзает parseCover), без второго ручного списка.
 */
export type CoverKind = "none" | keyof typeof COVER_PREFIX;

export type CoverParsed = {
  kind: CoverKind;
  /** Для "gradient" это id. Для "file" имя ассета. Для "url" абсолютный URL.
   *  Для "none" пустая строка. */
  value: string;
};

export type CoverGradient = {
  id: string;
  name: string;
  className: string;
};

export const GRADIENTS = [
  { id: "sunset",   name: "Sunset",   className: "bg-gradient-to-r from-orange-400 via-rose-400 to-pink-500" },
  { id: "aurora",   name: "Aurora",   className: "bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500" },
  { id: "ocean",    name: "Ocean",    className: "bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600" },
  { id: "forest",   name: "Forest",   className: "bg-gradient-to-r from-emerald-500 via-teal-500 to-green-600" },
  { id: "midnight", name: "Midnight", className: "bg-gradient-to-r from-indigo-900 via-purple-900 to-zinc-900" },
  { id: "violet",   name: "Violet",   className: "bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500" },
  { id: "rose",     name: "Rose",     className: "bg-gradient-to-r from-rose-400 via-fuchsia-500 to-pink-500" },
  { id: "mint",     name: "Mint",     className: "bg-gradient-to-r from-green-400 via-emerald-400 to-cyan-400" },
  { id: "ember",    name: "Ember",    className: "bg-gradient-to-r from-yellow-500 via-orange-500 to-red-600" },
  { id: "cosmic",   name: "Cosmic",   className: "bg-gradient-to-br from-indigo-700 via-purple-700 to-pink-700" },
  { id: "slate",    name: "Slate",    className: "bg-gradient-to-r from-slate-700 via-zinc-700 to-stone-800" },
  { id: "candy",    name: "Candy",    className: "bg-gradient-to-r from-fuchsia-400 via-pink-400 to-rose-400" },
] as const satisfies ReadonlyArray<CoverGradient>;

/** Быстрый поиск по id, строим один раз при загрузке модуля. */
const GRADIENTS_BY_ID = new Map<string, CoverGradient>(
  GRADIENTS.map((g) => [g.id, g]),
);

const DEFAULT_GRADIENT = GRADIENTS[0];

/**
 * Префиксные виды в порядке проверки parseCover. Выводятся из самого
 * `COVER_PREFIX`, новый префикс подхватится сам. Каст безопасен: Object.keys
 * всегда возвращает ровно рантайм-ключи этого объекта.
 */
const PREFIX_KINDS = Object.keys(COVER_PREFIX) as Array<
  keyof typeof COVER_PREFIX
>;

/**
 * Разбирает сохранённый токен обложки на префикс и значение. Для null или
 * неизвестного токена возвращает вид "none", вызывающий свитчится по `kind`.
 */
export function parseCover(token: string | null): CoverParsed {
  if (!token) return { kind: "none", value: "" };

  for (const kind of PREFIX_KINDS) {
    const prefix = COVER_PREFIX[kind];
    if (token.startsWith(prefix)) {
      return { kind, value: token.slice(prefix.length) };
    }
  }
  return { kind: "none", value: "" };
}

/**
 * По id градиента отдаёт его Tailwind-классы. Если id неизвестен, берём первый
 * градиент, но в dev ещё и варним, чтобы опечатки не пропадали молча.
 */
export function gradientClassName(gradientId: string): string {
  const found = GRADIENTS_BY_ID.get(gradientId);
  if (found) return found.className;
  if (import.meta.env.DEV) {
    console.warn(`gradientClassName: unknown gradient id "${gradientId}"`);
  }
  return DEFAULT_GRADIENT.className;
}

/** Берёт случайный градиент равномерно и возвращает его токен для фронтматтера. */
export function randomGradientToken(): string {
  const pick = GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)];
  return `${COVER_PREFIX.gradient}${pick.id}`;
}

export function fileCoverToken(assetName: string): string {
  return `${COVER_PREFIX.file}${assetName}`;
}

export function urlCoverToken(absoluteUrl: string): string {
  return `${COVER_PREFIX.url}${absoluteUrl}`;
}
