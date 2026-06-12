// src/editor2026/dataTable/model.ts
//
// Чистая модель данных + хелперы для round-trip блока dataTable
// (встроенная база данных). Без зависимостей, безопасный: parseModel никогда
// не бросает (битый/старый JSON деградирует до пустой сетки). Вся модель
// живет в одном JSON-строковом пропе, поэтому без потерь сохраняется
// существующим путем сохранения (JSON.stringify(editor.document) ->
// `blocknote`); markdown-экспорт потерьный (типы ячеек сворачиваются
// в текст), но заметки остаются портативными.

import { t } from "../../lib/i18n";

export type CellType = "text" | "checkbox" | "tag" | "date";

export interface DataColumn {
  id: string;
  name: string;
  type: CellType;
  width: number;
}

// Строка -- плоская запись, ключ -- id колонки. Значения при round-trip:
//   text/tag/date -> строка   (tag = через запятую; date = ISO "YYYY-MM-DD")
//   чекбокс      -> boolean
export interface DataRow {
  id: string;
  cells: Record<string, string | boolean>;
}

export type SortDir = "asc" | "desc";

export interface DataTableModel {
  v: 1;
  columns: DataColumn[];
  rows: DataRow[];
  sortColId: string | null;
  sortDir: SortDir;
}

const MIN_W = 64;
const MAX_W = 720;
const DEFAULT_W = 160;
const CELL_TYPES = ["text", "checkbox", "tag", "date"] as const;

export function rid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export function emptyModel(): DataTableModel {
  const c1 = rid("col");
  const c2 = rid("col");
  return {
    v: 1,
    columns: [
      { id: c1, name: t("Название"), type: "text", width: 240 },
      { id: c2, name: "Готово", type: "checkbox", width: 90 },
    ],
    rows: [
      { id: rid("row"), cells: { [c1]: "", [c2]: false } },
      { id: rid("row"), cells: { [c1]: "", [c2]: false } },
    ],
    sortColId: null,
    sortDir: "asc",
  };
}

export function clampWidth(w: number): number {
  if (!Number.isFinite(w)) return DEFAULT_W;
  return Math.min(MAX_W, Math.max(MIN_W, Math.round(w)));
}

function normalizeCells(
  cells: unknown,
  columns: DataColumn[],
): Record<string, string | boolean> {
  const src = (cells && typeof cells === "object" ? cells : {}) as Record<
    string,
    unknown
  >;
  const out: Record<string, string | boolean> = {};
  for (const col of columns) {
    const v = src[col.id];
    if (col.type === "checkbox") out[col.id] = v === true;
    else out[col.id] = v == null ? "" : String(v);
  }
  return out;
}

/** Безопасный парсинг: никогда не бросает. Битый/старый JSON -> пустая модель. */
export function parseModel(raw: string | undefined | null): DataTableModel {
  if (!raw) return emptyModel();
  try {
    const m = JSON.parse(raw) as Partial<DataTableModel>;
    if (!m || !Array.isArray(m.columns) || !Array.isArray(m.rows)) {
      return emptyModel();
    }
    const columns: DataColumn[] = m.columns.map((c) => ({
      id: String(c?.id ?? rid("col")),
      name: String(c?.name ?? ""),
      type: CELL_TYPES.includes(c?.type as CellType)
        ? (c!.type as CellType)
        : "text",
      width: clampWidth(Number(c?.width)),
    }));
    const colIds = new Set(columns.map((c) => c.id));
    const rows: DataRow[] = m.rows.map((r) => ({
      id: String(r?.id ?? rid("row")),
      cells: normalizeCells(r?.cells, columns),
    }));
    return {
      v: 1,
      columns,
      rows,
      sortColId: m.sortColId && colIds.has(m.sortColId) ? m.sortColId : null,
      sortDir: m.sortDir === "desc" ? "desc" : "asc",
    };
  } catch {
    // todo log при ошибке парсинга, сейчас молча пустая таблица
    return emptyModel();
  }
}

export function sortRows(model: DataTableModel): DataRow[] {
  const { sortColId, sortDir, columns, rows } = model;
  if (!sortColId) return rows;
  const col = columns.find((c) => c.id === sortColId);
  if (!col) return rows;
  const dir = sortDir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => [r, i] as const)
    .sort(([a, ai], [b, bi]) => {
      const cmp = compareCell(a.cells[col.id], b.cells[col.id], col.type);
      return cmp !== 0 ? cmp * dir : ai - bi;
    })
    .map(([r]) => r);
}

function compareCell(
  a: string | boolean | undefined,
  b: string | boolean | undefined,
  type: CellType,
): number {
  if (type === "checkbox") return (a ? 1 : 0) - (b ? 1 : 0);
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  if (type === "date") return sa.localeCompare(sb); // ISO сортируется лексикографически
  return sa.localeCompare(sb, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

// ── сериализация ─────────────────────────────────────────────────────────────

/** Отображаемый текст ячейки (checkbox -> "[x]"/"[ ]", иначе строка как есть). */
export function cellPlain(
  v: string | boolean | undefined,
  type: CellType,
): string {
  if (type === "checkbox") return v === true ? "[x]" : "[ ]";
  return String(v ?? "");
}

function cellToText(v: string | boolean | undefined, type: CellType): string {
  return cellPlain(v, type).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** GFM pipe-таблица (потерьная: типы сворачиваются в текст). Порядок отражает сортировку. */
export function modelToGfm(model: DataTableModel): string {
  const cols = model.columns;
  if (cols.length === 0) return "";
  const header = `| ${cols.map((c) => c.name.replace(/\|/g, "\\|") || " ").join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const ordered = sortRows(model);
  const body = ordered
    .map(
      (r) =>
        `| ${cols.map((c) => cellToText(r.cells[c.id], c.type) || " ").join(" | ")} |`,
    )
    .join("\n");
  return body ? `${header}\n${sep}\n${body}` : `${header}\n${sep}`;
}

/** Экранированный HTML <table> для toExternalHTML (генерирует потерьный markdown-зеркало). */
export function modelToHtmlTable(model: DataTableModel): string {
  const cols = model.columns;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const head = cols.map((c) => `<th>${esc(c.name)}</th>`).join("");
  const rows = sortRows(model)
    .map(
      (r) =>
        `<tr>${cols
          .map((c) => `<td>${esc(cellToText(r.cells[c.id], c.type))}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** Гидратация ранее экспортированного <table> обратно в модель (типы теряются,
 *  все колонки становятся "text"). Возвращает null, если элемент не таблица. */
export function tableElementToModel(table: HTMLElement): DataTableModel | null {
  const headCells = Array.from(table.querySelectorAll("thead th, thead td"));
  const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
  if (headCells.length === 0) return null;
  const m = emptyModel();
  m.columns = headCells.map((th) => ({
    id: rid("col"),
    name: th.textContent?.trim() ?? "",
    type: "text" as const,
    width: DEFAULT_W,
  }));
  m.rows = bodyRows.map((tr) => {
    const cells: Record<string, string | boolean> = {};
    const tds = Array.from(tr.querySelectorAll("td, th"));
    m.columns.forEach((c, i) => {
      cells[c.id] = tds[i]?.textContent?.trim() ?? "";
    });
    return { id: rid("row"), cells };
  });
  m.sortColId = null;
  return m;
}
