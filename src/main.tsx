import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CaptureWindow } from "./components/CaptureWindow";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LanguageProvider } from "./components/LanguageProvider";


/*
 * Порядок импорта CSS здесь критически важен:
 * 1. Сначала идут базовые стили библиотек.
 * 2. Файл `index.css` идет ПОСЛЕДНИМ, чтобы глобальные стили и Tailwind могли их перебивать.
 * Не менять ни в коем случае!!
 */
import "@mantine/core/styles.css";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./index.css";

// ─── Константы ─────────────────────────────────────────────────────────────

const ROOT_ID = "root";
const APP_LANG = "ru";

// ─── Локаль (двойная страховка) ──────────────────────────────────────────
// Двойная страховка для локализации:
// В index.html по умолчанию стоит lang="en". Преопределяю язык в рантайме.
// чтобы экранные дикторы сразу правильно озвучивали интерфейс
document.documentElement.lang = APP_LANG;

// ─── ДЕВ ОНЛИ ─────────────────────────────────────
// IPC-запросы в Tauri возвращают Promises. Если где-то забыть `.catch` или `try/catch`,
// ошибка упадет в консоль без внятного контекста. Эти слушатели добавляют тег к ошибкам,
// чтобы такие «забытые» асинхронные сбои было легко найти в DevTools.
// todo: удалить или отключить
function installDevDiagnostics(): void {
  const onRejection = (e: PromiseRejectionEvent) => {
    console.error("[unhandledrejection]", e.reason);
  };
  const onError = (e: ErrorEvent) => {
  // Различаем типы ошибок:
  // - При сбое загрузки ресурсов (например, картинка <img> вернула 404) поле `.error` будет пустым, а описание упадет в `.message`.
  // - При обычных ошибках в коде (runtime) всё происходит ровно наоборот.
    console.error("[window.error]", e.error ?? e.message ?? "(unknown)");
  };
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("error", onError);

  // Tauri спамит предупреждениями, если во время долгого запроса к Rust
  // страница перезагружается из-за HMR. Это забивает консоль, но ни на что не влияет.
  // Метод глушит конкретно это сообщение, остальные предупреждения пропускаем.
  const origWarn = console.warn;
  console.warn = (...args: Parameters<typeof console.warn>): void => {
    if (typeof args[0] === "string" && args[0].includes("Couldn't find callback id")) {
      return;
    }
    origWarn.apply(console, args);
  };

  // Из-за HMR этот модуль может выполняться повторно при сохранении.
  // Если не удалять старые слушатели, они будут копиться, и одна ошибка запишется в консоль N раз.
  // Опциональная цепочка (?.) нужна для продакшена, где объекта `import.meta.hot` просто нет.
  import.meta.hot?.dispose(() => {
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("error", onError);
    console.warn = origWarn;
  });
}

if (import.meta.env.DEV) {
  installDevDiagnostics();
}

// ─── Бутстрап ─────────────────────────────────────────────────────────────

const container = document.getElementById(ROOT_ID);
if (!container) {
  // Падаем с ошибкой
  // `Cannot read properties of null (reading 'parentNode')` на пустом экране Tauri,
  // если что-то пойдет не так с монтированием приложения.
  throw new Error(
    `Корневой элемент "#${ROOT_ID}" не найден в index.html.`,
  );
}

// Один бандл , два окна: окно быстрого захвата  рендерит
// только свой интерфейс (проверяем по названию окна Tauri), во всех остальных случаях запускается полное приложение.
const isCaptureWindow = getCurrentWindow().label === "capture";

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        {isCaptureWindow ? <CaptureWindow /> : <App />}
      </LanguageProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
