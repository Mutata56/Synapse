import { cn } from "../lib/cn";
import { EMOJI_FONT_STACK } from "../lib/format";
import { MOODS } from "../lib/mood";

/**
 * Выбор настроения из пяти рожиц (от 1 до 5). Клик по активной рожице ещё раз
 * сбрасывает её. Живёт в шапке заметки дня, хранится в поле `mood` заметки.
 */
export function MoodPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (mood: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {MOODS.map((m) => {
        const active = value === m.v;
        return (
          <button
            key={m.v}
            type="button"
            title={m.label}
            aria-label={m.label}
            aria-pressed={active}
            onClick={() => onChange(active ? null : m.v)}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
              active
                ? "bg-white/10 scale-110"
                : "opacity-35 hover:opacity-100 hover:bg-white/5",
            )}
          >
            <span
              style={{ fontFamily: EMOJI_FONT_STACK }}
              className="text-[18px] leading-none select-none"
            >
              {m.face}
            </span>
          </button>
        );
      })}
    </div>
  );
}
