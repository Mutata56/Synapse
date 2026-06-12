// src/lib/templates.ts
//
// Хранилище шаблонов. Шаблон это обычная markdown-заметка в скрытой папке
// notes/.templates/<slug>.md, тот же приём, что и для .assets, .trash,
// .versions, .cache. Правило skipDotted в buildTree (storage.ts) само прячет
// эту папку от дерева, поиска и графа, так что отдельных фильтров не нужно.
//
// Каждый шаблон это .md с фронтматтером (title, icon, createdAt, updatedAt),
// телом и BlockNote JSON рядом, то есть по форме ровно заметка. Поэтому
// readNote / writeNote переиспользуем как есть и бесплатно получаем версии.
//
// Старый .templates/daily.md тут просто один из многих, listTemplates
// показывает его как любой другой, миграции не надо.

import { BaseDirectory, exists, readDir, remove } from "@tauri-apps/plugin-fs";
import { readNote, writeNote, type Note } from "./storage";

// ─── Константы ─────────────────────────────────────────────────────────────

/** Путь к скрытой папке шаблонов (относительно воркспейса). Как .assets,
 *  .trash, .versions, .cache. */
export const TEMPLATES_DIR = "notes/.templates";

const APP_DATA = { baseDir: BaseDirectory.AppData } as const;

const NOTE_EXT = ".md";

// ─── Публичные типы ──────────────────────────────────────────────────────────

export type TemplateMeta = {
  /** Storage id без ведущего `notes/` и без `.md`, то есть ровно то, что
   *  принимают readNote / writeNote (`.templates/<slug>`). */
  id: string;
  /** Голый slug (например `weekly-review`), удобно для показа и дедупа. */
  slug: string;
  name: string;
  icon: string | null;
  updatedAt: number;
};

export type Template = TemplateMeta & {
  content: string;
  blocknote: string | null;
  bnHash: number | null;
};

// ─── Слаги (кириллица, без зависимостей) ────────────────────────────────────

/** Минимальная транслит-таблица из кириллицы в латиницу (частые буквы, редкие
 *  маплю на ближайшее). Только нижний регистр, верхний приводим заранее. */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e",
  ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "",
  ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Превращает имя шаблона в ASCII-безопасное имя файла. Кириллицу
 * транслитерируем, остальное заменяем на `-`. Если вышло пусто (ввели только
 * эмодзи или пунктуацию), берём случайный uuid, чтобы у файла было имя.
 */
export function slugifyTemplateName(name: string): string {
  const lower = name.trim().toLowerCase();
  let out = "";
  for (const ch of lower) {
    if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else out += ch;
  }
  out = out
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!out) {
    // Запасной случайный id. crypto.randomUUID есть в современных браузерах и
    // вебвью Tauri, crypto.subtle мы тут и так уже используем.
    out =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
  }
  return out;
}

// ─── Хелперы путей ──────────────────────────────────────────────────────────

/** Storage id (то, что принимают readNote/writeNote) по слагу. */
const idOf = (slug: string): string => `.templates/${slug}`;
/** Абсолютный путь к файлу шаблона внутри воркспейса. */
const fileOf = (slug: string): string => `${TEMPLATES_DIR}/${slug}${NOTE_EXT}`;

// ─── Публичное API ────────────────────────────────────────────────────────────

/**
 * Возвращает мету всех шаблонов, новые сверху. Каждый читаем через readNote,
 * чтобы достать title и icon из фронтматтера. Чуть дороже, чем смотреть только
 * фронтматтер, зато код крошечный и переиспользует кэш mtime. Для типичных
 * <20 шаблонов быстро.
 */
