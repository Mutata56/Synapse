# Synapse

Приложение для личных заметок: редактирование в стиле Notion и граф связей в стиле Obsidian в одном окне. Десктоп, работает офлайн, заметки лежат на диске обычными Markdown-файлами - никаких облаков и баз, всё своё.

Стек: Tauri 2 (Rust) + React + TypeScript + Vite. Состояние на Zustand, редактор на BlockNote, граф связей на Pixi.js.

<!-- Демо вставлю позже. Лучше короткие клипы (.mp4/.webm) через загрузку в веб-редакторе
     GitHub, чем гифки в репозитории. Либо картинки из docs/screenshots/. -->

## Установка

Готовый установщик под свою систему - на странице [Releases](https://github.com/Mutata56/Synapse/releases):

- Linux - `.AppImage` (сделать исполняемым и запустить) либо `.deb` / `.rpm`;
- Windows - `.msi` или `.exe`;
- macOS - `.dmg`.

**Arch Linux** - из AUR: `yay -S synapse-notes`. Пакет собирается из исходников и линкуется с системным WebKitGTK, поэтому интерфейс рисуется корректно - у AppImage на свежих rolling-системах вроде Arch бывает пустой серый экран из-за вшитого в него старого WebKitGTK. PKGBUILD лежит в [packaging/arch/](packaging/arch/).

## Архитектура

Как устроены граф связей (собственный физический движок + Pixi.js), интерактивная доска (свой Canvas-движок), файловая система и Rust-бэкенд - в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Сборка из исходников

Нужны Node.js и Rust. Под Linux ещё системные библиотеки: WebKitGTK (`webkit2gtk-4.1`), GTK 3 и librsvg.

Режим разработки:

```bash
npm install
npm run tauri dev
```

Первая Rust-сборка тянет и компилирует зависимости Tauri, поэтому идёт несколько минут; последующие инкрементальные и быстрые.

Собрать установщик:

```bash
npm run tauri build
```

Файлы появятся в `src-tauri/target/release/bundle/`.

## Где лежат заметки

Обычные `.md` в папке данных приложения:

- Linux: `~/.local/share/com.kirill.synapse/notes`
- Windows: `%APPDATA%\com.kirill.synapse\notes`
- macOS: `~/Library/Application Support/com.kirill.synapse/notes`

## Что умеет

**Связи**
- [[Вики-ссылки]] с автодополнением, обратные ссылки (backlinks) и блок неупомянутых связей.


<img width="1382" height="757" alt="image" src="https://github.com/user-attachments/assets/b9a84b75-ee7e-4d27-9d0b-4b2f3f6ab6b4" />
  
- Теги `#тег` и отдельная страница со всеми тегами.


<img width="2554" height="1380" alt="Теги" src="https://github.com/user-attachments/assets/6270d441-b8ad-486e-9928-0847062d50d4" />


- Граф связей (force-directed) на весь воркспейс и локальный граф вокруг открытой заметки.



https://github.com/user-attachments/assets/9db144f0-f82d-4251-ba05-e5130e225cc1

<img width="800" height="427" alt="1" src="https://github.com/user-attachments/assets/8e41d13e-689e-4843-be50-88c11db000ef" />



**Организация**
- Дерево папок, избранное, входящие, галерея заметок.

<img width="2200" height="565" alt="image" src="https://github.com/user-attachments/assets/42dfb822-4d09-4bf1-a013-088bdca2411e" />

<img width="2185" height="951" alt="image" src="https://github.com/user-attachments/assets/3448777c-3fd9-4578-a1d2-f5ee4b65c4b9" />

  
- Командная палитра (Ctrl/Cmd + K) и быстрый поиск.

<img width="566" height="569" alt="image" src="https://github.com/user-attachments/assets/3f42fb29-7372-4b34-bf94-d1ccca0c3c04" />


- Заметка дня и быстрая заметка по глобальному хоткею - ловится, даже когда окно свёрнуто в трей.


**Редактор**
- Блочный редактор (BlockNote) с кастомными блоками: выноски, таблицы, галереи и карусели, карточки файлов, встроенные базы данных, мультиколонки.


  
- Интерактивная доска прямо внутри заметки - фигуры, связи, рисование от руки.

<img width="2553" height="1360" alt="image" src="https://github.com/user-attachments/assets/958b9c62-9d29-492a-9f30-be2e5a60379a" />

  
- Обложки, эмодзи и отметка настроения у заметок.

<img width="2556" height="1383" alt="скрин 1" src="https://github.com/user-attachments/assets/b360ff14-a7d9-44b1-b8b0-c49a5c0bc3fd" />

<img width="2559" height="1385" alt="скрин 2" src="https://github.com/user-attachments/assets/eeab9768-832e-48e4-aa02-a6ecde542973" />
  
**Календарь**
- События и задачи, повторяющиеся задачи, цвета и метки.
- Подписка на внешний календарь по ссылке iCalendar (.ics, только чтение).
- Отправка своих задач в Яндекс.Календарь через CalDAV.

<img width="2532" height="1362" alt="image" src="https://github.com/user-attachments/assets/d3d06948-526d-4375-912d-6d216ef09d82" />

<img width="2210" height="1341" alt="image" src="https://github.com/user-attachments/assets/465a4660-16a1-470a-be24-3b35a7f03c5c" />


**Данные**
- Хранение в обычных `.md` - заметки можно открыть и без приложения.
- Корзина с превью и восстановлением, история версий, бэкап и восстановление в .zip.

<img width="890" height="1097" alt="image" src="https://github.com/user-attachments/assets/ff5c9143-d32f-4f74-b014-176120661fdb" />

<img width="2219" height="574" alt="image" src="https://github.com/user-attachments/assets/daa47c56-eaae-43e5-b81c-3872cac5393e" />


  
- Дашборд со статистикой письма.

<img width="1229" height="961" alt="image" src="https://github.com/user-attachments/assets/05b00438-d40f-4b9b-83a6-1a27d44e99af" />

  
- Тёмная тема, свой акцентный цвет, интерфейс на русском и английском.



## Лицензия

GPL-3.0, см. [LICENSE](LICENSE).
