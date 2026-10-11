import type { ReactNode } from "react";
import { t } from "../lib/i18n";
import { APP_MODULES, type ModuleId } from "../lib/modules";
import { useNotesStore } from "../store/notes";
import { useWorkspaceStore } from "../store/workspace";

/** Retain rich block props without mounting a disabled module's editor. */
export function ModuleBlockGate({ module, children }: { module: ModuleId; children: ReactNode }) {
  const enabled = useNotesStore(state => state.settings.modules[module]);
  if (enabled) return <>{children}</>;
  const title = APP_MODULES.find(entry => entry.id === module)!.title;
  return <div contentEditable={false} className="module-disabled-block" onPointerDown={event => event.stopPropagation()}>
    <span>{t("Модуль «{name}» отключён.", { name: t(title) })}</span>
    <small>{t("Содержимое сохранено. Включи модуль, чтобы открыть его.")}</small>
    <button type="button" onClick={() => void useWorkspaceStore.getState().openView("settings")}>{t("Настройки")}</button>
  </div>;
}
