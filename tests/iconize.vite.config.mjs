import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {fileURLToPath} from "node:url";
export default defineConfig({
 plugins:[react(),tailwindcss(),{name:"iconize-fixture-core",enforce:"pre",resolveId(id){if(id==="@tauri-apps/api/core")return "\0iconize-core";if(id==="@tauri-apps/api/path")return "\0iconize-path";},load(id){if(id==="\0iconize-core")return "export const isTauri=()=>false; export const convertFileSrc=p=>p; export const invoke=async name=>{throw Error('Fixture native command: '+name)};";if(id==="\0iconize-path")return "export const appDataDir=async()=>'/fixture'; export const join=async(...parts)=>parts.join('/');";}}],
 resolve:{alias:{"@tauri-apps/plugin-fs":fileURLToPath(new URL("./ui/iconize-fs-mock.ts",import.meta.url)),"decode-named-character-reference":fileURLToPath(new URL("../node_modules/decode-named-character-reference/index.js",import.meta.url))}},
 server:{port:1468,host:"127.0.0.1",strictPort:true,fs:{allow:[fileURLToPath(new URL("..",import.meta.url)),"/Users/kirill/projects/Synapse/node_modules"]}},
});
