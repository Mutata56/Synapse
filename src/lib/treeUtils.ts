/**
 * Чистые in-memory хелперы над формой `TreeNode[]`, которую делает
 * `lib/storage.ts`. Без ФС, без IPC, без React, просто структурные утилиты для
 * Sidebar / FilesView / TrashView / Breadcrumbs / ImagesView, чтобы ходить по
 * закэшированному дереву и смотреть его.
 *
 * NOTE: flattenNotes ещё раз объявлен внутри storage.ts как приватная копия.
 * Дублирование намеренное: иначе storage.ts пришлось бы рантайм-импортить этот
 * файл, а это циклическая зависимость (типы `NoteMeta` / `TreeNode` мы отсюда
 * берём, но type-only импорты стираются и цикла в рантайме не дают).
 */

import type { NoteMeta, TreeNode } from "./storage";

export type FolderNode = Extract<TreeNode, { kind: "folder" }>;
export type NoteNode = Extract<TreeNode, { kind: "note" }>;

/**
 * Рекурсивно разворачивает дерево папок/заметок в плоский список заметок,
 * сохраняя порядок обхода, чтобы сортировка на стороне вызова была стабильной.
 */
export function flattenNotes(tree: TreeNode[]): NoteMeta[] {
  const out: NoteMeta[] = [];
  const walk = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "folder") walk(node.children);
      else out.push(node.note);
    }
  };
  walk(tree);
  return out;
}

/**
 * Резолвит цель wiki-ссылки во ВСЕ заметки с совпадающим заголовком (без учёта
 * регистра, обрезая пробелы). Для пустой цели или без совпадений вернёт `[]`.
 * Больше одной значит заголовок неоднозначный, и плагин `[[...]]` даёт юзеру
 * выбрать нужную, а не молча берёт первую. Резолвим по заголовку, как Obsidian.
 */
export function findNotesByTitle(tree: TreeNode[], title: string): NoteMeta[] {
  const target = title.trim().toLowerCase();
  if (!target) return [];
  return flattenNotes(tree).filter(
    (n) => n.title.trim().toLowerCase() === target,
  );
}

/**
 * Идёт по дереву по пути `path` (через слэш) и возвращает детей этой папки.
 * Если какого-то сегмента нет (например устаревший путь до рефреша), вернёт
 * `null`.
 *
 * Пустой путь это корень, возвращаем `nodes` как есть.
 */
export function findFolderByPath(
  nodes: TreeNode[],
  path: string,
): TreeNode[] | null {
  if (!path) return nodes;
  const parts = path.split("/").filter(Boolean);
  let current = nodes;
  for (const part of parts) {
    const found = current.find(
      (n): n is FolderNode => n.kind === "folder" && n.name === part,
    );
    if (!found) return null;
    current = found.children;
  }
  return current;
}

/**
 * Рекурсивно считает папки и заметки в поддереве. Обход дешёвый, годится для
 * `useMemo` на каждом рендере карточки папки.
 */
export function countContents(nodes: TreeNode[]): {
  folders: number;
  notes: number;
} {
  let folders = 0;
  let notes = 0;
  const walk = (ns: TreeNode[]): void => {
    for (const n of ns) {
      if (n.kind === "folder") {
        folders++;
        walk(n.children);
      } else {
        notes++;
      }
    }
  };
  walk(nodes);
  return { folders, notes };
}

/**
 * Режет путь папки (через слэш) на хлебные крошки. У каждой крошки `name`
 * (сегмент) и `path` (абсолютный путь до этого сегмента включительно).
 *
 *   "work/projects/foo" даёт:
 *     { name: "work",    path: "work" },всего O(D) вместо O(D²), как было бы с `parts
 *     { name: "projects", path: "work/projects" },
 *     { name: "foo",     path: "work/projects/foo" },
 *
 * Через аккумулятор путь каждой крошки строится за O(1) поверх предыдущей,
 * всего O(D) вместо O(D²), как было бы с `parts.slice(0, i + 1).join("/")`
 * на каждую крошку.
 */
export function buildBreadcrumbs(
  path: string,
): { name: string; path: string }[] {
  if (!path) return [];
  const parts = path.split("/").filter(Boolean);
  let cursor = "";
  return parts.map((name) => {
    cursor = cursor ? `${cursor}/${name}` : name;
    return { name, path: cursor };
  });
}
