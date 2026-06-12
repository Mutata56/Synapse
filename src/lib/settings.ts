/**
 * Глобальные настройки приложения: цвет-акцент, глобальный хоткей быстрой
 * заметки, поведение на старте. Храним ОДНИМ JSON-дотфайлом в воркспейсе
 * (`notes/.settings.json`, читает/пишет storage.ts), чтобы ездили вместе с
 * папкой заметок, как и цвета папок. Никакого localStorage, воркспейс это
 * единственный источник правды.
 *
 * Модуль чистый (типы, дефолты, валидация и применение акцента в DOM). Намеренно
 * НЕ импортит storage.ts, чтобы не было цикла: это storage.ts тянет отсюда тип
 * и coerceSettings.
 */

export type AppSettings = {
  /** Цвет-акцент как hex `#rrggbb`. Управляет переменными `--color-accent*`. */
  accentColor: string;
  /** Tauri-аксельератор для глобального окна быстрой заметки, например
   *  `"CommandOrControl+Shift+N"`. Переназначается на лету через Rust-команду
   *  `set_capture_shortcut`. */
  captureShortcut: string;
  /** Открывать заметку дня автоматически при запуске. */
  openDailyOnStartup: boolean;
  /** Приватный URL экспорта iCalendar (Яндекс.Календарь или любой). Пусто это
   *  выключено. Тянем только на чтение через Rust-команду `fetch_ics` и кладём
   *  поверх календаря. В URL зашит приватный токен, так что это секрет. */
  calendarIcsUrl: string;
  /** Логин (почта) для Яндекс CalDAV, чтобы пушить свои задачи как события. */
  caldavLogin: string;
  /** Пароль приложения CalDAV. СЕКРЕТ: лежит в `.settings.json` рядом с заметками,
   *  как и `calendarIcsUrl`. Не путать с основным паролем аккаунта. */
  caldavPassword: string;
  /** URL календарной коллекции для PUT событий, выбирается через "Найти календари". */
  caldavUrl: string;
};

/** Дефолты совпадают с тем, что раньше было захардкожено в CSS и Rust, так что
 *  свежая установка ведёт себя как до появления экрана настроек. Хоткей
 *  повторяет нативную регистрацию в `lib.rs` (CONTROL|SHIFT + KeyN), на
 *  Windows/Linux `CommandOrControl` это Ctrl. */
export const DEFAULT_SETTINGS: AppSettings = {
  accentColor: "#6366f1",
  captureShortcut: "CommandOrControl+Shift+N",
  openDailyOnStartup: false,
  calendarIcsUrl: "",
  caldavLogin: "",
  caldavPassword: "",
  caldavUrl: "",
};

/** Пресеты акцента, показаны плашками в настройках. Первый это исторический
 *  дефолтный индиго. */
export const ACCENT_PRESETS: readonly { hex: string; label: string }[] = [
  { hex: "#6366f1", label: "Индиго" },
  { hex: "#8b5cf6", label: "Фиолетовый" },
  { hex: "#3b82f6", label: "Синий" },
  { hex: "#06b6d4", label: "Бирюзовый" },
  { hex: "#10b981", label: "Изумрудный" },
  { hex: "#f59e0b", label: "Янтарный" },
  { hex: "#ef4444", label: "Красный" },
  { hex: "#ec4899", label: "Розовый" },
];

export function isValidHex(v: unknown): v is string {
  return typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v.trim());
}

/** Нижний регистр `#rrggbb`. Считаем, что isValidHex(hex) уже прошёл. */
export function normalizeHex(hex: string): string {
  const h = hex.trim().toLowerCase();
  return h.startsWith("#") ? h : `#${h}`;
}

/**
 * Приводит произвольный распарсенный JSON к валидному `AppSettings` по полям,
 * для пропущенного или кривого берём дефолт. Так руками правленый или старый
 * файл настроек не уронит приложение.
 */