export async function listTemplates(): Promise<TemplateMeta[]> {
  if (!(await exists(TEMPLATES_DIR, APP_DATA))) return [];
  let entries;
  try {
    entries = await readDir(TEMPLATES_DIR, APP_DATA);
  } catch (e) {
    console.error("listTemplates: readDir failed:", e);
    return [];
  }
  const out: TemplateMeta[] = [];
  await Promise.all(
    entries
      .filter((e) => e.isFile && e.name?.endsWith(NOTE_EXT))
      .map(async (e) => {
        const slug = e.name!.slice(0, -NOTE_EXT.length);
        try {
          const note = await readNote(idOf(slug));
          if (!note) return;
          out.push({
            id: idOf(slug),
            slug,
            name: note.title,
            icon: note.icon,
            updatedAt: note.updatedAt,
          });
        } catch (err) {
          console.error("listTemplates: readNote failed:", slug, err);
        }
      }),
  );
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * Читает один шаблон по id. Тонкая обёртка над readNote: шаблоны на диске это
 * и есть заметки, так что парсинг фронтматтера и BlockNote JSON бесплатны.
 */
export async function readTemplate(id: string): Promise<Template | null> {
  const note = await readNote(id);
  if (!note) return null;
  const slug = id.startsWith(".templates/") ? id.slice(".templates/".length) : id;
  return {
    id,
    slug,
    name: note.title,
    icon: note.icon,
    updatedAt: note.updatedAt,
    content: note.content,
    blocknote: note.blocknote ?? null,
    bnHash: note.bnHash ?? null,
  };
}

export type SaveTemplateInput = {
  /** Если задан, перезаписываем шаблон с этим id (подтверждение через
   *  confirmDialog ожидаем где-то выше по вызову). */
  id?: string;
  name: string;
  icon?: string | null;
  content: string;
  blocknote?: string | null;
  bnHash?: number | null;
};

/**
 * Создаёт или перезаписывает шаблон, возвращает новую мету. Пустое тело писать
 * не даём: пустой шаблон бесполезен и молча перекрыл бы более полный, который
 * юзер потом сохранит под тем же именем. Вызывающий (saveCurrentAsTemplate)
 * пусть покажет это тостом.
 */
export async function saveTemplate(
  input: SaveTemplateInput,
): Promise<TemplateMeta> {
  if (!input.content.trim()) {
    throw new Error("Шаблон не может быть пустым");
  }
  // slug всегда прогоняем через slugifyTemplateName, чтобы переданный id
  // (скажем, из будущего импорта или скрипта) не протащил `..`, `/`, NUL и
  // прочее для обхода путей. Сейчас все вызовы и так шлют готовый slug, это
  // на будущее. todo импорт шаблонов из Obsidian
  const rawSlug = input.id
    ? input.id.startsWith(".templates/")
      ? input.id.slice(".templates/".length)
      : input.id
    : input.name;
  const slug = slugifyTemplateName(rawSlug);
  if (!slug) {
    throw new Error("Не удалось сформировать имя файла шаблона");
  }
  const id = idOf(slug);
  const now = Date.now();
  // Если файл уже есть, оставляем его createdAt, иначе ставим now.
  let createdAt = now;
  try {
    const existing = await readNote(id);
    if (existing) createdAt = existing.createdAt;
  } catch {
    /* файла нет, берём now */
  }
  const note: Note = {
    id,
    title: input.name,
    folder: ".templates",
    createdAt,
    updatedAt: now,
    content: input.content,
    blocknote: input.blocknote ?? null,
    bnHash: input.bnHash ?? null,
    icon: input.icon ?? null,
    cover: null,
    preview: "",
    favorite: false,
    tags: [],
    links: [],
  };
  await writeNote(note);
  return {
    id,
    slug,
    name: input.name,
    icon: input.icon ?? null,
    updatedAt: now,
  };
}

/**
 * Удаляет файл шаблона (без корзины: шаблоны это не контент юзера, а скорее
 * каркас). Дотдир не виден обходчику дерева, рефреш не нужен, вызывающий пусть
 * обновит кэш стора шаблонов.
 */
export async function deleteTemplate(id: string): Promise<void> {
  const slug = id.startsWith(".templates/") ? id.slice(".templates/".length) : id;
  const path = fileOf(slug);
  try {
    if (await exists(path, APP_DATA)) await remove(path, APP_DATA);
  } catch (e) {
    console.error("deleteTemplate failed:", id, e);
    throw e;
  }
}

/**
 * Переименовывает шаблон на месте: slug и файл те же, меняем только title во
 * фронтматтере. Путь на диске не двигается, поэтому версии и ссылки целы.
 */
export async function renameTemplate(
  id: string,
  newName: string,
): Promise<TemplateMeta> {
  const existing = await readTemplate(id);
  if (!existing) throw new Error(`Template ${id} not found`);
  return saveTemplate({
    id,
    name: newName,
    icon: existing.icon,
    content: existing.content,
    blocknote: existing.blocknote,
    bnHash: existing.bnHash,
  });
}

/**
 * true, если файл шаблона с таким слагом уже есть. Нужно сценарию "сохранить
 * как шаблон", чтобы решить, спрашивать ли перезапись.
 */
export async function templateSlugExists(slug: string): Promise<boolean> {
  return exists(fileOf(slug), APP_DATA);
}

// ─── Пресеты ────────────────────────────────────────────────────────

/** Встроенные пресеты, создаются при первом запуске. Имена русские, slug
 *  английские. Тело непустое, чтобы guard в saveTemplate их не отбил. */
type Preset = { slug: string; name: string; body: string };

const PRESETS: Preset[] = [
  {
    slug: "daily",
    name: "Заметка дня",
    body: "## Как прошёл день\n\n## Что сделал\n\n## Благодарность\n\n## Мысли\n",
  },
  {
    slug: "weekly-review",
    name: "Итоги недели",
    body:
      "## Главное за неделю\n\n## Что получилось\n\n## Что не получилось\n\n" +
      "## Уроки\n\n## Фокус на следующую неделю\n- [ ] \n- [ ] \n- [ ] \n",
  },
  {
    slug: "meeting-notes",
    name: "Заметки со встречи",
    body:
      "## Контекст\n**Дата:** \n**Участники:** \n**Тема:** \n\n## Повестка\n- \n\n" +
      "## Обсуждение\n\n## Решения\n- \n\n## Задачи\n- [ ] \n- [ ] \n",
  },
  {
    slug: "project-plan",
    name: "План проекта",
    body:
      "## Цель\n\n## Контекст\n\n## Ключевые результаты\n- [ ] \n- [ ] \n- [ ] \n\n" +
      "## План\n### Этап 1\n- \n\n### Этап 2\n- \n\n## Риски\n- \n\n## Открытые вопросы\n- \n",
  },
];

/**
 * Идемпотентно создаёт недостающие пресеты. Существующие файлы не трогаем,
 * чтобы правленый юзером шаблон не затёрся, а удалённый не возвращался каждый
 * запуск. Ошибки по файлам логируем и идём дальше, звать можно сколько угодно.
 */
export async function seedTemplatesIfEmpty(): Promise<void> {
  for (const preset of PRESETS) {
    const path = fileOf(preset.slug);
    try {
      if (await exists(path, APP_DATA)) continue;
      await saveTemplate({
        id: idOf(preset.slug),
        name: preset.name,
        content: preset.body,
      });
    } catch (e) {
      console.error("seedTemplatesIfEmpty: preset failed:", preset.slug, e);
    }
  }
}
