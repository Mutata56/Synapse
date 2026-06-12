import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Динамическое определение хоста для разработки внутри окружения Tauri
// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
/**
 * Конфигурация Vite, оптимизированная для работы с Tauri.
 * Включает интеграцию с React, Tailwind CSS и настраивает локальный сервер
 * так, чтобы Tauri-клиент мог корректно подключаться к нему и поддерживать HMR.
 */
export default defineConfig(async () => ({
  // TODO: продакшен-бандл >500КБ (подсветка кода + pixi тянут много). Разбить
  // ручными build.rollupOptions.output.manualChunks, когда дойдут руки.
  plugins: [react(), tailwindcss()],

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
