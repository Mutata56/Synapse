/**
 * Собирает граф Graphology из закэшированного дерева заметок для графового вида.
 *
 * Узлы: папки и заметки. Рёбра:
 *  - "contains": папка и её дочерние заметки/подпапки (структура)
 *  - "link":     заметка на заметку, разбираем из `[[wiki-links]]` по заголовку
 *
 * Теги намеренно НЕ делаем узлами графа: фильтрация по тегу живёт в отдельной
 * панели (читает `note.tags` напрямую).
 *
 * Чистая функция (без IPC и React): всё берём из уже загруженного дерева, так
 * что граф пересобирается дёшево при каждом изменении `tree`. Ключи узлов
 * префиксуем по типу (`f:`/`n:`), чтобы папка и заметка с одинаковым именем не
 * столкнулись.
 */

import Graph from "graphology";
import { DEFAULT_NOTE_TITLE } from "./format";
import type { TreeNode } from "./storage";
import { flattenNotes } from "./treeUtils";

export type GraphNodeKind = "folder" | "note";
export type GraphEdgeKind = "contains" | "link";

const folderKey = (path: string): string => `f:${path}`;
const noteKey = (id: string): string => `n:${id}`;

export function buildGraph(tree: TreeNode[]): Graph {
  const graph = new Graph({ type: "undirected" });

  // Заголовок в нижнем регистре даёт ключ заметки, нужно для разбора [[links]]
  // (побеждает первое совпадение, как в wiki-link плагине).
  const titleToKey = new Map<string, string>();
  for (const note of flattenNotes(tree)) {
    const t = note.title.trim().toLowerCase();
    if (t && !titleToKey.has(t)) titleToKey.set(t, noteKey(note.id));
  }

  const walk = (nodes: TreeNode[], parentKey: string | null): void => {
    for (const node of nodes) {
      if (node.kind === "folder") {
        const key = folderKey(node.path);
        graph.mergeNode(key, {
          kind: "folder",
          label: node.name,
          group: node.path, // полный путь папки; кластер GraphView выводит сам
        });
        if (parentKey) graph.mergeEdge(parentKey, key, { kind: "contains" });
        walk(node.children, key);
      } else {
        const { note } = node;
        const key = noteKey(note.id);
        graph.mergeNode(key, {
          kind: "note",
          label: note.title || DEFAULT_NOTE_TITLE,
          group: note.folder, // полный путь папки; кластер GraphView выводит сам
        });
        if (parentKey) graph.mergeEdge(parentKey, key, { kind: "contains" });

        for (const target of note.links) {
          const toKey = titleToKey.get(target);
          if (toKey && toKey !== key) {
            graph.mergeEdge(key, toKey, { kind: "link" });
          }
        }
      }
    }
  };
  walk(tree, null);

  return graph;
}
