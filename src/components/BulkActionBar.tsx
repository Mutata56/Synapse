import { AnimatePresence, motion } from "framer-motion";
import { CheckSquare, X, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export type BulkAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: "default" | "danger" | "primary";
  disabled?: boolean;
};

export function BulkActionBar({
  count,
  total,
  onClear,
  onSelectAll,
  actions,
}: {
  count: number;
  total: number;
  onClear: () => void;
  onSelectAll?: () => void;
  actions: BulkAction[];
}) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] bg-[var(--color-bg-overlay)] backdrop-blur-xl rounded-xl border border-[var(--color-border-strong)] shadow-2xl shadow-black/70 px-3 py-2 flex items-center gap-2"
        >
          <button
            onClick={onClear}
            title="Снять выделение (Esc)"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
          >
            <X size={14} strokeWidth={2} />
          </button>
          <span className="text-[13px] text-zinc-200 font-medium pl-1 pr-1.5 select-none">
            Выбрано {count}
            <span className="text-zinc-600"> из {total}</span>
          </span>
          {onSelectAll && count < total && (
            <button
              onClick={onSelectAll}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors font-medium"
            >
              <CheckSquare size={12} strokeWidth={2} />
              Все
            </button>
          )}
          <div className="h-5 w-px bg-[var(--color-border)] mx-1" />
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                onClick={a.onClick}
                disabled={a.disabled}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors",
                  a.disabled && "opacity-40 cursor-not-allowed",
                  !a.disabled &&
                    a.variant === "danger" &&
                    "text-red-300 hover:text-red-200 hover:bg-red-500/15",
                  !a.disabled &&
                    a.variant === "primary" &&
                    "text-white bg-[var(--color-accent)] hover:bg-indigo-500 shadow-lg shadow-indigo-500/20",
                  !a.disabled &&
                    (!a.variant || a.variant === "default") &&
                    "text-zinc-300 hover:text-white hover:bg-white/[0.06]",
                )}
              >
                <Icon size={12} strokeWidth={2} />
                {a.label}
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
