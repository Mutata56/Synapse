import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";
import { ALL_EMOJIS, searchEmojis } from "../lib/emojiData";
import { ICON_PACKS, loadEmojiCatalog, loadIconCatalog, searchIcons, type CatalogIcon } from "../lib/iconizeCatalog";
import { useIconizeStore } from "../store/iconize";
import { useI18n } from "./LanguageProvider";
import { IconGlyph } from "./NoteIcon";
import { Modal } from "./Modal";
import { useWindowedRows } from "./useWindowedRows";
import "./iconize.css";

const CELL_HEIGHT = 52;
export default function IconPicker() {
  const request = useIconizeStore(s => s.picker)!;
  const data = useIconizeStore(s => s.data), close = useIconizeStore(s => s.closePicker);
  const { t } = useI18n();
  const [query, setQuery] = useState(""), deferredQuery = useDeferredValue(query);
  const [pack, setPack] = useState("all"), [tab, setTab] = useState("icons");
  const [icons, setIcons] = useState<CatalogIcon[]>([]), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [emojis, setEmojis] = useState<CatalogIcon[]>([]);
  const [value, setValue] = useState(request.current?.icon ?? ""), [color, setColor] = useState(request.current?.color ?? null), [inherit, setInherit] = useState(request.current?.inherit ?? false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [columns, setColumns] = useState(10), [focused, setFocused] = useState(0);
  const panel = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const customPacks = useMemo(() => [...new Set(data.customIcons.map(icon => icon.pack))].filter(id => !ICON_PACKS.some(pack => pack.id === id)), [data.customIcons]);
  useEffect(() => {
    let alive = true; setLoading(true); setFailed(false);
    setIcons([]);
    const load = tab === "emoji" ? loadEmojiCatalog() : pack.startsWith("custom:") ? Promise.resolve([]) : loadIconCatalog(pack);
    void load.then(rows => { if (alive) { if (tab === "emoji") setEmojis(rows); else setIcons(rows); } }).catch(() => { if (alive) setFailed(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pack, tab, retry]);
  const filtered = useMemo(() => {
    if (tab === "emoji") {
      const native = (deferredQuery ? searchEmojis(deferredQuery) : ALL_EMOJIS).map(emoji => ({ id: emoji, name: emoji, pack: "emoji" }));
      return [...new Map([...native, ...searchIcons(emojis, deferredQuery)].map(icon => [icon.id, icon])).values()];
    }
    const custom = data.customIcons.filter(icon => pack === "all" || icon.pack === pack || pack === `custom:${icon.pack}`);
    const source = [...new Map([...icons, ...custom].map(icon => [icon.id, icon])).values()];
    return searchIcons(source, deferredQuery);
  }, [icons, emojis, data.customIcons, pack, tab, deferredQuery]);
  const rowCount = Math.ceil(filtered.length / columns);
  const rows = useWindowedRows(rowCount, CELL_HEIGHT, `${pack}:${tab}:${deferredQuery}:${columns}`);
  useLayoutEffect(() => {
    const element = rows.ref.current; if (!element) return;
    const resize = () => setColumns(Math.max(4, Math.floor(element.clientWidth / 52)));
    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect();
  }, [rows.ref]);
  useEffect(() => { setFocused(0); }, [pack, tab, deferredQuery]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    search.current?.focus();
    return () => { if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, []);
  const apply = useCallback(async (icon = value, mode: "set" | "remove" | "reset" = "set") => {
    if (busy || mode === "set" && !icon) return;
    setBusy(true); setError("");
    try {
      if (request.onPick && mode === "set") { await request.onPick(icon, { color, inherit }); await useIconizeStore.getState().remember(icon); }
      else await useIconizeStore.getState().assignMany(request.targets, mode === "reset" ? undefined : { icon: mode === "remove" ? null : icon, color, inherit });
      close();
    } catch (e) { setError(request.copyMode && e instanceof Error ? e.message : t("Не удалось сохранить Iconize")); setBusy(false); }
  }, [value, color, inherit, request, busy, close, t]);
  const focusGlyph = (index: number) => {
    const next = Math.max(0, Math.min(filtered.length - 1, index)); setFocused(next); rows.reveal(Math.floor(next / columns));
    requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>(`[data-icon-index="${next}"]`)?.focus());
  };
  return createPortal(<Modal open onClose={() => { if (!busy) close(); }} ariaLabel={t("Выбрать иконку")} panelClassName="iconize-picker-panel" backdropClassName="iconize-picker-backdrop">
    <div ref={panel} className="iconize-picker" onKeyDown={event => {
      if (event.key === "Tab") {
        const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]') ?? []);
        if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements[elements.length - 1]?.focus(); }
        else if (!event.shiftKey && document.activeElement === elements[elements.length - 1]) { event.preventDefault(); elements[0]?.focus(); }
      }
    }}>
      <header className="iconize-picker-header"><h2>{t("Выбрать иконку")}</h2><button type="button" className="iconize-icon-button" onClick={close} disabled={busy} aria-label={t("Закрыть")}><X size={20} /></button></header>
      <div className="iconize-picker-controls"><div className="iconize-tabs" role="tablist" aria-label={t("Тип иконки")}><button type="button" role="tab" aria-selected={tab === "icons"} onClick={() => setTab("icons")}>{t("Иконки")}</button><button type="button" role="tab" aria-selected={tab === "emoji"} onClick={() => setTab("emoji")}>{t("Эмодзи")}</button></div>{tab === "icons" && <select aria-label={t("Набор иконок")} value={pack} onChange={e => setPack(e.target.value)}><option value="all">{t("Все наборы")}</option>{ICON_PACKS.map(pack => <option key={pack.id} value={pack.id}>{pack.name}</option>)}{customPacks.map(pack => <option key={pack} value={`custom:${pack}`}>{pack}</option>)}</select>}</div>
      <label className="iconize-search"><Search size={17} aria-hidden="true" /><input ref={search} value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Поиск: Java, PostgreSQL, склад…")} aria-label={t("Поиск иконок")} onKeyDown={e => { if (e.key === "ArrowDown" && filtered.length) { e.preventDefault(); focusGlyph(0); } }} />{query && <button type="button" className="iconize-icon-button" aria-label={t("Очистить поиск")} onClick={() => { setQuery(""); search.current?.focus(); }}><X size={15} /></button>}</label>
      {!query && data.settings.recentlyUsedIcons.length > 0 && <div className="iconize-recent"><span>{t("Недавние")}</span>{data.settings.recentlyUsedIcons.map(icon => <button type="button" key={icon} title={icon} aria-label={icon} aria-pressed={value === icon} onClick={() => setValue(icon)}><IconGlyph value={icon} size={22} color={color} /></button>)}</div>}
      <div className="iconize-grid-summary" aria-live="polite">{loading ? t("Загрузка…") : t("{n} иконок", { n: filtered.length })}</div>
      <div className="iconize-grid-scroll" ref={rows.ref} onScroll={rows.onScroll}>
        {failed ? <div className="iconize-empty" role="alert"><p>{t("Не удалось открыть набор иконок")}</p><button type="button" className="iconize-button" onClick={() => setRetry(v => v + 1)}>{t("Повторить")}</button></div> : !loading && filtered.length === 0 ? <p className="iconize-empty">{t("Иконки не найдены. Попробуйте другое название.")}</p> : <div role="group" aria-label={t("Каталог иконок")} style={{ height: rowCount * CELL_HEIGHT, position: "relative" }}>
          {Array.from({ length: Math.max(0, rows.end - rows.start) }, (_, rowOffset) => {
            const row = rows.start + rowOffset;
            return <div className="iconize-grid-row" key={row} style={{ top: row * CELL_HEIGHT, gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>{filtered.slice(row * columns, (row + 1) * columns).map((icon, offset) => {
              const index = row * columns + offset;
              return <button type="button" key={icon.id} className="iconize-glyph-button" data-icon-index={index} aria-label={`${icon.name} (${icon.id})`} title={`${icon.name}\n${icon.id}`} aria-pressed={value === icon.id} tabIndex={focused === index ? 0 : -1} onFocus={() => setFocused(index)} onClick={() => setValue(icon.id)} onDoubleClick={() => void apply(icon.id)} onKeyDown={e => {
                const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, Home: -index, End: filtered.length - 1 - index };
                if (e.key in delta) { e.preventDefault(); focusGlyph(index + delta[e.key]); }
                if (e.key === "Enter") { e.preventDefault(); void apply(icon.id); }
              }}><IconGlyph value={icon.id} size={24} color={color} />{value === icon.id && <Check size={10} className="iconize-selected-check" />}</button>;
            })}</div>;
          })}
        </div>}
      </div>
      {!request.copyMode && <div className="iconize-picker-options"><label>{t("Цвет")}<input type="color" value={color ?? "#d4d4d8"} onChange={e => setColor(e.target.value)} aria-label={t("Цвет иконки")} /></label><button type="button" className="iconize-text-button" onClick={() => setColor(null)}>{t("По умолчанию")}</button>{request.targets.some(target => target.kind === "folder") && <label className="iconize-checkbox"><input type="checkbox" checked={inherit} onChange={e => setInherit(e.target.checked)} />{t("Наследовать для содержимого")}</label>}</div>}
      {error && <p className="iconize-error" role="alert">{error}</p>}
      <footer className="iconize-picker-footer"><div className="iconize-picker-selected">{value ? <><IconGlyph value={value} size={26} color={color} /><span title={value}>{request.copyMode ? data.settings.iconIdentifier + value + data.settings.iconIdentifier : value}</span></> : <span>{t("Выберите иконку")}</span>}</div><div className="iconize-picker-actions">{!request.onPick && <><button type="button" className="iconize-text-button" disabled={busy} onClick={() => void apply("", "reset")}>{t("Автоматически")}</button><button type="button" className="iconize-text-button" disabled={busy} onClick={() => void apply("", "remove")}>{t("Без иконки")}</button></>}<button type="button" className="iconize-button iconize-primary" disabled={busy || !value} onClick={() => void apply()}>{busy ? t("Сохранение…") : t(request.copyMode ? "Скопировать код" : "Применить")}</button></div></footer>
    </div>
  </Modal>, document.body);
}
