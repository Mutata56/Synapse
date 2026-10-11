import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export default defineConfig({
  cacheDir: join(tmpdir(), "synapse-cmd-click-vite-cache"),
  plugins: [react(), tailwindcss(), { name: "cmd-click-fixture", enforce: "pre",
    resolveId(id) { if (id === "@tauri-apps/api/core") return "\0cmd-click-core"; },
    load(id) { if (id === "\0cmd-click-core") return "export const isTauri=()=>false; export const convertFileSrc=p=>p; export const invoke=async()=>{throw Error('Synthetic fixture has no native storage')};"; },
  }],
  resolve: { dedupe: ["react", "react-dom"], alias: { "decode-named-character-reference": fileURLToPath(new URL("../node_modules/decode-named-character-reference/index.js", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 1489, strictPort: true, fs: { allow: [fileURLToPath(new URL("..", import.meta.url)), realpathSync(fileURLToPath(new URL("../node_modules", import.meta.url)))] } },
});
