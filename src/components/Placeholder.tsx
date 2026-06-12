import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { t } from "../lib/i18n";

export function Placeholder({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-4 max-w-md text-center"
      >
        <div className="relative">
          <div className="absolute inset-0 blur-2xl bg-indigo-500/20 rounded-full" />
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-[var(--color-border-strong)] flex items-center justify-center shadow-xl">
            <Icon size={28} strokeWidth={1.4} className="text-[var(--color-accent)]" />
          </div>
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-zinc-200 tracking-tight">
            {title}
          </h2>
          <p className="text-sm text-zinc-500 leading-relaxed">{hint}</p>
        </div>
        <div className="px-3 py-1 rounded-full bg-white/[0.04] border border-[var(--color-border)] text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
          {/* todo доделать, сейчас просто заглушка */}
          {t("В разработке")}
        </div>
      </motion.div>
    </div>
  );
}