export function coerceSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS };
  }
  const r = raw as Record<string, unknown>;
  return {
    accentColor: isValidHex(r.accentColor)
      ? normalizeHex(r.accentColor)
      : DEFAULT_SETTINGS.accentColor,
    captureShortcut:
      typeof r.captureShortcut === "string" && r.captureShortcut.trim()
        ? r.captureShortcut.trim()
        : DEFAULT_SETTINGS.captureShortcut,
    openDailyOnStartup:
      typeof r.openDailyOnStartup === "boolean"
        ? r.openDailyOnStartup
        : DEFAULT_SETTINGS.openDailyOnStartup,
    calendarIcsUrl:
      typeof r.calendarIcsUrl === "string"
        ? r.calendarIcsUrl.trim()
        : DEFAULT_SETTINGS.calendarIcsUrl,
    caldavLogin:
      typeof r.caldavLogin === "string"
        ? r.caldavLogin.trim()
        : DEFAULT_SETTINGS.caldavLogin,
    caldavPassword:
      typeof r.caldavPassword === "string"
        ? r.caldavPassword
        : DEFAULT_SETTINGS.caldavPassword,
    caldavUrl:
      typeof r.caldavUrl === "string"
        ? r.caldavUrl.trim()
        : DEFAULT_SETTINGS.caldavUrl,
  };
}

/** true для http(s) URL, только их и тянет `fetch_ics`. */
export function isValidIcsUrl(v: string): boolean {
  const s = v.trim();
  return /^https?:\/\/.+/i.test(s);
}

// ─── Применение акцента (DOM) ────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Подмешивает к цвету белый на `t` (0..1), так из базового акцента получаем
 *  светлые оттенки ссылок. */
function lighten(hex: string, t: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  const toHex = (c: number) => mix(c).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Применяет цвет-акцент в рантайме, переопределяя `@theme` CSS-переменные на
 * корневом элементе. Инлайн-проперти на `<html>` бьют дефолты `:root` из
 * стилей, так что мгновенно перекрашивается всё, что юзает `var(--color-accent*)`
 * (пилюли навигации, фокус-рамки, ссылки, wiki-ссылки, выделение). Производные
 * варианты по альфе и светлоте повторяют исходные дизайн-токены.
 */
export function applyAccent(hex: string): void {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  const { r, g, b } = rgb;
  const root = document.documentElement;
  root.style.setProperty("--color-accent", hex);
  root.style.setProperty("--color-accent-bg", `rgba(${r}, ${g}, ${b}, 0.12)`);
  root.style.setProperty("--color-accent-bg-hover", `rgba(${r}, ${g}, ${b}, 0.18)`);
  root.style.setProperty("--color-accent-border", `rgba(${r}, ${g}, ${b}, 0.35)`);
  root.style.setProperty("--color-link", lighten(hex, 0.15));
  root.style.setProperty("--color-link-hover", lighten(hex, 0.3));
}

// ─── Хелперы хоткея заметки ────────────────────────────────────────────────

/** Переводит `KeyboardEvent.code` в токен основной клавиши, который понимает
 *  парсер аксельераторов Tauri. Только буквы, цифры и F-клавиши, это безопасный
 *  однозначный набор, покрывает почти любой хоткей и обходит крайние случаи
 *  парсера с именованными клавишами. Для прочего вернёт null. */
function mainKeyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3); // KeyN это "N"
  if (/^Digit[0-9]$/.test(code)) return code.slice(5); // Digit1 это "1"
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code; // F1..F24
  return null;
}

type ModifierState = {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  code: string;
};

/**
 * Собирает строку аксельератора Tauri (например `"CommandOrControl+Shift+N"`)
 * из события клавиатуры. Нужен хотя бы один модификатор плюс разрешённая
 * основная клавиша, иначе null, и UI-рекордер попросит валидную комбинацию.
 * Ctrl/Cmd схлопываем в кросс-платформенный токен `CommandOrControl`.
 */
export function accelFromKeyboardEvent(e: ModifierState): string | null {
  const key = mainKeyFromCode(e.code);
  if (!key) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (mods.length === 0) return null; // глобальному хоткею нужен модификатор
  return [...mods, key].join("+");
}

const PRETTY_TOKEN: Record<string, string> = {
  CommandOrControl: "Ctrl",
  CmdOrCtrl: "Ctrl",
  Control: "Ctrl",
  Ctrl: "Ctrl",
  Command: "Cmd",
  Cmd: "Cmd",
  Meta: "Meta",
  Super: "Super",
  Alt: "Alt",
  Option: "Alt",
  Shift: "Shift",
};

/** Человеко-читаемый вид аксельератора, например
 *  `"CommandOrControl+Shift+N"` даёт `"Ctrl + Shift + N"`. */
export function prettyAccelerator(accel: string): string {
  return accel
    .split("+")
    .map((t) => PRETTY_TOKEN[t] ?? t)
    .join(" + ");
}
