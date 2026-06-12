/**
 * Стабильные React-ключи для дерева в сайдбаре (FolderTree).
 *
 * Дерево пересобирается с диска, identity берётся из пути, так что
 * переименование или перемещение папки меняет путь у каждого потомка, а ключ
 * React на основе пути менялся бы вместе с ним и перемонтировал всё поддерево.
 * Юзер видит, как папка и её открытые дети исчезают и заново анимируются.
 *
 * Вместо этого маппим каждый путь (путь к папке или id заметки) на постоянный
 * токен и протаскиваем токены через переименования с помощью `rebaseKeys`, так
 * React обновляет существующие строки на месте, а не сносит их.
 */

let counter = 0;
const keyByPath = new Map<string, string>();

/** Возвращает стабильный ключ для пути папки / id заметки, назначая его лениво. */
export function stableKey(path: string): string {
  let key = keyByPath.get(path);
  if (key === undefined) {
    key = `t${++counter}`;
    keyByPath.set(path, key);
  }
  return key;
}

/**
 * Перевешивает ключи, зарегистрированные под `oldPath` (сам путь и все потомки),
 * на `newPath`, сохраняя токен, чтобы соответствующие строки остались
 * смонтированными при переименовании/перемещении. Зови это в том же тике, в
 * котором патчишь дерево.
 */
export function rebaseKeys(oldPath: string, newPath: string): void {
  // Сначала снимок: мы мутируем map прямо во время обхода.
  for (const [path, key] of [...keyByPath]) {
    if (path === oldPath) {
      keyByPath.delete(path);
      keyByPath.set(newPath, key);
    } else if (path.startsWith(`${oldPath}/`)) {
      keyByPath.delete(path);
      keyByPath.set(`${newPath}${path.slice(oldPath.length)}`, key);
    }
  }
}
