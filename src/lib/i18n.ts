/**
 * i18n: словарь перевода русский -> английский.
 *
 * Ключи это исходные русские строки из интерфейса, значения их английские
 * эквиваленты.
 *
 * Использование:
 *   import { t } from "../lib/i18n";
 *   <h2>{t("Настройки")}</h2>            // "Settings" на англ., "Настройки" на рус.
 *   <p>{t("Удалить {n} элементов?", { n: 5 })}</p>
 *
 * При lang="ru" t() возвращает ключ как есть. При lang="en" возвращает английское
 * значение с подстановкой переменных.
 */
// TODO: почистить « , » (пробел-запятая на месте бывшего тире) в ключах и в
// строках UI на местах. Главное - ключи тут должны совпадать со строками в
// вызовах t(), иначе перевод молча не подхватится.
const en: Record<string, string> = {
  // ─── Общее ───
  "Отмена": "Cancel",
  "Удалить": "Delete",
  "Сохранить": "Save",
  "Переименовать": "Rename",
  "Закрыть": "Close",
  "OK": "OK",
  "Пусто": "Empty",
  "пусто": "empty",
  "Загрузка…": "Loading…",
  "Загрузка...": "Loading…",
  "Загружаю…": "Loading…",
  "Назад": "Back",
  "Вперёд": "Forward",
  "Открыть": "Open",
  "Применить": "Apply",
  "Выбрать": "Pick",
  "Ничего не найдено": "Nothing found",
  "Ошибка": "Error",
  "Да": "Yes",
  "Нет": "No",
  "Ввод": "Input",
  "Подтверждение": "Confirmation",

  // ─── Навигация ───
  "/ Файлы": "/ Files",
  "Файлы": "Files",
  "Граф": "Graph",
  "Граф связей": "Graph",
  "Все заметки": "All Notes",
  "Входящие": "Inbox",
  "Обзор": "Overview",
  "Теги": "Tags",
  "Корзина": "Trash",
  "Изображения": "Images",
  "Настройки": "Settings",
  "Разделы": "Sections",
  "Боковая навигация": "Side navigation",

  "Потяните, чтобы изменить ширину (двойной клик , сброс)": "Drag to resize (double-click to reset)",

  // ─── Настройки ───
  "Внешний вид, быстрая заметка и хранилище": "Appearance, quick note and storage",
  "Внешний вид": "Appearance",
  "Поведение": "Behavior",
  "Данные": "Data",
  "Подписка iCal": "iCal subscription",
  "Превью": "Preview",
  "Кнопка": "Button",
  "Ссылка": "Link",

  // ─── Календарь: подсказка и CalDAV ───
  "Подсказка": "Help",
  "Как пользоваться календарём": "How to use the calendar",
  "Задачи": "Tasks",
  "Кликните по дню, чтобы добавить дело: без времени - на весь день, со временем - в часовую сетку.":
    "Click a day to add a task: without a time it is all-day, with a time it goes into the hourly grid.",
  "Месяц и Неделя переключаются кнопками сверху. Клик по заголовку с датой открывает выбор любой даты.":
    "Switch Month and Week with the buttons on top. Click the date title to jump to any date.",
  "Галочка слева отмечает выполнение.": "The checkbox on the left marks a task done.",
  "Повторы, цвета и метки": "Recurrence, colors and tags",
  "Повтор: кнопка повтора на задаче - день, неделя или месяц и свой интервал «каждые N».":
    'Recurrence: the repeat button on a task - day, week or month with a custom "every N" interval.',
  "Цвет и метки: кнопка-метка на задаче - цвет из палитры и произвольные теги.":
    "Color and tags: the tag button on a task - a color from the palette and free-form tags.",
  "Подписка на календарь (iCal, только чтение)":
    "Calendar subscription (iCal, read-only)",
  "Настройки → Календарь: вставьте приватную ссылку iCal (.ics), например из Яндекс.Календаря. Чужие события лягут поверх календаря, без изменения.":
    "Settings → Calendar: paste a private iCal (.ics) link, e.g. from Yandex Calendar. External events show on top of the calendar, read-only.",
  "Пуш в Яндекс.Календарь (CalDAV)": "Push to Yandex Calendar (CalDAV)",
  "Настройки → Пуш в Яндекс.Календарь: укажите логин и пароль приложения (id.yandex.ru → Пароли приложений → CalDAV), нажмите «Найти календари» и выберите календарь.":
    'Settings → Push to Yandex Calendar: enter your login and an app password (id.yandex.ru → App passwords → CalDAV), click "Find calendars" and pick one.',
  "Кнопка отправки вверху календаря шлёт ваши задачи как события. Повторная отправка обновляет их.":
    "The upload button at the top of the calendar sends your tasks as events. Sending again updates them.",
  "Разница: подписка iCal - только чтение (видеть чужой календарь), CalDAV - запись (отправлять свои задачи в Яндекс).":
    "The difference: an iCal subscription is read-only (view someone's calendar), CalDAV writes (send your tasks to Yandex).",
  "Отправлять свои задачи как события. Нужен пароль приложения, не пароль аккаунта.":
    "Send your tasks as events. Needs an app password, not your account password.",
  "пароль приложения": "app password",
  "Найти календари": "Find calendars",
  "Куда отправлять": "Where to send",
  "(без имени)": "(no name)",
  "Выбран": "Selected",
  "Акцентный цвет": "Accent color",
  "Цвет выделения, ссылок и активных элементов": "Color for highlights, links and active elements",
  "Свой цвет (HEX)": "Custom color (HEX)",
  "Выбрать свой цвет": "Choose custom color",
  "Поведение при запуске приложения": "Startup behavior",
  "Открывать заметку дня при запуске": "Open daily note on startup",
  "Хоткей быстрой заметки": "Quick note hotkey",
  "Глобальная комбинация для окна быстрой записи , работает даже когда приложение свёрнуто в трей": "Global shortcut for quick capture window, works even when the app is minimized to tray",
  "Нажмите комбинацию…": "Press a key combination…",
  "Сбросить": "Reset",
  "Нужен модификатор (Ctrl / Alt / Shift) + буква, цифра или F-клавиша": "Need a modifier (Ctrl / Alt / Shift) + letter, digit or F-key",
  "Подключить внешний календарь по приватной ссылке iCalendar (.ics) , только чтение": "Connect an external calendar via private iCalendar (.ics) link, read-only",
  "Синхронизация…": "Syncing…",
  "Обновить": "Refresh",
  "Событий: {count}": "Events: {count}",
  "В Яндекс.Календаре: «Настройки» , нужный календарь , скопируйте приватную ссылку (iCal). Ссылка содержит секретный токен , не делитесь ей.": "In Yandex.Calendar: \"Settings\", desired calendar, copy the private link (iCal). The link contains a secret token, do not share it.",
  "Хранилище": "Storage",
  "Где лежат все заметки, изображения и корзина": "Where all notes, images and trash are stored",
  "Создать бэкап (.zip)": "Create backup (.zip)",
  "Создаю бэкап…": "Creating backup…",
  "Восстановить из бэкапа…": "Restore from backup…",
  "Восстанавливаю…": "Restoring…",
  "Бэкап сохранён": "Backup saved",
  "Не удалось создать бэкап": "Failed to create backup",
  "Не удалось открыть выбор файла": "Failed to open file picker",
  "Это перезапишет всю текущую папку заметок. Текущее состояние сохранится в notes.bak-<дата> рядом. Продолжить?": "This will overwrite the entire current notes folder. Current state will be saved to notes.bak-<date> nearby. Continue?",
  "Восстановить": "Restore",
  "Бэкап собирает все заметки в один .zip , выберите, куда сохранить (облако, флешка, любая папка). Восстановление полностью заменит текущую папку; предыдущее состояние сохранится в notes.bak-<дата> рядом, на случай если потребуется откатиться.": "Backup collects all notes into a single .zip, choose where to save. Restore will completely replace the current folder; previous state will be saved to notes.bak-<date> nearby.",
  "Архив": "Archive",

  // ─── Шапка заметки ───
  "Избранное": "Favorites",
  "Без названия": "Untitled",
  "Добавить иконку": "Add icon",
  "Сохранить как шаблон": "Save as template",
  "Не удалось сохранить": "Failed to save",

  // ─── Вид файлов ───
  "Упоминания": "Mentions",
  "Возможные связи": "Possible links",
  "Связать": "Link",
  "Связать , обернуть упоминание в [[ ]]": "Link, wrap mention in [[ ]]",
  "Название заметки": "Note name",
  "Название папки": "Folder name",
  "Удалить папку": "Delete folder",
  "В корзину": "To trash",
  "Открыть папку": "Open folder",
  "Папка": "Folder",
  "Заметка": "Note",
  "Папка пуста. Создай заметку или подпапку выше.": "Folder is empty. Create a note or subfolder above.",
  "Снять выделение": "Deselect",
  "Выделить": "Select",

  // ─── Дерево папок ───
  "Свернуть": "Collapse",
  "Раскрыть": "Expand",
  "Новая заметка": "New note",
  "Новая папка": "New folder",
  "Цвет папки": "Folder color",
  "Удалить выделенные ({count})": "Delete selected ({count})",
  "Удалить папку \"{name}\" со всем содержимым?": "Delete folder \"{name}\" and all contents?",
  "Убрать из избранного": "Remove from favorites",
  "В избранное": "Add to favorites",
  "История версий": "Version history",
  "Экспорт в Markdown": "Export to Markdown",
  "Заметка экспортирована": "Note exported",
  "Не удалось экспортировать": "Failed to export",
  "Не удалось переместить в корзину": "Failed to move to trash",
  "Не удалось удалить папку": "Failed to delete folder",
  "Не удалось создать заметку": "Failed to create note",
  "Не удалось создать папку": "Failed to create folder",
  "Переместить {count} в корзину?": "Move {count} to trash?",
  "Здесь будут твои заметки.": "Your notes will appear here.",
  "Нажми + чтобы начать": "Press + to start",
  "«{title}» в корзине": "\"{title}\" in trash",
  "Имя заметки": "Note name",
  "Имя папки": "Folder name",
  "Не удалось переместить": "Failed to move",
  "Не удалось удалить": "Failed to delete",

  // ─── Корзина ───
  "Очистить корзину": "Clear trash",
  "Очистить корзину полностью?": "Clear trash completely?",
  "Очистить": "Clear",
  "Корзина пуста. Удалённые заметки и папки появятся здесь.": "Trash is empty. Deleted notes and folders will appear here.",
  "Эта папка корзины пуста.": "This trash folder is empty.",
  "Папки": "Folders",
  "Заметки": "Notes",
  "Удалить навсегда": "Delete forever",
  "Удалить навсегда?": "Delete forever?",
  "Удалить папку \"{name}\" и всё внутри навсегда?": "Delete folder \"{name}\" and everything inside forever?",
  "Не удалось очистить корзину": "Failed to clear trash",

  // ─── Вид изображений ───
  "Удалить файл": "Delete file",
  "Используется , удалить нельзя": "In use, cannot delete",
  "Не удалось удалить некоторые файлы": "Failed to delete some files",

  // ─── Календарь ───
  "Календарь": "Calendar",
  "Заметка дня": "Daily note",
  "Запланировать дело": "Schedule a task",
  "Запланировать на весь день": "Schedule for the whole day",
  "Открыть день": "Open day",
  "Предыдущая неделя": "Previous week",
  "Предыдущий месяц": "Previous month",
  "Следующая неделя": "Next week",
  "Следующий месяц": "Next month",
  "Открыть · ПКМ , запланировать": "Open · Right-click to schedule",
  "Удалить задачу": "Delete task",
  "Запланировать дело…": "Schedule a task…",
  "Ссылка не похожа на iCal-фид. Похоже, это ссылка для встраивания (/embed/…), а нужна ссылка экспорта: в Яндекс.Календаре наведите на название календаря , значок настроек , вкладка «Экспорт» , формат iCal.": "Link doesn't look like an iCal feed. It looks like an embed link, but an export link is needed: in Yandex.Calendar, hover over the calendar name, settings icon, \"Export\" tab, iCal format.",

  // ─── Граф ───
  "Физика": "Physics",
  "Настройки физики": "Physics settings",
  "Вместить": "Fit",
  "Вместить весь граф": "Fit entire graph",
  "Фильтр по тегам": "Tags filter",
  "Таймлайн (по дате создания)": "Timeline (by creation date)",
  "Симуляция": "Simulation",
  "Активна": "Active",
  "Пауза": "Paused",
  "Отталкивание": "Repulsion",
  "Разделение островов": "Island separation",
  "Отталкивание в холле": "Hull repulsion",
  "Сплочённость": "Cohesion",
  "Трение (инерция)": "Friction (inertia)",
  "Глубина связей": "Link depth",
  "Порог подписей": "Label threshold",
  "Цвет узлов": "Node color",
  "По типу": "By type",
  "По папке": "By folder",
  "Связи (линии)": "Links (lines)",
  "Показать": "Show",
  "Скрыть": "Hide",
  "Дыхание капель": "Link breathing",
  "Мини-карта": "Minimap",
  "Граф пуст": "Graph is empty",
  "Поиск тегов…": "Search tags…",
  "Нет тегов": "No tags",
  "Открыть заметку": "Open note",
  "Открыть в Файлах": "Open in Files",
  "Фокус на узле": "Focus on node",
  "Открепить": "Unpin",
  "Закрепить": "Pin",
  "Время": "Time",
  "Таймлайн": "Timeline",
  "всё время": "all time",
  "по": "by",
  "Засеять": "Seed",
  "Очистить тест": "Clear test",
  "Пустая заметка": "Empty note",
  "Вкл": "On",
  "Выкл": "Off",
  "Сколько записей создать": "How many records to create",
  "Сбросить фильтр": "Reset filter",
  "Показывать только эти": "Show only these",
  "Исключить эти": "Exclude these",

  // ─── Командная палитра ───
  "Создать новую": "Create a new one",
  "Создать в корне": "Create in root",
  "Изменить заголовок": "Change title",
  "Прошлые версии заметки": "Past versions of the note",
  "Сохранить как шаблон…": "Save as template…",
  "Текущая заметка как шаблон": "Current note as template",
  "Шаблоны…": "Templates…",
  "Управление шаблонами": "Template management",
  "Шаблон заметки дня": "Daily note template",
  "Изменить структуру": "Change structure",
  "Перейти в галерею": "Go to gallery",
  "Поиск по тексту заметки…": "Search by note text…",
  "Поиск по графу (папки, заметки, теги)…": "Search graph (folders, notes, tags)…",
  "Поиск заметок, действий…": "Search notes, actions…",
  "Перейти": "Go to",
  "Шаблоны": "Templates",

  // ─── Шаблоны ───
  "Управление": "Manage",
  "Пока нет шаблонов": "No templates yet",
  "Новое название": "New name",
  "Название нового шаблона": "New template name",
  "Создать": "Create",
  "Название шаблона": "Template name",
  "Название не может быть пустым": "Name cannot be empty",
  "Перезаписать": "Overwrite",
  "Нет открытой заметки": "No open note",
  "Заметка пуста , нечего сохранять как шаблон": "Note is empty, nothing to save as template",
  "Шаблон не может быть пустым": "Template cannot be empty",
  "Не удалось создать шаблон": "Failed to create template",
  "Открыть для редактирования": "Open for editing",

  "Шаблон сохранён": "Template saved",
  "Шаблон переименован": "Template renamed",
  "Шаблон удалён": "Template deleted",
  "Шаблон применён": "Template applied",
  "Шаблон не найден": "Template not found",

  "Поиск emoji...": "Search emoji...",
  "Поиск emoji": "Search emoji",

  "С диска": "From disk",

  "Создать заметку": "Create note",
  "Создать новый": "Create new",

  "эта версия , текущая": "this version, current",

  "Записать мысль или вставить картинку…": "Write a thought or paste an image…",

  "Нет файлов для бэкапа": "No files to backup",
  "Архив пустой": "Archive is empty",

  // ─── Доска ───
  "Загрузка холста…": "Loading canvas…",
  "Экспорт доски в PNG": "Export board to PNG",
  "Отменить (Ctrl+Z)": "Undo (Ctrl+Z)",
  "Повторить (Ctrl+Shift+Z)": "Redo (Ctrl+Shift+Z)",
  "Заливка": "Fill",
  "Обводка": "Stroke",
  "Текст": "Text",
  "Толщина": "Thickness",
  "Прозрачн.": "Opacity",
  "Свой цвет": "Custom color",
  "Имя / таблица": "Name / table",
  "Действие": "Action",
  "Заметка (N)": "Note (N)",

  "Тип ячейки": "Cell type",
  "Тег": "Tag",
  "Настройки колонки": "Column settings",
  "Удалить строку": "Delete row",
  "Название": "Name",

  "Тип выноски": "Callout type",

  "Удалить это изображение": "Delete this image",

  "Недавнее": "Recent",
  "Настроение и слова": "Mood and words",
  "Часто упоминаемые": "Frequently mentioned",
  "Активность за {year}": "Activity in {year}",

  "Просмотр изображения": "Image viewer",

  "Настроение": "Mood",

  "Сохранено": "Saved",
  "Сохраняю…": "Saving…",

  // ─── Множественные числа ───
  "элемент": "item",
  "элемента": "items",
  "элементов": "items",
  "заметку": "note",
  "заметки": "notes",
  "заметок": "notes",
  "папка": "folder",
  "папки": "folders",
  "папок": "folders",

  // ─── Метки undo (store/notes.ts) ───
  "Создание заметки": "Create note",
  "Создание папки": "Create folder",
  "Переименование заметки": "Rename note",
  "Переименование папки": "Rename folder",
  "Перемещение заметки": "Move note",
  "Перемещение папки": "Move folder",
  "Удаление заметки": "Delete note",
  "Удаление папки": "Delete folder",

  // ─── Разное ───
  "Корень": "Root",
  "Хлебные крошки": "Breadcrumbs",
  "Контекстное меню": "Context menu",
  "По умолчанию": "Default",
  "Цвет": "Color",
  "В разработке": "In development",
  "Здесь будут все твои заметки": "All your notes will appear here",
  "Создай первую заметку, нажав «Новая заметку»": "Create your first note by pressing «New note»",
  "Переместить {n} {word} в корзину?": "Move {n} {word} to trash?",
  "заметка": "note",
  "Псевдоним…": "Pseudonym…",
  "Заметка N": "Note {n}",
  "Версия": "Version",
  "Комментарий": "Comment",
  "Дата": "Date",
  "Не удалось создать": "Failed to create",
  "Заметка не найдена": "Note not found",
};

let currentLang: "ru" | "en" = "ru";

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

/**
 * Переводит русскую строку интерфейса на английский (или оставляет как есть при
 * lang=ru).
 *
 * Поддерживает подстановку: t("Удалить {n} элементов", { n: 5 })
 * даёт "Delete 5 items" (en) или "Удалить 5 элементов" (ru).
 */
export function t(
  russian: string,
  vars?: Record<string, string | number>,
): string {
  if (currentLang === "ru") {
    return vars ? interpolate(russian, vars) : russian;
  }
  const template = en[russian] ?? russian;
  return interpolate(template, vars);
}

export function setLanguage(lang: "ru" | "en") {
  currentLang = lang;
}

export function getLanguage(): "ru" | "en" {
  return currentLang;
}

export default en;
