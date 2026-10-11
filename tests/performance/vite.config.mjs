import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const here = name => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  root, plugins: [react(), tailwindcss(), {
    name: "opt-in-native-profile",
    enforce: "pre",
    transformIndexHtml: { order: "pre", handler(html) { return html.replace('/src/main.tsx', '/tests/performance/native-main.ts'); } },
    transform(code, id) {
      if (process.env.SYNAPSE_PERF_UNMEMOIZED === "1" && id.includes("/src/components/FileQuickPreview.tsx"))
        return code.replace(/memo\(FileQuickPreview\)/g, "FileQuickPreview");
    },
  }],
  resolve: { alias: {
    "react-markdown": here("markdown-probe.tsx"),
    "@tauri-apps/plugin-fs": here("fs-probe.ts"),
    "decode-named-character-reference": fileURLToPath(new URL("../../node_modules/decode-named-character-reference/index.js", import.meta.url)),
  } },
  build: { outDir: "dist-perf", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 1468, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/.impeccable/**"] } },
});
