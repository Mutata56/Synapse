import { NoteIcon } from "../NoteIcon";
import { memo } from "react";
import { ArrowRight, FileText } from "lucide-react";
import { formatRelativeDate } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { NoteMeta } from "../../lib/storage";

export const OverviewNoteRow = memo(function OverviewNoteRow({ note, onOpen }: { note: NoteMeta; onOpen: (id: string, newTab?: boolean) => void }) {
  return <button type="button" className="overview-note-row" onClick={event => onOpen(note.id, event.metaKey)}>
    <span className="overview-note-icon"><NoteIcon note={note} size={17} fallback={<FileText size={17} />} /></span>
    <span className="overview-note-copy"><span className="overview-note-title">{note.title || t("Без названия")}</span><span className="overview-note-folder">{note.folder || t("Без папки")}</span></span>
    <span className="overview-note-tags">{note.tags.slice(0, 2).map(tag => <span key={tag}>#{tag.replace(/^#/, "")}</span>)}</span>
    <span className="overview-note-date">{formatRelativeDate(note.updatedAt)}</span><ArrowRight size={15} className="overview-row-arrow" />
  </button>;
});
