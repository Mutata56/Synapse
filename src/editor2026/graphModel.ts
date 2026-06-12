// src/editor2026/graphModel.ts
//
// Чистая модель графа для wiki-link связей между заметками. Без React,
// без SVG, без жесткой политики усечения, универсальная и переиспользуемая
// откуда угодно (текущий SVG LocalGraph, будущий WebGL-рендерер, тесты, скрипты).
//
// ИСТОЧНИК РЕБЕР: модуль получает ребра ИСКЛЮЧИТЕЛЬНО из `NoteMeta.links` -
// lowercase `[[...]]` цели, производимые `extractLinks` (storage.ts) при
// каждом сохранении. Это единый источник правды, общий с popup ссылок
// редактора, панелью Backlinks и SVG-графом.
//
// Вынесено из src/components/LocalGraph.tsx (buildAdjacency + neighbourhood)
// в отдельный модуль чтобы:
//   - Backlinks / LocalGraph / будущий WebGL local-graph делили одну
//     реализацию (без поведенческого дрейфа).
//   - `degree` теперь прикреплен к каждому узлу (WebGL рендереры используют
//     для размера хабов, SVG-версия не нуждалась).
//   - `maxNodes` стал ОПЦИЕЙ вместо жесткой константы. SVG держит 40,
//     WebGL может передать гораздо больше.

import type { NoteMeta } from "../lib/storage";

/** Узел в локальном графе: заметка + расстояние по BFS от центра. */
export type GraphNode = {
  id: string;
  title: string;
  /** 0 = центр, 1 = прямой сосед, 2 = сосед соседа, ... */
  level: number;
  /** Полная степень смежности в ПОЛНОМ графе, WebGL рендереры используют
   *  для размера хабов. SVG-рендерер игнорирует. */
  degree: number;
  /** Полная мета, чтобы рендереры могли достать icon/folder/preview/mood
   *  без дополнительного запроса. */
  note: NoteMeta;
};

/** Неориентированное ребро между двумя id заметок. Порядок НЕ гарантирован
 *  (`a < b` не проверяется); дедупликация выполняется строителем, поэтому
 *  рендерер может рисовать каждое ребро однократно. */
export type GraphEdge = { a: string; b: string };

export type LocalGraphData = {
  /** id заметки вокруг которой построено окружение (null для пустого графа). */
  center: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export const EMPTY_GRAPH: LocalGraphData = {
  center: null,
  nodes: [],
  edges: [],
};

/**
 * Неориентированная смежность заметка<->заметка из wiki-ссылок (исходящие +
 * входящие), резолвится по заголовку. Вынесено из LocalGraph.tsx, SVG и WebGL
 * рендереры + Backlinks видят одну связность.
 *
 * Коллизии заголовков (две заметки с одинаковым заголовком) раздают ребро
 * КАЖДОМУ совпавшему id, что совпадает с `findNotesByTitle` используемым
 * в других местах.
 */
export function buildAdjacency(notes: NoteMeta[]): Map<string, Set<string>> {
  // заголовок (lowercase) -> список id заметок с этим заголовком
  const byTitle = new Map<string, string[]>();
  for (const n of notes) {
    const t = n.title.trim().toLowerCase();
    if (!t) continue;
    const list = byTitle.get(t);
    if (list) list.push(n.id);
    else byTitle.set(t, [n.id]);
  }
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return; // self-link, игнорируем
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const n of notes) {
    for (const title of n.links) {
      const targets = byTitle.get(title);
      if (targets) for (const id of targets) link(n.id, id);
    }
  }
  return adj;
}

export type NeighbourhoodOptions = {
  /** Жесткий лимит на количество узлов. По умолчанию 40, чтобы хабы
   *  не превращались в кашу при компактном размере. WebGL может передать
   *  тысячи, GPU нарисует все. */
  maxNodes?: number;
  /** Готовая смежность. Передавайте когда она уже есть (например,
   *  в useMemo вызывающего), чтобы пропустить rebuild. */
  adjacency?: Map<string, Set<string>>;
};

/**
 * BFS окружения `centerId` до `depth` хопов, возвращает reachable
 * подграф (узлы + попарные ребра). Универсализован из LocalGraph.tsx,
 * поведение идентично для SVG (maxNodes=40) и готово к WebGL через
 * `maxNodes` + поле `degree`.
 *
 * Защитный: неизвестный `centerId` (заметка удалена/не существовала)
 * возвращает `EMPTY_GRAPH`, никогда не бросает, поэтому вызывающий
 * может передать id от пользователя без try/catch.
 */
export function buildLocalGraph(
  notes: NoteMeta[],
  centerId: string | null,
  depth: number,
  opts: NeighbourhoodOptions = {},
): LocalGraphData {
  if (!centerId) return EMPTY_GRAPH;
  const maxNodes = opts.maxNodes ?? 40;
  // `new Map(notes.map(...))` при tsconfig strict может расшириться до
  // Map<string|NoteMeta, ...>, указываем generic явно.
  const byId = new Map<string, NoteMeta>(notes.map((n) => [n.id, n]));
  const center = byId.get(centerId);
  if (!center) return EMPTY_GRAPH;
  const adj = opts.adjacency ?? buildAdjacency(notes);

  // BFS, `level` одновременно служит множеством "посещенных" и счетчиком хопов.
  const level = new Map<string, number>([[centerId, 0]]);
  let frontier = [centerId];
  for (let h = 1; h <= depth && level.size < maxNodes; h++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (level.has(nb)) continue;
        if (level.size >= maxNodes) break;
        level.set(nb, h);
        next.push(nb);
      }
    }
    frontier = next;
  }

  const present = new Set(level.keys());
  const nodes: GraphNode[] = [];
  for (const [id, lv] of level) {
    const note = byId.get(id);
    if (!note) continue; // не может произойти (мы уже читали из byId), но type-safe
    nodes.push({
      id,
      title: note.title,
      level: lv,
      degree: adj.get(id)?.size ?? 0,
      note,
    });
  }

  // Ребра ТОЛЬКО между присутствующими узлами, дедупликация стабильной
  // строкой, чтобы каждая пара рисовалась однократно. Ключ использует
  // лексикографический порядок id, данные ребра этого порядка не несут.
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const id of present) {
    for (const nb of adj.get(id) ?? []) {
      if (!present.has(nb)) continue;
      const key = id < nb ? `${id} ${nb}` : `${nb} ${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a: id, b: nb });
    }
  }
  return { center: centerId, nodes, edges };
}
