// Local, ignored graph data for comparing a copied vault with its Obsidian view.
import { readFile, writeFile, stat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

if (!process.argv[2]) throw new Error("Usage: node scripts/export-graph-fixture.mjs /path/to/copied/notes");
const source = resolve(process.argv[2]), root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "synapse-graph-export-"));
try {
  const bundle = join(temporary, "helpers.mjs");
  await build({ entryPoints: [join(root, "src/lib/obsidianImport.ts")], bundle: true, platform: "node", format: "esm", outfile: bundle });
  const { splitMarkdownSource, boundedVaultPath } = await import(pathToFileURL(bundle));
  const manifest = JSON.parse(await readFile(join(source, ".synapse/obsidian-import.json"), "utf8"));
  const documents = [], tree = [], folders = new Map([["", tree]]);
  for (const name of manifest.notePaths) {
    if (!boundedVaultPath(name) || !name.endsWith(".md")) throw new Error("Invalid manifest note path");
    const path = join(source, name), attributes = await stat(path);
    const id = name.slice(0, -3), folder = dirname(id) === "." ? "" : dirname(id);
    const body = splitMarkdownSource(await readFile(path, "utf8")).body;
    const note = { id, title: basename(id), folder, createdAt: attributes.birthtimeMs, updatedAt: attributes.mtimeMs, icon: null, cover: null, preview: "", favorite: false, tags: [], links: [], mood: null, markdownSource: true };
    documents.push({ note, body, bodyLower: body.toLowerCase(), titleLower: note.title.toLowerCase() });
    let parent = "";
    for (const segment of folder.split("/").filter(Boolean)) {
      const next = parent ? `${parent}/${segment}` : segment;
      if (!folders.has(next)) { const children = []; folders.get(parent).push({ kind: "folder", name: segment, path: next, children }); folders.set(next, children); }
      parent = next;
    }
    folders.get(folder).push({ kind: "note", note });
  }
  let obsidianSettings;
  try { obsidianSettings = JSON.parse(await readFile(join(source, ".obsidian/graph.json"), "utf8")); } catch { /* optional */ }
  const target = join(root, "tests/fixtures/graph-vault.json");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({ documents, tree, obsidianSettings }));
  console.log(`Exported ${documents.length} notes to ignored local fixture ${target}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
