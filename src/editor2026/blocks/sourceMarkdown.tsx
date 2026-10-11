import { createReactBlockSpec } from "@blocknote/react";
import { FileCode2, Check } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { VaultMarkdown } from "../../components/VaultMarkdown";

function SourceMarkdownView({ block, editor }: { block: any; editor: any }) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const markdown = String(block.props.markdown);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${input.current.scrollHeight}px`;
  }, [editing, markdown]);
  return <div className="source-markdown-block" contentEditable={false}>
    <button type="button" className="source-markdown-toggle" aria-pressed={editing} onClick={() => setEditing(!editing)}>
      {editing ? <Check size={14} /> : <FileCode2 size={14} />}{editing ? "Готово" : "Изменить Markdown"}
    </button>
    {editing ? <textarea ref={input} autoFocus className="source-markdown-text" aria-label="Markdown этого блока" value={markdown} spellCheck={false}
      onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") setEditing(false); }}
      onChange={event => editor.updateBlock(block, { props: { markdown: event.target.value } })} />
      : <div className="md-content"><VaultMarkdown source={markdown} /></div>}
  </div>;
}
export const sourceMarkdownBlock = createReactBlockSpec({ type: "sourceMarkdown", content: "none", propSchema: { markdown: { default: "" } } }, {
  render: props => <SourceMarkdownView block={props.block} editor={props.editor} />,
  toExternalHTML: props => <pre>{props.block.props.markdown}</pre>,
});
