// src/editor2026/dataTable/DataTableView.tsx
//
// Интерактивная сетка для блока dataTable. Рендерится как CSS-grid из <div>
// намеренно НЕ <table>: настоящий <table> в live DOM заставляет встроенный
// расширение TableHandles BlockNote цепляться за него на каждом mousemove и
// кидать "Cannot read properties of undefined (reading 'rows')". Div-grid
// это полностью обходит (экспорт всё равно генерирует настоящий <table>
// через toExternalHTML, который не попадает в live DOM).
//
// content:"none" + contentEditable=false -> сетка сама управляет
// клавиатурой/фокусом.

import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckSquare,
  ChevronsUpDown,
  MoreHorizontal,
  Plus,
  Tag,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CellType, DataColumn, DataRow, DataTableModel } from "./model";
import { parseModel, rid, sortRows } from "./model";
import { t } from "../../lib/i18n";

const TYPE_META: Record<CellType, { icon: ReactNode; label: string }> = {
  text: { icon: <Type size={13} />, label: "Текст" },
  checkbox: { icon: <CheckSquare size={13} />, label: "Чекбокс" },
  tag: { icon: <Tag size={13} />, label: t("Тег") },
  date: { icon: <Calendar size={13} />, label: "Дата" },
};
const TYPE_ORDER: CellType[] = ["text", "checkbox", "tag", "date"];

