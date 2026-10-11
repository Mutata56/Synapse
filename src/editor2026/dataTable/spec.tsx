// src/editor2026/dataTable/spec.tsx
//
// BlockNote-спецификация блока dataTable. createReactBlockSpec возвращает
// ФАБРИКУ `(options?) => BlockSpec`, поэтому в схеме регистрируем
// `dataTableBlock()`.

import { createReactBlockSpec } from "@blocknote/react";
import { lazy, Suspense } from "react";
import { ModuleBlockGate } from "../../components/ModuleBlockGate";
import { t } from "../../lib/i18n";
const DataTableView = lazy(() => import("./DataTableView").then(module => ({ default: module.DataTableView })));
import {
  emptyModel,
  modelToHtmlTable,
  parseModel,
  tableElementToModel,
} from "./model";

export const dataTableBlock = createReactBlockSpec(
  {
    type: "dataTable",
    content: "none",
    propSchema: {
      // Вся модель как одна JSON-строка; дефолт -- 2x2 стартовая сетка. NOTE: нет
      // поля `type` -- дефолтное значение уже определяет тип пропа как
      // `string` (ключ `type` здесь -- TS-ошибка по PropSpec union).
      data: { default: JSON.stringify(emptyModel()) },
    },
  },
  {
    // Не атомный: клик ставит текстовый курсор на следующую строку,
    // а не NodeSelection на таблицу (фикс бага caret-after-block).
    meta: { isolating: false, selectable: false },
    render: (props) => (
      <ModuleBlockGate module="database"><Suspense fallback={<div role="status">{t("Загрузка…")}</div>}><DataTableView block={props.block} editor={props.editor} /></Suspense></ModuleBlockGate>
    ),
    // Портативный статический <table> для HTML/markdown-экспорта (потерьный:
    // типы ячеек сворачиваются в текст). Богатая модель сохраняется через
    // безпотерьный blocknote JSON.
    toExternalHTML: (props) => (
      <div
        dangerouslySetInnerHTML={{
          __html: modelToHtmlTable(parseModel(props.block.props.data)),
        }}
      />
    ),
    // Гидратация ранее экспортированного <table> при HTML-импорте (типы -> текст).
    parse: (el) => {
      if (el.tagName !== "TABLE") return undefined;
      const model = tableElementToModel(el);
      if (!model) return undefined;
      return { data: JSON.stringify(model) };
    },
  },
);
