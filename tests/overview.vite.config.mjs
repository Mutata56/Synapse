import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Browser fixture only: search uses synthetic documents, not native storage.
export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: "overview-fixture-search",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/src/lib/fullTextSearch.ts")) return;
      return code.replace("export async function buildSearchDocs(", "async function originalBuildSearchDocs(") + `
        export const buildSearchDocs = async notes => {
          const ids = new Set(notes.map(note => note.id));
          return window.overviewFixtureDocuments.filter(doc => ids.has(doc.note.id));
        };
      `;
    },
  }],
  resolve: {
    alias: {
      "decode-named-character-reference": fileURLToPath(new URL("../node_modules/decode-named-character-reference/index.js", import.meta.url)),
    },
  },
  server: { port: 1442, strictPort: true, host: "127.0.0.1" },
});
