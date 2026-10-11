import { cloneElement, isValidElement, useId, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ICON_PACKS, sanitizeIconSvg } from "../lib/iconizeCatalog";
import { iconColor, type CustomIcon, type IconRule } from "../lib/iconize";
import { useIconizeStore } from "../store/iconize";
import { useToastStore } from "../store/toasts";
import { useI18n } from "./LanguageProvider";
import { IconGlyph } from "./NoteIcon";
import "./iconize.css";

function Row({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  const control = isValidElement<{ "aria-labelledby"?: string }>(children) && (children.type === "input" || children.type === "select") ? cloneElement(children, { "aria-labelledby": id }) : children;
  return <div className="iconize-settings-row"><span id={id}>{title}</span>{control}</div>;
}
export function IconizeSettings() {
  const { t } = useI18n(), data = useIconizeStore(s => s.data), configure = useIconizeStore(s => s.configure);
  const s = data.settings;
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [customName, setCustomName] = useState("");
  const update = (patch: Parameters<typeof configure>[0]) => { void configure(patch).catch(() => setError(t("Не удалось сохранить Iconize"))); };
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); setMessage(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const importVault = () => run(async () => {
    const path = await open({ directory: true, multiple: false, title: t("Выберите хранилище Obsidian") });
    if (typeof path !== "string") return;
    const count = await useIconizeStore.getState().importVault(path);
    setMessage(t("Импортировано назначений: {n}", { n: count }));
  });
  const addCustom = () => run(async () => {
    const name = customName.trim();
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(name) || ICON_PACKS.some(p => p.id === name)) throw new Error(t("Название набора: латинские буквы, цифры и дефис"));
    const files = await open({ multiple: true, filters: [{ name: "SVG / PNG", extensions: ["svg", "png"] }], title: t("Добавить SVG/PNG-иконки") });
    if (!files) return;
    const prefix = name.includes("-") ? name.split("-").map((part, i) => i ? part[0].toLowerCase() : part[0].toUpperCase()).join("") : name.slice(0, 2).replace(/^./, c => c.toUpperCase());
    const icons: CustomIcon[] = [];
    for (const path of typeof files === "string" ? [files] : files) {
      let svg = "", png: string | undefined;
      if (/\.png$/i.test(path)) {
        const bytes = await readFile(path);
        if (bytes.length > 2000000 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => bytes[index] !== value)) throw new Error(t("Некорректный PNG-файл"));
        let binary = ""; for (let from = 0; from < bytes.length; from += 8192) binary += String.fromCharCode(...bytes.subarray(from, from + 8192));
        png = "data:image/png;base64," + btoa(binary);
      } else {
        const raw = await readTextFile(path), clean = sanitizeIconSvg(raw);
        if (!clean) throw new Error(t("Некорректный SVG-файл")); svg = clean;
      }
      const filename = path.split(/[\\/]/).pop()!.replace(/\.(svg|png)$/i, "");
      const label = filename.split(/[- _]/).map(part => part[0]?.toUpperCase() + part.slice(1)).join("");
      const id = prefix + label;
      if (!/^[A-Za-z][\w-]{0,127}$/.test(id)) throw new Error(t("Недопустимое название иконки"));
      const existing = data.customIcons.find(icon => icon.id === id);
      if (existing && existing.pack !== name || ICON_PACKS.some(p => p.prefix === prefix)) throw new Error(t("Префикс набора уже занят. Выберите другое название."));
      icons.push({ id, name: label, pack: name, svg, png });
    }
    await useIconizeStore.getState().addIcons(icons); setCustomName(""); setMessage(t("Добавлено иконок: {n}", { n: icons.length }));
  });
  const saveRule = (id: string, patch: Partial<IconRule>) => configure({ rules: useIconizeStore.getState().data.settings.rules.map(rule => rule.id === id ? { ...rule, ...patch } : rule) });
  const patchRule = (id: string, patch: Partial<IconRule>) => saveRule(id, patch).catch(() => setError(t("Не удалось сохранить Iconize")));
  const copyCode = async (icon: string) => {
    try {
      await navigator.clipboard.writeText(s.iconIdentifier + icon + s.iconIdentifier);
      setMessage(t("Код иконки скопирован")); setError("");
      useToastStore.getState().push(t("Код иконки скопирован"), "success");
    } catch {
      const message = t("Не удалось скопировать код. Попробуйте ещё раз.");
      setError(message); throw new Error(message);
    }
  };
  const ordered = [...s.rules].sort((a, b) => a.order - b.order);
  const reorder = (id: string, delta: number) => {
    const index = ordered.findIndex(rule => rule.id === id), target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    update({ rules: ordered.map((rule, order) => ({ ...rule, order })) });
  };
  return <div className="iconize-settings">
    <h3>Iconize</h3><p>{t("Иконки и логотипы для заметок и папок. Все 13 наборов доступны без сети.")}</p>
    <div className="iconize-settings-actions"><button type="button" className="iconize-button" onClick={() => useIconizeStore.getState().openPicker({ targets: [], copyMode: true, onPick: copyCode })}>{t("Открыть каталог")}</button><button type="button" className="iconize-button" disabled={busy} onClick={() => void importVault()}>{t("Импортировать из Obsidian")}</button></div>
    {(message || error) && <p className={error ? "iconize-error" : ""} role={error ? "alert" : "status"}>{error || message}</p>}
    <div className="iconize-packs">{ICON_PACKS.map(pack => <span key={pack.id}>{pack.name}</span>)}</div>
    <h3>{t("Отображение")}</h3>
    <Row title={t("Размер иконок")}><input type="number" min={10} max={48} value={s.fontSize} onChange={e => update({ fontSize: Number(e.target.value) })} /></Row>
    <Row title={t("Общий цвет")}><span className="iconize-picker-actions"><input type="color" aria-label={t("Общий цвет")} value={s.iconColor ?? "#d4d4d8"} onChange={e => update({ iconColor: e.target.value })} /><button type="button" className="iconize-text-button" onClick={() => update({ iconColor: null })}>{t("По умолчанию")}</button></span></Row>
    <Row title={t("Стиль эмодзи")}><select value={s.emojiStyle} onChange={e => update({ emojiStyle: e.target.value as "native" | "twemoji" })}><option value="native">{t("Системные")}</option><option value="twemoji">Twemoji</option></select></Row>
    <Row title={t("Иконки во вкладках")}><input type="checkbox" checked={s.iconInTabsEnabled} onChange={e => update({ iconInTabsEnabled: e.target.checked })} /></Row>
    <Row title={t("Иконка в заголовке")}><input type="checkbox" checked={s.iconInTitleEnabled} onChange={e => update({ iconInTitleEnabled: e.target.checked })} /></Row>
    <Row title={t("Положение у заголовка")}><select value={s.iconInTitlePosition} onChange={e => update({ iconInTitlePosition: e.target.value as "above" | "inline" })}><option value="above">{t("Над заголовком")}</option><option value="inline">{t("В строке заголовка")}</option></select></Row>
    <Row title={t("Иконки в тексте заметок")}><input type="checkbox" checked={s.iconsInNotesEnabled} onChange={e => update({ iconsInNotesEnabled: e.target.checked })} /></Row>
    <Row title={t("Иконки у ссылок")}><input type="checkbox" checked={s.iconsInLinksEnabled} onChange={e => update({ iconsInLinksEnabled: e.target.checked })} /></Row>
    <Row title={t("Разделитель в тексте")}><input type="text" maxLength={8} value={s.iconIdentifier} onChange={e => update({ iconIdentifier: e.target.value })} /></Row>
    <Row title={t("Недавние иконки")}><input type="number" min={0} max={100} value={s.recentlyUsedIconsSize} onChange={e => update({ recentlyUsedIconsSize: Number(e.target.value) })} /></Row>
    <Row title={t("Отступы: верх, справа, низ, слева")}><span className="iconize-margins">{(["top", "right", "bottom", "left"] as const).map(side => <input key={side} aria-label={t({ top: "Отступ сверху", right: "Отступ справа", bottom: "Отступ снизу", left: "Отступ слева" }[side])} type="number" min={0} max={24} value={s.extraMargin[side]} style={{ width: 48 }} onChange={e => update({ extraMargin: { ...s.extraMargin, [side]: Number(e.target.value) } })} />)}</span></Row>
    <h3>{t("Свойства Markdown")}</h3>
    <Row title={t("Читать иконки из свойств")}><input type="checkbox" checked={s.iconInFrontmatterEnabled} onChange={e => update({ iconInFrontmatterEnabled: e.target.checked })} /></Row>
    <Row title={t("Поле иконки")}><input type="text" value={s.iconInFrontmatterFieldName} onChange={e => update({ iconInFrontmatterFieldName: e.target.value })} /></Row>
    <Row title={t("Поле цвета")}><input type="text" value={s.iconColorInFrontmatterFieldName} onChange={e => update({ iconColorInFrontmatterFieldName: e.target.value })} /></Row>
    <h3>{t("Правила назначения")}</h3><p>{t("Первое подходящее правило назначает иконку автоматически. Ручной выбор имеет приоритет.")}</p>
    {ordered.map((rule, index) => <div key={rule.id} className="iconize-rule"><button type="button" className="iconize-icon-button" aria-label={t("Выбрать иконку правила")} onClick={() => useIconizeStore.getState().openPicker({ targets: [], current: { icon: rule.icon, color: rule.color }, onPick: (icon, appearance) => saveRule(rule.id, { icon, color: appearance.color }) })}><IconGlyph value={rule.icon} size={24} color={rule.color} /></button><div className="iconize-rule-fields"><input type="text" aria-label={t("Шаблон правила")} value={rule.rule} placeholder={t("Имя или регулярное выражение")} onChange={e => patchRule(rule.id, { rule: e.target.value })} /><select aria-label={t("Применять к")} value={rule.for ?? "everything"} onChange={e => patchRule(rule.id, { for: e.target.value as IconRule["for"] })}><option value="everything">{t("Файлы и папки")}</option><option value="files">{t("Файлы")}</option><option value="folders">{t("Папки")}</option></select><label><input type="checkbox" checked={rule.useFilePath === true} onChange={e => patchRule(rule.id, { useFilePath: e.target.checked })} />{t("Весь путь")}</label><label><input type="checkbox" checked={rule.enabled !== false} onChange={e => patchRule(rule.id, { enabled: e.target.checked })} />{t("Включено")}</label><input type="color" aria-label={t("Цвет правила")} value={iconColor(rule.color) ?? "#d4d4d8"} onChange={e => patchRule(rule.id, { color: e.target.value })} /><button type="button" className="iconize-text-button" onClick={() => patchRule(rule.id, { color: null })}>{t("По умолчанию")}</button></div><div><button type="button" className="iconize-icon-button" disabled={index === 0} aria-label={t("Выше")} onClick={() => reorder(rule.id, -1)}><ArrowUp size={14} /></button><button type="button" className="iconize-icon-button" disabled={index === ordered.length - 1} aria-label={t("Ниже")} onClick={() => reorder(rule.id, 1)}><ArrowDown size={14} /></button><button type="button" className="iconize-icon-button" aria-label={t("Удалить правило")} onClick={() => update({ rules: s.rules.filter(r => r.id !== rule.id) })}><Trash2 size={14} /></button></div></div>)}
    <button type="button" className="iconize-button" onClick={() => update({ rules: [...s.rules, { id: crypto.randomUUID(), rule: ".", icon: "LiFileText", order: s.rules.length, for: "files" }] })}><Plus size={14} /> {t("Добавить правило")}</button>
    <h3>{t("Свои наборы")}</h3><p>{t("Добавьте SVG или PNG в собственный набор. Иконки сохраняются вместе с данными хранилища.")}</p>
    <div className="iconize-settings-actions"><input type="text" aria-label={t("Название набора")} placeholder="my-icons" value={customName} onChange={e => setCustomName(e.target.value)} /><button type="button" className="iconize-button" disabled={busy} onClick={() => void addCustom()}>{t("Добавить SVG/PNG-иконки")}</button></div>
    {[...new Set(data.customIcons.map(icon => icon.pack))].map(pack => <div key={pack} className="iconize-settings-row"><span>{pack} · {data.customIcons.filter(icon => icon.pack === pack).length}</span><button type="button" className="iconize-text-button" onClick={() => { void useIconizeStore.getState().removePack(pack).catch(() => setError(t("Не удалось сохранить Iconize"))); }}>{t("Удалить набор")}</button></div>)}
  </div>;
}
