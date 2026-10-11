import type { View } from "../store/notes";
import type { GraphMode } from "./graphTypes";

/** One registry for settings, navigation and command availability. */
export const APP_MODULES = [
  { id: "notes", title: "Все заметки", description: "Галерея заметок, фильтры и быстрый просмотр.", group: "navigation" },
  { id: "files", title: "Файлы", description: "Дерево папок и управление файлами хранилища.", group: "navigation" },
  { id: "search", title: "Поиск", description: "Поиск по содержимому, переход к файлу и панель поиска.", group: "navigation" },
  { id: "inbox", title: "Входящие", description: "Разбор быстрых записей перед переносом в папки.", group: "navigation" },
  { id: "graph", title: "Граф", description: "Визуальная карта заметок и связей между ними.", group: "navigation" },
  { id: "calendar", title: "Календарь", description: "Заметки дня, задачи и подключения iCal / CalDAV.", group: "navigation" },
  { id: "tags", title: "Теги", description: "Навигация по темам и сочетаниям тегов.", group: "navigation" },
  { id: "images", title: "Изображения", description: "Библиотека изображений и вложений хранилища.", group: "navigation" },
  { id: "overview", title: "Обзор", description: "Статистика заметок, активности и объёма текстов.", group: "navigation" },
  { id: "trash", title: "Корзина", description: "Просмотр, восстановление и очистка удалённых файлов.", group: "navigation" },
  { id: "home", title: "Новая вкладка", description: "Стартовая страница и создание пустых вкладок.", group: "tools" },
  { id: "newNote", title: "Новая заметка", description: "Создание заметок и глобальное окно быстрой записи.", group: "tools" },
  { id: "canvas", title: "Холст", description: "Создание холстов и вставка доски в заметку.", group: "tools" },
  { id: "database", title: "База данных", description: "Создание и вставка таблиц с данными в заметку.", group: "tools" },
  { id: "bookmarks", title: "Закладки", description: "Отдельная панель избранных заметок.", group: "tools" },
  { id: "context", title: "Контекст заметки", description: "Правая панель со структурой и обратными ссылками.", group: "tools" },
  { id: "help", title: "Помощь", description: "Панель подсказок и сочетаний клавиш.", group: "tools" },
] as const;
export type ModuleId = typeof APP_MODULES[number]["id"];
export type ModuleSettings = Record<ModuleId, boolean>;
export type GraphFeatures = {
  volume: boolean;
  obsidian: boolean;
  minimap: boolean;
  breathing: boolean;
  localGraph: boolean;
};
export const MINIMAL_MODULES: ModuleSettings = Object.fromEntries(APP_MODULES.map(module => [module.id, ["notes", "files", "search", "newNote"].includes(module.id)])) as ModuleSettings;
export const ALL_MODULES: ModuleSettings = Object.fromEntries(APP_MODULES.map(module => [module.id, true])) as ModuleSettings;
export const DEFAULT_GRAPH_FEATURES: GraphFeatures = { volume: false, obsidian: true, minimap: false, breathing: false, localGraph: false };
type FeatureSettings = { modules: ModuleSettings };

export function isModuleEnabled(settings: FeatureSettings, module: ModuleId): boolean {
  return settings.modules[module];
}
export function isViewEnabled(settings: FeatureSettings, view: View): boolean {
  return view === "settings" || isModuleEnabled(settings, view);
}
export function availableGraphModes(features: GraphFeatures): GraphMode[] {
  return (["volume", "obsidian"] as const).filter(mode => features[mode]);
}
export function resolveGraphMode(preferred: GraphMode, features: GraphFeatures): GraphMode {
  return features[preferred] ? preferred : features.obsidian ? "obsidian" : "volume";
}
export function coerceModules(raw: unknown): ModuleSettings {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return Object.fromEntries(APP_MODULES.map(module => [module.id, typeof value[module.id] === "boolean" ? value[module.id] : MINIMAL_MODULES[module.id]])) as ModuleSettings;
}
export function coerceGraphFeatures(raw: unknown): GraphFeatures {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const features = Object.fromEntries(Object.entries(DEFAULT_GRAPH_FEATURES).map(([key, fallback]) => [key, typeof value[key] === "boolean" ? value[key] : fallback])) as GraphFeatures;
  // Old or hand-edited settings must always leave one usable renderer.
  if (!features.volume && !features.obsidian) features.obsidian = true;
  return features;
}
