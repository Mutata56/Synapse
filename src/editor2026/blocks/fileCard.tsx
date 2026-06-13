// src/editor2026/blocks/fileCard.tsx
//
// Карточка вложенного файла (фаза 2). Рендерит любой прикрепленный файл
// как компактную карточку (бейдж расширения, имя, человекочитаемый размер);
// клик открывает файл в приложении ОС по умолчанию, кнопка справа показывает
// в файловом менеджере. Файлы импортируются через пайплайн ассетов через
// `<input type="file">` (см. ../lib/assets) -- без диалога пути ОС, поэтому
// staging в fs:scope не нужен.

import { createReactBlockSpec } from "@blocknote/react";
import { FolderOpen, Paperclip } from "lucide-react";
import { useRef } from "react";
import {
  humanSize,
  importFile,
  openAssetInOS,
  resolveAssetUrl,
  revealAssetInOS,
  toPortableAssetRef,
} from "../lib/assets";

export const fileCardBlock = createReactBlockSpec(
  {
    type: "fileCard",
    content: "none",
    propSchema: {
      assetUrl: { default: "" },
      assetName: { default: "" },
      name: { default: "" },
      ext: { default: "" },
      size: { default: 0 },
    },
  },
  {
    // Не атомный: клик ставит текстовый курсор на следующую строку,
    // а не NodeSelection на карточку (фикс бага caret-after-block).
    meta: { isolating: false, selectable: false },
    render: (props) => {
      const { assetName, name, ext, size } = props.block.props;
      const inputRef = useRef<HTMLInputElement>(null);

      const attach = async (files: FileList | null) => {
        const f = files?.[0];
        if (!f) return;
        try {
          const a = await importFile(f);
          props.editor.updateBlock(props.block, {
            type: "fileCard",
            props: {
              // Портабельная ссылка, чтобы карточка переехала между ОС с бэкапом.
              // Открытие/показ файла и так идут по assetName (см. ниже).
              assetUrl: toPortableAssetRef(a.url),
              assetName: a.assetName,
              name: a.name,
              ext: a.ext,
              size: a.size,
            },
          });
        } catch (e) {
          console.error("fileCard: import failed:", e);
        }
      };

      if (!assetName) {
        return (
          <div className="e26-filecard e26-filecard--empty" contentEditable={false}>
            <button type="button" onClick={() => inputRef.current?.click()}>
              <Paperclip size={16} /> Прикрепить файл
            </button>
            <input
              ref={inputRef}
              type="file"
              hidden
              onChange={(e) => void attach(e.target.files)}
            />
          </div>
        );
      }

      return (
        <div
          className="e26-filecard"
          contentEditable={false}
          role="button"
          tabIndex={0}
          title="Открыть файл"
          onClick={() => void openAssetInOS(assetName)}
        >
          <span className="e26-filecard__badge">
            {(ext || "?").toUpperCase().slice(0, 4)}
          </span>
          <span className="e26-filecard__meta">
            <span className="e26-filecard__name">{name || assetName}</span>
            {humanSize(size) && (
              <span className="e26-filecard__size">{humanSize(size)}</span>
            )}
          </span>
          <button
            type="button"
            className="e26-filecard__reveal"
            title="Показать в папке"
            onClick={(e) => {
              e.stopPropagation();
              void revealAssetInOS(assetName);
            }}
          >
            <FolderOpen size={14} />
          </button>
        </div>
      );
    },

    // Экспорт деградирует до ссылки. На диске assetUrl портабельный, поэтому
    // для рабочей ссылки разворачиваем его под текущую машину.
    toExternalHTML: (props) => {
      const { assetUrl, name } = props.block.props;
      return (
        <p>
          <a href={resolveAssetUrl(assetUrl) || "#"}>{name || "Файл"}</a>
        </p>
      );
    },
    // Нет надежной цели для повторного импорта из голой ссылки.
    parse: () => undefined,
  },
);
