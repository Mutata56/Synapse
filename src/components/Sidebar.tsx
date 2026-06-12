import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { reducedFx } from "../lib/platform";
import { FavoritesSection } from "./FavoritesSection";
import { FolderTree } from "./FolderTree";
import { NavSection } from "./NavSection";

const APP_NAME = "Synapse";

// Ширина тянется мышью и помнится между сессиями. Зажата в рамки, чтобы панель
// нельзя было утянуть в бесполезно узкую или раздуть на всё окно.
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256; // как был старый фиксированный `w-64`
const WIDTH_KEY = "sidebar-width";

function clampWidth(w: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

function loadWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : DEFAULT_WIDTH;
}

export function Sidebar() {
  const [width, setWidth] = useState(loadWidth);
  const dragging = useRef(false);

  // Тянем за край. Левая граница сайдбара стоит в x=0 вьюпорта, поэтому текущая
  // ширина это просто clientX курсора (с зажимом). Слушатели висят на `window`,
  // чтобы быстрый драг, соскользнувший с 6px-хваталки, не обрывал ресайз.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) setWidth(clampWidth(e.clientX));
    };
    const stop = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Сбрасываем итоговую ширину, когда драг устаканился. Эффект ниже не
      // пишет во время драга, так что это единственная запись на жест.
      try {
        localStorage.setItem(WIDTH_KEY, String(widthRef.current));
      } catch {
        /* квота или приватный режим, забиваем */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
    };
  }, []);

  // Дублируем `width` в ref, чтобы эффект на размонтировании читал свежее
  // значение без переподписки.
  const widthRef = useRef(width);
  widthRef.current = width;

  // Сохраняем выбранную ширину. Во время активного драга пропускаем: `stop`
  // один раз запишет итог, вместо записи на каждый mousemove (было 60-120
  // синхронных записей в localStorage в секунду на каждый драг).
  useEffect(() => {
    if (dragging.current) return;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* квота или приватный режим, забиваем */
    }
  }, [width]);

  const beginResize = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <motion.aside
      // Анимация появления на GPU: opacity и transform дешёвые.
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      aria-label={t("Боковая навигация")}
      style={{ width }}
      className={cn(
        "relative shrink-0 border-r border-[var(--color-border)]",
        // WebKitGTK перерисовывает backdrop-blur на каждую перерисовку, так что
        // матовый сайдбар дёргает каждое переключение вкладок. Там берём
        // непрозрачную заливку; матовое стекло оставляем на WebView2 (Windows),
        // он композитит его бесплатно.
        reducedFx
          ? "bg-[var(--color-bg-elevated)]"
          : "bg-[var(--color-bg-elevated)]/80 backdrop-blur-xl",
        "flex flex-col",
      )}
    >
      <BrandHeader />
      <NavSection />
      <FadedDivider />
      <FavoritesSection />
      <FolderTree />

      {/* Хваталка сидит на правом крае. Двойной клик сбрасывает к дефолту. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину панели"
        onMouseDown={beginResize}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
        title={t("Потяните, чтобы изменить ширину (двойной клик , сброс)")}
        className="group absolute inset-y-0 right-0 z-10 w-1.5 translate-x-1/2 cursor-col-resize"
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-[var(--color-accent)]" />
      </div>
    </motion.aside>
  );
}

function BrandHeader() {
  return (
    <div className="px-4 py-3.5 border-b border-[var(--color-border)] flex items-center gap-2">
      <div
        className={cn(
          "w-6 h-6 rounded-md flex items-center justify-center",
          "bg-gradient-to-br from-indigo-500 to-violet-600",
          "shadow-lg shadow-indigo-500/30",
        )}
      >
        <Sparkles size={13} strokeWidth={2.4} className="text-white" />
      </div>
      <h1 className="text-[13px] font-semibold text-zinc-200 tracking-tight">
        {APP_NAME}
      </h1>
    </div>
  );
}

function FadedDivider() {
  return (
    <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-border-strong)] to-transparent mx-3 my-1" />
  );
}
