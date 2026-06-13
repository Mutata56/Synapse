import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { INBOX_FOLDER } from "../lib/inbox";
import {
  importAssetBytes,
  newNoteId,
  nextNumberedTitle,
  writeNote,
  type Note,
} from "../lib/storage";
import { toPortableAssetRef } from "../editor2026/lib/assets";

/**
 * Окно быстрого захвата: без рамки, всегда поверх остальных (метка окна Tauri
 * "capture"). Показывается по глобальному шорткату (со стороны Rust). Пишет
 * новую заметку во входящие, через событие просит главное окно обновиться и
 * прячется. В фоне остаётся загруженным, чтобы открываться мгновенно.
 */
export function CaptureWindow() {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Фокус при монтировании И каждый раз, когда окно снова показывают (вебвью
  // не сносится, поэтому ловим фокус на каждый focus-gain, а не только на
  // монтировании).
  useEffect(() => {
    ref.current?.focus();
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) ref.current?.focus();
      })
      .then((u) => {
        unlisten = u;
      });
    return () => unlisten?.();
  }, []);

  const hide = () => {
    void getCurrentWindow().hide();
  };

  const save = async () => {
    const text = value.trim();
    if (!text) {
      hide();
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      // Имя по порядку ("Заметка N"). Если брать заголовок из первой строки, в
      // него протекал набранный текст и markdown вставленных картинок.
      const title = await nextNumberedTitle(INBOX_FOLDER, "Заметка");
      const id = newNoteId(INBOX_FOLDER);
      const now = Date.now();
      // Ставим время создания в начало тела, чтобы оно было видно внутри самой
      // заметки, а не только в метаданных. Курсив это ненавязчивая строка-шапка
      // над захваченным текстом.
      const stamp = new Date(now).toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const note: Note = {
        id,
        title,
        folder: INBOX_FOLDER,
        createdAt: now,
        updatedAt: now,
        content: `*${stamp}*\n\n${text}`,
        icon: null,
        cover: null,
        preview: "",
        favorite: false,
        tags: [],
        links: [],
      };
      await writeNote(note);
      // Пинаем главное окно перечитать дерево, чтобы захват появился.
      await emit("note-captured");
      setValue("");
      hide();
    } catch (e) {
      // Окно и текст оставляем как есть, чтобы при сбое мысль не потерялась.
      console.error("CaptureWindow: save failed:", e);
    } finally {
      setSaving(false);
    }
  };

  // Вставили картинку (например, скриншот), прогоняем её через общий конвейер
  // ассетов (дедуп по SHA в .assets/) и вставляем markdown-ссылку на картинку у
  // курсора. Она отрисуется картинкой, когда заметку откроют в главном редакторе.
  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    // Достаём File-хендлы синхронно: элементы буфера не переживают await.
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return; // картинок нет, пусть отработает обычная вставка текста
    e.preventDefault();

    const ta = ref.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    const refs: string[] = [];
    for (const f of files) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const ext = (f.type.split("/")[1] || "png").toLowerCase();
        const { url } = await importAssetBytes(buf, ext);
        // Портабельная ссылка `.assets/<имя>`, а не абсолютный путь: главный
        // редактор развернёт её в картинку, а бэкап переедет на другую ОС.
        refs.push(`![](${toPortableAssetRef(url)})`);
      } catch (err) {
        console.error("CaptureWindow: image paste failed:", err);
      }
    }
    if (refs.length === 0) return;
    // Вставляем отдельным блоком (или блоками): в BlockNote картинки только
    // блочные, так что инлайновый `![](...)` внутри абзаца теряется при парсинге
    // markdown. Разделяем картинки пустой строкой, чтобы каждая стала своим блоком.
    const before = value.slice(0, start);
    const lead = before.length > 0 && !before.endsWith("\n\n") ? "\n\n" : "";
    const insert = lead + refs.join("\n\n") + "\n\n";
    setValue((v) => v.slice(0, start) + insert + v.slice(end));
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = start + insert.length;
      ta.selectionStart = ta.selectionEnd = pos;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      hide();
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] overflow-hidden">
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] shrink-0 select-none cursor-default"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Быстрая заметка , {INBOX_FOLDER}
        </span>
        <span className="text-[10px] text-zinc-600 font-mono">
          Enter , сохранить · Esc , скрыть · Ctrl+V , картинка
        </span>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => void onPaste(e)}
        placeholder={t("Записать мысль или вставить картинку…")}
        spellCheck={false}
        className="flex-1 resize-none bg-transparent outline-none px-4 py-3 text-[14px] leading-relaxed text-zinc-100 placeholder-zinc-600"
      />
    </div>
  );
}