export function DataTableView({ block, editor }: { block: any; editor: any }) {
  const model = parseModel(block.props.data);
  const orderedRows = sortRows(model);
  const [menu, setMenu] = useState<{ colId: string; x: number; y: number } | null>(
    null,
  );
  const [drag, setDrag] = useState<{ colId: string; startX: number; startW: number; w: number } | null>(null);

  const commit = (next: DataTableModel) =>
    editor.updateBlock(block, {
      type: "dataTable",
      props: { data: JSON.stringify(next) },
    });

  const setCell = (rowId: string, colId: string, value: string | boolean) =>
    commit({
      ...model,
      rows: model.rows.map((r) =>
        r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: value } } : r,
      ),
    });

  const addRow = () => {
    const cells: Record<string, string | boolean> = {};
    for (const c of model.columns) cells[c.id] = c.type === "checkbox" ? false : "";
    commit({ ...model, rows: [...model.rows, { id: rid("row"), cells }] });
  };
  const deleteRow = (rowId: string) =>
    commit({ ...model, rows: model.rows.filter((r) => r.id !== rowId) });

  const addColumn = () => {
    const col: DataColumn = { id: rid("col"), name: "Колонка", type: "text", width: 180 };
    commit({
      ...model,
      columns: [...model.columns, col],
      rows: model.rows.map((r) => ({ ...r, cells: { ...r.cells, [col.id]: "" } })),
    });
  };
  const deleteColumn = (colId: string) =>
    commit({
      ...model,
      columns: model.columns.filter((c) => c.id !== colId),
      sortColId: model.sortColId === colId ? null : model.sortColId,
      rows: model.rows.map((r) => {
        const { [colId]: _drop, ...rest } = r.cells;
        return { ...r, cells: rest };
      }),
    });
  const renameColumn = (colId: string, name: string) =>
    commit({
      ...model,
      columns: model.columns.map((c) => (c.id === colId ? { ...c, name } : c)),
    });
  const retypeColumn = (colId: string, type: CellType) =>
    commit({
      ...model,
      columns: model.columns.map((c) => (c.id === colId ? { ...c, type } : c)),
      rows: model.rows.map((r) => ({
        ...r,
        cells: {
          ...r.cells,
          [colId]:
            type === "checkbox"
              ? r.cells[colId] === true
              : String(r.cells[colId] ?? ""),
        },
      })),
    });

  const setSort = (colId: string | null, dir: "asc" | "desc") => {
    const reordered = sortRows({ ...model, sortColId: colId, sortDir: dir });
    commit({ ...model, rows: reordered, sortColId: colId, sortDir: dir });
  };
  const toggleSort = (colId: string) => {
    if (model.sortColId !== colId) setSort(colId, "asc");
    else if (model.sortDir === "asc") setSort(colId, "desc");
    else setSort(null, "asc");
  };

  // ресайз: превью локально, коммит один раз на pointer-up
  const onResizeDown = (e: React.PointerEvent, col: DataColumn) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ colId: col.id, startX: e.clientX, startW: col.width, w: col.width });
  };
  const onResizeMove = (e: React.PointerEvent) =>
    setDrag((d) =>
      d ? { ...d, w: Math.min(720, Math.max(80, d.startW + (e.clientX - d.startX))) } : d,
    );
  const onResizeUp = () => {
    if (drag)
      commit({
        ...model,
        columns: model.columns.map((c) =>
          c.id === drag.colId ? { ...c, width: drag.w } : c,
        ),
      });
    setDrag(null);
  };
  const widthOf = (col: DataColumn) =>
    drag && drag.colId === col.id ? drag.w : col.width;

  // закрытие меню колонки по клику снаружи / Esc
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent, colId: string) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ colId, x: r.right - 200, y: r.bottom + 6 });
  };

  const gridTemplateColumns =
    model.columns.map((c) => `${widthOf(c)}px`).join(" ") + " 40px";
  const menuCol = menu ? model.columns.find((c) => c.id === menu.colId) : undefined;

  return (
    <div className="e26-db" contentEditable={false}>
      <div className="e26-db__scroll">
        <div className="e26-db__grid" style={{ gridTemplateColumns }}>
          {/* заголовки */}
          {model.columns.map((col) => (
            <div className="e26-db__h" key={`h:${col.id}`}>
              <span className="e26-db__htype" title={TYPE_META[col.type].label}>
                {TYPE_META[col.type].icon}
              </span>
              <CellText
                className="e26-db__hname"
                value={col.name}
                placeholder="Колонка"
                onCommit={(v) => renameColumn(col.id, v)}
              />
              <button
                type="button"
                className="e26-db__hbtn"
                onClick={() => toggleSort(col.id)}
                title="Сортировка"
              >
                {model.sortColId === col.id ? (
                  model.sortDir === "asc" ? (
                    <ArrowUp size={13} />
                  ) : (
                    <ArrowDown size={13} />
                  )
                ) : (
                  <ChevronsUpDown size={13} />
                )}
              </button>
              <button
                type="button"
                className="e26-db__hbtn"
                onClick={(e) => openMenu(e, col.id)}
                title={t("Настройки колонки")}
              >
                <MoreHorizontal size={14} />
              </button>
              <span
                className="e26-db__resize"
                onPointerDown={(e) => onResizeDown(e, col)}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeUp}
              />
            </div>
          ))}
          <div className="e26-db__hadd" key="h:add">
            <button type="button" onClick={addColumn} title="Добавить колонку">
              <Plus size={15} />
            </button>
          </div>

          {/* строки */}
          {orderedRows.flatMap((row) => [
            ...model.columns.map((col) => (
              <div className="e26-db__cell" key={`${row.id}:${col.id}`}>
                <Cell col={col} row={row} onSetCell={setCell} />
              </div>
            )),
            <div className="e26-db__rowact" key={`${row.id}:act`}>
              <button
                type="button"
                onClick={() => deleteRow(row.id)}
                title={t("Удалить строку")}
              >
                <X size={13} />
              </button>
            </div>,
          ])}
        </div>
      </div>

      <button type="button" className="e26-db__addrow" onClick={addRow}>
        <Plus size={14} /> Строка
      </button>

      {menu &&
        menuCol &&
        createPortal(
          <div
            className="e26-db__menu"
            style={{ position: "fixed", left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button type="button" onClick={() => { setSort(menu.colId, "asc"); setMenu(null); }}>
              <ArrowUp size={14} /> По возрастанию
            </button>
            <button type="button" onClick={() => { setSort(menu.colId, "desc"); setMenu(null); }}>
              <ArrowDown size={14} /> По убыванию
            </button>
            <div className="e26-db__menusep" />
            <div className="e26-db__menulabel">{t("Тип ячейки")}</div>
            {TYPE_ORDER.map((t) => (
              <button
                type="button"
                key={t}
                className={menuCol.type === t ? "is-active" : ""}
                onClick={() => { retypeColumn(menu.colId, t); setMenu(null); }}
              >
                {TYPE_META[t].icon} {TYPE_META[t].label}
              </button>
            ))}
            <div className="e26-db__menusep" />
            <button
              type="button"
              className="e26-db__menudanger"
              onClick={() => { deleteColumn(menu.colId); setMenu(null); }}
              disabled={model.columns.length <= 1}
            >
              <Trash2 size={14} /> Удалить колонку
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ── управляемый текстовый инпут: локальный драфт, ресинк при внешнем
//    изменении, коммит на blur/Enter (без записи в документ на каждый
//    символ) ──────────────────────────────────────────────────────────────────
function CellText({
  value,
  onCommit,
  className = "e26-db__cellinput",
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <input
      className={className}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function TagCell({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const tags = value.split(",").map((s) => s.trim()).filter(Boolean);
  const [draft, setDraft] = useState("");
  const setTags = (arr: string[]) => onCommit(arr.join(","));
  const add = () => {
    const t = draft.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setDraft("");
  };
  return (
    <div className="e26-db__tags">
      {tags.map((t, i) => (
        <span className="e26-db__chip" key={`${t}:${i}`}>
          {t}
          <button
            type="button"
            onClick={() => setTags(tags.filter((_, j) => j !== i))}
            title="Убрать"
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="e26-db__taginput"
        value={draft}
        placeholder={tags.length ? "" : "тег…"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && draft === "" && tags.length) {
            setTags(tags.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

function Cell({
  col,
  row,
  onSetCell,
}: {
  col: DataColumn;
  row: DataRow;
  onSetCell: (rowId: string, colId: string, v: string | boolean) => void;
}) {
  const v = row.cells[col.id];
  switch (col.type) {
    case "checkbox":
      return (
        <label className="e26-db__checkwrap">
          <input
            type="checkbox"
            className="e26-db__check"
            checked={v === true}
            onChange={(e) => onSetCell(row.id, col.id, e.target.checked)}
          />
        </label>
      );
    case "date":
      return (
        <input
          type="date"
          className="e26-db__date"
          value={typeof v === "string" ? v : ""}
          onChange={(e) => onSetCell(row.id, col.id, e.target.value)}
        />
      );
    case "tag":
      return (
        <TagCell
          value={typeof v === "string" ? v : ""}
          onCommit={(val) => onSetCell(row.id, col.id, val)}
        />
      );
    default:
      return (
        <CellText
          value={typeof v === "string" ? v : ""}
          onCommit={(val) => onSetCell(row.id, col.id, val)}
        />
      );
  }
}
