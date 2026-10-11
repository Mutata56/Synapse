import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwindcss(), { name: 'calendar-read-counter', enforce: 'pre', transform(code, id) { if (!id.endsWith('/src/lib/storage.ts')) return; return code.replace('export async function readNote(', 'async function originalReadNote(') + '\nexport async function readNote(...args) { window.dispatchEvent(new Event("calendar-fixture-read")); return originalReadNote(...args); }'; } }], server: { port: 1443, host: '127.0.0.1', strictPort: true } });
