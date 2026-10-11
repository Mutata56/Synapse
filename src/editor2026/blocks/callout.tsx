import { createReactBlockSpec } from "@blocknote/react";
import { useState } from "react";
import { CALLOUT_LABELS, CALLOUT_TYPES, calloutType } from "../../lib/noteBlockTypes";
import { t } from "../../lib/i18n";
import { CalloutIcon, NoteStyleMenu, type MarkerPosition } from "../../components/NoteBlockUI";
export const CALLOUT_VARIANTS = CALLOUT_TYPES;
export type CalloutVariant = typeof CALLOUT_TYPES[number];
function CalloutView({ block, editor, contentRef }: { block: any; editor: any; contentRef: (el: HTMLElement | null) => void }) {
  const variant = calloutType(block.props.variant);
  const [menu, setMenu] = useState<MarkerPosition | null>(null);
  const choose = (value: string) => { editor.updateBlock(block, { props: { variant: value, calloutType: "", emoji: "" } }); editor.focus(); };
  return <div className={`e26-callout note-callout note-callout--${variant}`} data-variant={variant} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); }}>
    <div className="e26-callout__head note-callout-head" contentEditable={false}>
      <button type="button" className="e26-callout__icon" title={t("Выбрать тип выноски")} aria-label={t("Выбрать тип выноски")} aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 5 }); }}>
        {block.props.emoji || <CalloutIcon kind={variant} />}
      </button>
      <input className="e26-callout__title-input" aria-label={t("Заголовок выноски")} placeholder={t(CALLOUT_LABELS[variant])} value={block.props.title ?? ""} onChange={event => editor.updateBlock(block, { props: { title: event.target.value } })} />
    </div>
    <div className="e26-callout__body" ref={contentRef} />
    <NoteStyleMenu position={menu} kind="callout" value={variant} onPick={choose} onClose={() => setMenu(null)} />
  </div>;
}
export const calloutBlock = createReactBlockSpec({
  type: "callout", content: "inline",
  propSchema: { variant: { default: "info", values: [...CALLOUT_TYPES, "warn"] as const }, calloutType: { default: "" }, title: { default: "" }, fold: { default: "none", values: ["none", "open", "closed"] as const }, emoji: { default: "" } },
}, {
  render: props => <CalloutView {...props} />,
  toExternalHTML: props => <blockquote data-callout={props.block.props.calloutType || props.block.props.variant}><p>{`[!${props.block.props.calloutType || props.block.props.variant}]${props.block.props.fold === "open" ? "+" : props.block.props.fold === "closed" ? "-" : ""} ${props.block.props.title}`.trimEnd()}</p><p ref={props.contentRef} /></blockquote>,
  parse: el => { const kind = el.getAttribute("data-callout"); return el.tagName === "BLOCKQUOTE" && kind ? { variant: calloutType(kind), calloutType: kind } : undefined; },
});
