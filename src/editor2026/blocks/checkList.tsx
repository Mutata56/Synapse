import { defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useState } from "react";
import { NoteStyleMenu, TaskIcon, type MarkerPosition } from "../../components/NoteBlockUI";
import { taskMarker, taskState } from "../../lib/noteBlockTypes";
import { t } from "../../lib/i18n";
const base = defaultBlockSpecs.checkListItem;
function CheckListView({ block, editor, contentRef }: { block: any; editor: any; contentRef: (el: HTMLElement | null) => void }) {
  const marker = taskMarker(block.props), state = taskState(marker);
  const [menu, setMenu] = useState<MarkerPosition | null>(null);
  const choose = (marker: string) => { editor.updateBlock(block, { props: { taskStatus: marker, checked: marker.toLowerCase() === "x" } }); editor.focus(); };
  return <div className={`e26-task-line e26-task--${state.id} note-task--${state.id}`} data-task-status={marker} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); }}>
    <button type="button" contentEditable={false} className="note-task-symbol" role="checkbox" aria-checked={marker === "/" ? "mixed" : marker.toLowerCase() === "x"} aria-label={t("Статус задачи: {status}", { status: t(state.label) })} title={t("ПКМ: выбрать статус задачи")} onClick={() => choose(marker.toLowerCase() === "x" ? " " : "x")}><TaskIcon marker={marker} /></button>
    <p className="e26-task-text" ref={contentRef} />
    <NoteStyleMenu position={menu} kind="task" value={marker} onPick={choose} onClose={() => setMenu(null)} />
  </div>;
}
export const checkListBlock = createReactBlockSpec({ ...base.config, propSchema: { ...base.config.propSchema, taskStatus: { default: "" } } }, {
  meta: base.implementation.meta, runsBefore: base.implementation.runsBefore, parseContent: base.implementation.parseContent,
  parse: el => { const parsed = base.implementation.parse?.(el); return parsed ? { ...parsed, taskStatus: el.getAttribute("data-task-status") ?? "" } : undefined; },
  render: props => <CheckListView {...props} />,
  toExternalHTML: props => <li data-task-status={taskMarker(props.block.props)}><input type="checkbox" checked={props.block.props.checked} readOnly /><p ref={props.contentRef} /></li>,
}, base.extensions);
