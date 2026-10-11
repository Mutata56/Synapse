import { AlertCircle, AlertTriangle, ArrowRight, Bug, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardList, FileText, Info, Lightbulb, ListChecks, Quote, Square, Star, X, type LucideIcon } from "lucide-react";
import { Children, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CALLOUT_LABELS, CALLOUT_TYPES, TASK_STATES, calloutType, taskState } from "../lib/noteBlockTypes";
import { t } from "../lib/i18n";
import "./noteBlocks.css";

const CALLOUT_ICONS: Record<string, LucideIcon> = { note: FileText, abstract: ClipboardList, info: Info, todo: ListChecks, tip: Lightbulb, success: Check, question: CircleHelp, warning: AlertTriangle, failure: X, danger: AlertCircle, bug: Bug, example: ListChecks, quote: Quote };
const TASK_ICONS: Record<string, LucideIcon> = { todo: Square, done: Check, progress: ChevronRight, cancelled: X, important: AlertCircle, question: CircleHelp, star: Star, forwarded: ArrowRight, scheduled: CalendarDays, custom: CircleHelp };
export const calloutIcon = (kind: string) => CALLOUT_ICONS[calloutType(kind)];
export function CalloutIcon({ kind }: { kind: string }) { const Icon = calloutIcon(kind); return <Icon size={18} strokeWidth={1.8} aria-hidden="true" />; }
export function TaskIcon({ marker }: { marker: string }) { const state = taskState(marker); const Icon = TASK_ICONS[state.id]; return <Icon size={15} strokeWidth={2} fill={state.id === "star" ? "currentColor" : "none"} aria-hidden="true" />; }
export type MarkerPosition = { x: number; y: number };

/** One bounded, keyboard-operable menu for rich blocks and Markdown reading. */
export function NoteStyleMenu({ position, kind, value, onPick, onClose }: { position: MarkerPosition | null; kind: "callout" | "task"; value: string; onPick: (value: string) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [point, setPoint] = useState(position);
  const options = kind === "callout" ? CALLOUT_TYPES.map(type => ({ id: type, label: t(CALLOUT_LABELS[type]) })) : TASK_STATES.map(state => ({ id: state.marker, label: t(state.label) }));
  useLayoutEffect(() => {
    if (!position || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    setPoint({ x: Math.max(8, Math.min(position.x, innerWidth - rect.width - 8)), y: Math.max(8, Math.min(position.y, innerHeight - rect.height - 8)) });
    opener.current = document.activeElement as HTMLElement | null;
    const selected = root.current.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? root.current.querySelector<HTMLButtonElement>("button");
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [position]);
  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [position, onClose]);
  if (!position) return null;
  return createPortal(<div ref={root} className="note-style-menu" role="menu" aria-label={t(kind === "callout" ? "Тип выноски" : "Статус задачи")} style={{ left: point?.x ?? position.x, top: point?.y ?? position.y }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); onClose(); return; }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...root.current!.querySelectorAll<HTMLButtonElement>("button")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }}><div className="note-style-menu-title">{t(kind === "callout" ? "Тип выноски" : "Статус задачи")}</div>
    {options.map(option => <button key={option.id} type="button" role="menuitemradio" aria-checked={kind === "callout" ? calloutType(value) === option.id : (value === "X" ? "x" : value) === option.id} onClick={() => { onPick(option.id); onClose(); }}>
      <span className={kind === "callout" ? `note-callout-symbol note-callout--${option.id}` : `note-task-symbol note-task--${taskState(option.id).id}`}>{kind === "callout" ? <CalloutIcon kind={option.id} /> : <TaskIcon marker={option.id} />}</span><span>{option.label}</span>
      {(kind === "callout" ? calloutType(value) === option.id : value.toLowerCase() === option.id) ? <Check size={14} aria-hidden="true" /> : null}
    </button>)}
  </div>, document.body);
}

export function MarkdownCallout({ kind, fold, index, children, onPick }: { kind: string; fold: string; index: number; children?: ReactNode; onPick?: (kind: "callout" | "task", index: number, value: string) => void }) {
  const [menu, setMenu] = useState<MarkerPosition | null>(null);
  const content = Children.toArray(children).filter(child => typeof child !== "string" || child.trim());
  const [heading, ...body] = content;
  const title = <><CalloutIcon kind={kind} /><span>{heading}</span></>;
  const context = (event: React.MouseEvent) => { if (onPick) { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); } };
  return <><aside className={`note-callout note-callout--${calloutType(kind)}`} data-callout={kind} onContextMenu={context}>
    {fold === "none" ? <><div className="note-callout-head">{title}</div><div className="note-callout-body">{body}</div></> : <details open={fold !== "closed"}><summary className="note-callout-head">{title}<ChevronDown size={15} aria-hidden="true" /></summary><div className="note-callout-body">{body}</div></details>}
  </aside><NoteStyleMenu position={menu} kind="callout" value={kind} onPick={value => onPick?.("callout", index, value)} onClose={() => setMenu(null)} /></>;
}
export function MarkdownTask({ marker, index, children, onPick }: { marker: string; index: number; children?: ReactNode; onPick?: (kind: "callout" | "task", index: number, value: string) => void }) {
  const [menu, setMenu] = useState<MarkerPosition | null>(null);
  const state = taskState(marker);
  const symbol = <TaskIcon marker={marker} />;
  return <><li className={`note-task-row note-task--${state.id}`} onContextMenu={event => { if (onPick) { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); } }}>
    <div className="note-task-line">{onPick ? <button type="button" className="note-task-symbol" role="checkbox" aria-checked={marker === "/" ? "mixed" : marker.toLowerCase() === "x"} aria-label={t("Статус задачи: {status}", { status: t(state.label) })} title={t("ПКМ: выбрать статус задачи")} onClick={() => onPick("task", index, marker.toLowerCase() === "x" ? " " : "x")}>{symbol}</button> : <span className="note-task-symbol" role="img" aria-label={t(state.label)}>{symbol}</span>}<div className="note-task-text">{children}</div></div>
  </li><NoteStyleMenu position={menu} kind="task" value={marker} onPick={value => onPick?.("task", index, value)} onClose={() => setMenu(null)} /></>;
}
