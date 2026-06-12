// src/editor2026/blocks/callout.tsx
//
// Блок callout / выноска. Вертикальная раскладка: шапка с типом (иконка +
// подпись) и тонким разделителем, ниже редактируемый текст. Тип меняется
// кликом по иконке (циклически) или правой кнопкой (меню выбора типа,
// порталим в <body> для корректного позиционирования). При экспорте
// превращается в blockquote в формате Obsidian/GitHub.

import { createReactBlockSpec } from "@blocknote/react";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../lib/i18n";

export const CALLOUT_VARIANTS = [
  "info",
  "warn",
  "tip",
  "note",
  "success",
] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

const VARIANT_EMOJI: Record<CalloutVariant, string> = {
  info: "ℹ️",
  warn: "⚠️",
  tip: "💡",
  note: "📝",
  success: "✅",
};

const VARIANT_LABEL: Record<CalloutVariant, string> = {
  info: "Инфо",
  warn: "Внимание",
  tip: "Совет",
  note: t("Заметка"),
  success: "Успех",
};

function CalloutView({
  block,
  editor,
  contentRef,
}: {
  block: any;
  editor: any;
  contentRef: (el: HTMLElement | null) => void;
}) {
  const variant = (
    CALLOUT_VARIANTS.includes(block.props.variant) ? block.props.variant : "info"
  ) as CalloutVariant;
  const icon = block.props.emoji || VARIANT_EMOJI[variant];
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const setVariant = (v: CalloutVariant) => {
    editor.updateBlock(block, { type: "callout", props: { variant: v, emoji: "" } });
    setMenu(null);
  };
  const cycle = () => {
    const i = CALLOUT_VARIANTS.indexOf(variant);
    setVariant(CALLOUT_VARIANTS[(i + 1) % CALLOUT_VARIANTS.length]);
  };

  // Закрытие меню типа по клику снаружи / Esc.
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

  return (
    <div
      className={`e26-callout e26-callout--${variant}`}
      data-variant={variant}
      onContextMenu={(e) => {
        e.preventDefault();
        // Ограничиваем, чтобы меню не вылезало за края viewport.
        const MW = 200;
        const MH = 252;
        setMenu({
          x: Math.min(e.clientX, window.innerWidth - MW - 8),
          y: Math.min(e.clientY, window.innerHeight - MH - 8),
        });
      }}
    >
      <div className="e26-callout__head" contentEditable={false}>
        <button
          type="button"
          className="e26-callout__icon"
          onClick={cycle}
          title="Сменить тип (или ПКМ)"
        >
          {icon}
        </button>
        <span className="e26-callout__title">{VARIANT_LABEL[variant]}</span>
      </div>
      <div className="e26-callout__body" ref={contentRef} />

      {menu &&
        createPortal(
          <div
            className="e26-callout__menu"
            style={{ position: "fixed", left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="e26-callout__menutitle">{t("Тип выноски")}</div>
            {CALLOUT_VARIANTS.map((v) => (
              <button
                type="button"
                key={v}
                className={v === variant ? "is-active" : ""}
                onClick={() => setVariant(v)}
              >
                <span className="e26-callout__menuicon">{VARIANT_EMOJI[v]}</span>
                <span className="e26-callout__menulabel">{VARIANT_LABEL[v]}</span>
                {v === variant && <Check size={14} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export const calloutBlock = createReactBlockSpec(
  {
    type: "callout",
    content: "inline",
    propSchema: {
      variant: { default: "info", values: CALLOUT_VARIANTS },
      emoji: { default: "" }, // "" => используется дефолтная иконка варианта
    },
  },
  {
    render: (props) => (
      <CalloutView
        block={props.block}
        editor={props.editor}
        contentRef={props.contentRef}
      />
    ),
    // Деградация до Obsidian/GitHub-совместимого формата при экспорте.
    toExternalHTML: (props) => {
      const variant = props.block.props.variant as CalloutVariant;
      const icon = props.block.props.emoji || VARIANT_EMOJI[variant];
      const label = VARIANT_LABEL[variant] ?? variant;
      return (
        <blockquote data-callout={variant}>
          <p>
            {icon} <strong>{label}</strong>
          </p>
          <p ref={props.contentRef} />
        </blockquote>
      );
    },
    parse: (el) => {
      if (el.tagName === "BLOCKQUOTE" && el.getAttribute("data-callout")) {
        const v = el.getAttribute("data-callout") as CalloutVariant;
        return { variant: CALLOUT_VARIANTS.includes(v) ? v : "info" };
      }
      return undefined;
    },
  },
);
