// src/editor2026/dataTable/spec.tsx
//
// BlockNote-спецификация блока dataTable. createReactBlockSpec возвращает
// ФАБРИКУ `(options?) => BlockSpec`, поэтому в схеме регистрируем
// `dataTableBlock()`.

import { createReactBlockSpec } from "@blocknote/react";
import { DataTableView } from "./DataTableView";
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
      <DataTableView block={props.block} editor={props.editor} />
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
