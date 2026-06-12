// src/editor2026/useLocalGraph.ts
//
// Типизированный хук, возвращающий wiki-link окружение заметки как
// `{ center, nodes, edges }` - стабильный, мемоизированный объект для
// любого рендерера (SVG, Canvas2D, WebGL). Синхронный, обходит только
// кэшированное дерево заметок, без дисковых чтений.
//
// Два useMemo, чтобы смежность и BFS-слайс кэшировались независимо -
// переключение глубины перезапускает ТОЛЬКО BFS, а не полный O(N+E) rebuild.
// Важно когда дерево вырастает.

import { useMemo } from "react";
import { useNotesStore } from "../store/notes";
import { flattenNotes } from "../lib/treeUtils";
import {
  buildAdjacency,
  buildLocalGraph,
  EMPTY_GRAPH,
  type LocalGraphData,
} from "./graphModel";

export type UseLocalGraphOptions = {
  /** Жесткий лимит на количество узлов. По умолчанию 40 для SVG, WebGL может передать больше. */
  maxNodes?: number;
};

/**
 * Локальный граф с центром `noteId`, глубина `depth` хопов.
 *
 * Возвращает `EMPTY_GRAPH` (сентинел, стабильная ссылка) когда `noteId` null
 * или указывает на несуществующую заметку, никогда не бросает, поэтому
 * вызывающий может передать id от пользователя без try/catch.
 */
export function useLocalGraph(
  noteId: string | null,
  depth: number,
  opts: UseLocalGraphOptions = {},
): LocalGraphData {
  const tree = useNotesStore((s) => s.tree);
  const { maxNodes } = opts;
  const notes = useMemo(() => flattenNotes(tree), [tree]);
  // Смежность это тяжелая часть (O(N+E) обход ссылок каждой заметки).
  // Кэшируем только по `notes`, чтобы смена глубины/центра/maxNodes
  // перезапускала только дешевый BFS.
  const adj = useMemo(() => buildAdjacency(notes), [notes]);
  return useMemo(
    () =>
      noteId
        ? buildLocalGraph(notes, noteId, depth, { maxNodes, adjacency: adj })
        : EMPTY_GRAPH,
    [notes, adj, noteId, depth, maxNodes],
  );
}
