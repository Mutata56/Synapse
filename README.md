# Synapse

Приложение для личных заметок - редактирование в стиле Notion с графом связей в стиле Obsidian.

Файлы в формате Markdown на диске, [[вики-ссылки]], обратные ссылки (backlinks), теги, ежедневные заметки, календарь и интерактивный граф связей (force-directed graph), показывающий, как всё связано между собой.

Стек: Tauri 2 (Rust) + React + TypeScript + Vite.

## Разработка (Dev)

```bash
npm install
npm run tauri dev
```

Первая сборка на Rust скачивает и компилирует все зависимости (crates) Tauri, поэтому она занимает несколько минут; последующие сборки будут инкрементальными (быстрыми).

## Build

```bash
npm run tauri build
```

## Где хранятся заметки

Обычные `.md` файлы в директории данных приложения:

- Linux: `~/.local/share/com.kirill.synapse/notes`
- Windows: `%APPDATA%\com.kirill.synapse\notes`

## Лицензия

GPL-3.0, см. [LICENSE](LICENSE).
