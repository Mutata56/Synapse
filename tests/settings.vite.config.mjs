import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config.ts';

// Every preview body and path is synthetic. This server never reads a vault.
export default defineConfig(async () => mergeConfig(await base({}), {
  plugins: [{ name: 'settings-preview-storage', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/lib/fullTextSearch.ts')) return code.replace('export async function buildSearchDocs(', 'async function originalBuildSearchDocs(') + `
      export const buildSearchDocs = async notes => {
        const ids = new Set(notes.map(note => note.id));
        return (window.settingsPreviewDocuments ?? []).filter(doc => ids.has(doc.note.id));
      };
    `;
    if (id.endsWith('/src/lib/storage.ts')) return code.replace('export async function getWorkspaceDir(', 'async function originalGetWorkspaceDir(').replace('export async function listVaultFiles(', 'async function originalListVaultFiles(') + `
      export const getWorkspaceDir = async () => '/demo/Synapse Vault';
      export const listVaultFiles = async () => [];
    `;
  }}],
  server: { port: 1478, strictPort: true, host: '127.0.0.1' },
}));
