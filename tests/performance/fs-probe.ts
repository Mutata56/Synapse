import * as actual from "../../node_modules/@tauri-apps/plugin-fs/dist-js/index.js";
import { metrics } from "./probe";
export * from "../../node_modules/@tauri-apps/plugin-fs/dist-js/index.js";

function wrap<K extends keyof typeof actual>(name: K): typeof actual[K] {
  return (async (...args: unknown[]) => {
    const key = String(name), path = String(args[0] ?? "");
    metrics.fs[key] = (metrics.fs[key] ?? 0) + 1;
    if ((key === "readFile" || key === "readTextFile") && path.endsWith(".md"))
      metrics.fs.markdownReads = (metrics.fs.markdownReads ?? 0) + 1;
    const started = performance.now();
    try { return await (actual[name] as (...args: unknown[]) => Promise<unknown>)(...args); }
    finally { metrics.fsMs[key] = (metrics.fsMs[key] ?? 0) + performance.now() - started; }
  }) as typeof actual[K];
}
export const readFile = wrap("readFile"), readTextFile = wrap("readTextFile"), readDir = wrap("readDir"), stat = wrap("stat"), exists = wrap("exists");
export const writeTextFile = wrap("writeTextFile"), writeFile = wrap("writeFile"), rename = wrap("rename"), copyFile = wrap("copyFile"), remove = wrap("remove"), mkdir = wrap("mkdir");
