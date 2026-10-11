import { Check, ChevronDown, MoreHorizontal, Repeat, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { t } from "../../lib/i18n";
import { isTaskDoneOn, isValidDay, normalizeTags, type RecurrenceFreq, type Task } from "../../lib/tasks";
import { type TaskPatch } from "../../store/tasks";

export function CalendarTaskRow({ task, day, onToggle, onUpdate, onRemove }: { task: Task; day: string; onToggle: (task: Task, day: string) => Promise<void>; onUpdate: (id: string, patch: TaskPatch) => Promise<void>; onRemove: (task: Task) => Promise<void> }) {
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [draft, setDraft] = useState(() => task), [tags, setTags] = useState((task.tags ?? []).join(", "));
  const trigger = useRef<HTMLButtonElement>(null);
  const done = isTaskDoneOn(task, day);
  const open = () => { setDraft(task); setTags((task.tags ?? []).join(", ")); setError(""); setEditing(true); };
  const close = () => { setEditing(false); trigger.current?.focus(); };
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); return true; }
    catch (failure) { setError(t("Не удалось сохранить задачу") + ": " + String(failure)); return false; }
    finally { setBusy(false); }
  };
  return <div className={`calendar-task${done ? " is-done" : ""}${editing ? " is-editing" : ""}`}>
    <div className="calendar-task-main">
      <button type="button" role="checkbox" aria-checked={done} aria-label={t("Выполнить: {title}", { title: task.title })} className="calendar-task-check" disabled={busy} onClick={() => void perform(() => onToggle(task, day))}><Check size={13} aria-hidden="true" /></button>
      <button ref={trigger} type="button" className="calendar-task-title" onClick={open} aria-label={t("Изменить задачу: {title}", { title: task.title })}><span>{task.title}</span><span className="calendar-task-context">{task.time ?? t("Весь день")}{task.repeat ? <Repeat size={12} aria-label={t("Повторяющаяся задача")} /> : null}{task.color ? <i className="calendar-task-color" style={{ background: task.color }} aria-label={t("Цвет задачи")} /> : null}</span></button>
      <button type="button" className="calendar-icon-button" aria-expanded={editing} aria-label={t("Настроить задачу: {title}", { title: task.title })} onClick={() => editing ? close() : open()}><MoreHorizontal size={16} aria-hidden="true" /></button>
    </div>
    {task.tags?.length ? <div className="calendar-task-tags">{task.tags.slice(0, 3).map(tag => <span key={tag}>#{tag}</span>)}{task.tags.length > 3 ? <span>+{task.tags.length - 3}</span> : null}</div> : null}
    {editing ? <form className="calendar-task-editor" aria-label={t("Правка задачи")} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }} onSubmit={async event => { event.preventDefault(); if (!draft.title.trim() || !isValidDay(draft.day)) return; const saved = await perform(() => onUpdate(task.id, { title: draft.title, day: draft.day, time: draft.time || null, repeat: draft.repeat, color: draft.color, tags: normalizeTags(tags.split(",")) })); if (saved) close(); }}>
      <label>{t("Название")}<input autoFocus required maxLength={500} value={draft.title} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} /></label>
      <div className="calendar-form-pair"><label>{t("Дата")}<input type="date" required onInput={event => { const day = event.currentTarget.value; setDraft(value => ({ ...value, day })); }} value={draft.day} onChange={event => setDraft(value => ({ ...value, day: event.target.value }))} /></label><label>{t("Время")}<input type="time" aria-label={t("Время")} onInput={event => { const time = event.currentTarget.value; setDraft(value => ({ ...value, time: time || null })); }} value={draft.time ?? ""} onChange={event => setDraft(value => ({ ...value, time: event.target.value || null }))} /></label></div>
      <label>{t("Повтор")}<span className="calendar-select"><select aria-label={t("Повтор")} value={draft.repeat?.freq ?? "none"} onChange={event => setDraft(value => ({ ...value, repeat: event.target.value === "none" ? null : { freq: event.target.value as RecurrenceFreq, every: value.repeat?.every ?? 1, until: value.repeat?.until } }))}><option value="none">{t("Не повторять")}</option><option value="daily">{t("Каждый день")}</option><option value="weekly">{t("Каждую неделю")}</option><option value="monthly">{t("Каждый месяц")}</option></select><ChevronDown size={13} aria-hidden="true" /></span></label>
      {draft.repeat ? <div className="calendar-form-pair"><label>{t("Интервал")}<input type="number" min={1} max={99} required value={draft.repeat.every} onChange={event => { const every = Number(event.target.value); setDraft(value => ({ ...value, repeat: { ...value.repeat!, every } })); }} /></label><label>{t("Повторять до")}<input type="date" min={draft.day} value={draft.repeat.until ?? ""} onChange={event => setDraft(value => ({ ...value, repeat: { ...value.repeat!, until: event.target.value || null } }))} /></label></div> : null}
      <div className="calendar-form-pair"><label>{t("Метки через запятую")}<input value={tags} maxLength={500} onChange={event => setTags(event.target.value)} /></label><label className="calendar-color-field">{t("Цвет")}<span><input type="color" aria-label={t("Цвет")} value={draft.color ?? "#e0af64"} onChange={event => setDraft(value => ({ ...value, color: event.target.value }))} /><button type="button" className="calendar-icon-button" aria-label={t("Сбросить цвет")} onClick={() => setDraft(value => ({ ...value, color: null }))}><X size={13} aria-hidden="true" /></button></span></label></div>
      <div className="calendar-form-actions"><button type="button" className="calendar-icon-button calendar-danger" disabled={busy} aria-label={t("Удалить задачу")} onClick={() => void perform(() => onRemove(task))}><Trash2 size={15} aria-hidden="true" /></button><button type="button" className="calendar-button" onClick={close}>{t("Отмена")}</button><button type="submit" className="calendar-button is-primary" disabled={busy}>{busy ? t("Сохранение…") : t("Сохранить")}</button></div>
    </form> : null}
    {error ? <p className="calendar-inline-error" role="alert">{error}</p> : null}
  </div>;
}
