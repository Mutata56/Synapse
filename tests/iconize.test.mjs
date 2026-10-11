import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { fixture } from "./helpers/workspace.mjs";

const compiled = await build({ entryPoints: ["src/lib/iconize.ts"], bundle: true, platform: "node", format: "esm", write: false });
const core = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
const { emptyIconizeState, importIconizeData, resolveIcon, rebaseIconAssignments, iconKey, coerceIconizeSettings } = core;

test("Iconize import preserves original IDs, colors, settings and manual Synapse choices", () => {
  const current = emptyIconizeState(); current.assignments[iconKey("folder", "Work")] = { icon: "LiWarehouse" };
  const data = importIconizeData({ settings: { emojiStyle: "twemoji", iconInTitlePosition: "inline", recentlyUsedIcons: ["FabJava", "SiPostgresql"] }, Work: "FarMoneyBill1", "Study/Java": "FabJava", "Study/Postgres.md": { iconName: "SiPostgresql", color: "#336791" }, "../escape": "LiCode" }, current);
  assert.equal(data.settings.emojiStyle, "twemoji"); assert.equal(data.settings.iconInTitlePosition, "inline");
  assert.equal(resolveIcon(data, "folder", "Work").icon, "LiWarehouse");
  assert.deepEqual(resolveIcon(data, "file", "Study/Postgres.md"), { icon: "SiPostgresql", color: "#336791", inherit: false });
  assert.equal(Object.keys(data.assignments).length, 3);
});

test("manual overrides, configurable frontmatter, folder inheritance and ordered rules have stable precedence", () => {
  const state = emptyIconizeState();
  state.settings.rules = [{ id: "folder", rule: ".", icon: "LiFolder", order: 0, for: "folders" }, { id: "java", rule: "Java", icon: "FabJava", order: 1, for: "files" }, { id: "fallback", rule: ".", icon: "LiFileText", order: 3 }];
  state.settings.iconInFrontmatterFieldName = "glyph"; state.settings.iconColorInFrontmatterFieldName = "glyphColor";
  assert.equal(resolveIcon(state, "file", "Study/Java.md").icon, "FabJava");
  assert.equal(resolveIcon(state, "folder", "Study/Java").icon, "LiFolder");
  assert.equal(resolveIcon(state, "file", "Study/Java.md", { frontmatterIcons: { glyph: "SiPostgresql", glyphColor: "#336791" } }).icon, "SiPostgresql");
  state.settings.iconInFrontmatterEnabled = false;
  assert.equal(resolveIcon(state, "file", "Study/Java.md", { icon: "SiPostgresql", frontmatterIcons: { glyph: "SiPostgresql" } }).icon, "FabJava");
  state.settings.iconInFrontmatterEnabled = true;
  state.assignments["folder:Study"] = { icon: "LiBook", inherit: true };
  assert.equal(resolveIcon(state, "file", "Study/Nested/Java.md").icon, "LiBook");
  state.assignments["file:Study/Nested/Java.md"] = { icon: null };
  assert.equal(resolveIcon(state, "file", "Study/Nested/Java.md"), null);
  state.assignments["file:Study/Nested/Java.md"] = { icon: "LiCode" };
  assert.equal(resolveIcon(state, "file", "Study/Nested/Java.md").icon, "LiCode");
  assert.equal(resolveIcon(state, "file", "Other.md").icon, "LiFileText");
});

test("legacy inheritance, disabled rules, invalid regular expressions and unsafe settings remain recoverable", () => {
  const state = importIconizeData({ settings: { rules: [{ rule: "[literal", icon: "LiCode", order: 0 }] }, Docs: { iconName: "LiFolder", inheritanceIcon: "LiBook", inheritanceIconColor: "#aabbcc" } });
  assert.equal(resolveIcon(state, "file", "Docs/Nested/File.md").icon, "LiBook");
  assert.equal(resolveIcon(state, "file", "[literal.md").icon, "LiCode");
  state.settings.rules = [{ rule: ".", icon: "LiCode", id: "off", order: 0, enabled: false }];
  assert.equal(resolveIcon(state, "file", "Elsewhere.md"), null);
  const coerced = coerceIconizeSettings({ fontSize: 999, recentlyUsedIconsSize: -5, iconColor: "url(https://bad)", iconIdentifier: ".*", extraMargin: { left: 999 }, rules: [null, { rule: 5, icon: "LiCode" }] });
  assert.equal(coerced.fontSize, 48); assert.equal(coerced.iconColor, null); assert.equal(coerced.extraMargin.left, 24); assert.equal(coerced.rules.length, 0);
});

test("rebasing distinguishes same-name folders and files and retains nested assignments", () => {
  const state = emptyIconizeState();
  state.assignments = { "folder:Same": { icon: "LiFolder" }, "file:Same.md": { icon: "LiCode" }, "file:Same/Note.md": { icon: "FabJava" }, "folder:Same/Nested": { icon: "LiBook" } };
  const moved = rebaseIconAssignments(state, "Same", "Other/Same", true);
  assert.equal(moved.assignments["file:Same.md"].icon, "LiCode");
  assert.equal(moved.assignments["file:Other/Same/Note.md"].icon, "FabJava");
  assert.equal(moved.assignments["folder:Other/Same/Nested"].icon, "LiBook");
  assert.equal(state.assignments["folder:Same"].icon, "LiFolder");
});

test("icon choices survive filesystem moves, folder rename, trash and restore without changing source bytes", async t => {
  const source = "---\nicon: SiPostgresql\niconColor: '#336791'\ncustom: keep me\n---\n# Body\n:FabJava: and [[Other]]\n";
  const f = await fixture(t, { "Folder/Note.md": source });
  await f.storage.updateIconizeData(data => ({ ...data, assignments: { "folder:Folder": { icon: "LiWarehouse", inherit: true }, "file:Folder/Note.md": { icon: "FabJava", color: "#ff0000" } } }));
  await f.storage.renameFolder("Folder", "Renamed");
  assert.equal((await f.storage.readIconizeData()).assignments["file:Renamed/Note.md"].icon, "FabJava");
  assert.equal(await f.read("Renamed/Note.md"), source);
  const trashed = await f.storage.trashNote("Renamed/Note");
  assert.equal((await f.storage.readIconizeData()).assignments["file:.trash/" + trashed + ".md"].icon, "FabJava");
  const restored = await f.storage.restoreFromTrash(trashed);
  assert.equal((await f.storage.readIconizeData()).assignments["file:" + restored.path + ".md"].icon, "FabJava");
  assert.equal(await f.read(restored.path + ".md"), source);
  const note = await f.storage.readNote(restored.path);
  assert.equal(note.frontmatterIcons.custom, "keep me"); assert.equal(note.iconColor, "#336791");
});

test("concurrent icon edits serialize and a failed disk write keeps the last successful state", async t => {
  const f = await fixture(t, { "Note.md": "Body" });
  await Promise.all(["A", "B", "C"].map(path => f.storage.updateIconizeData(data => ({ ...data, assignments: { ...data.assignments, ["folder:" + path]: { icon: "LiFolder" } } }))));
  const before = await f.storage.readIconizeData(); assert.equal(Object.keys(before.assignments).length, 3);
  f.interceptWrite((name) => { if (name.includes("iconize.json")) throw new Error("Disk unavailable"); });
  await assert.rejects(f.storage.updateIconizeData(data => ({ ...data, assignments: {} })), /Disk unavailable/);
  assert.equal(await f.storage.readIconizeData(), before);
  assert.equal(JSON.parse(await f.read(".synapse/iconize.json")).assignments["folder:A"].icon, "LiFolder");
});

test("No icon survives persisted reload and still suppresses automatic and frontmatter icons", async t => {
  const f = await fixture(t, { "Note.md": "---\nicon: FabJava\n---\nBody" });
  await f.storage.updateIconizeData(data => ({ ...data, assignments: { "file:Note.md": { icon: null } }, settings: { ...data.settings, rules: [{ id: "all", rule: ".", icon: "LiCode", order: 0 }] } }));
  f.storage.resetStorageCaches();
  const state = await f.storage.readIconizeData();
  assert.deepEqual(state.assignments["file:Note.md"], { icon: null, color: null, inherit: false });
  assert.equal(resolveIcon(state, "file", "Note.md", { icon: "FabJava" }), null);
});

test("a failed icon staging write cannot move a Markdown file", async t => {
  const f = await fixture(t, { "Note.md": "Original bytes" });
  await f.storage.updateIconizeData(data => ({ ...data, assignments: { "file:Note.md": { icon: "FabJava" } } }));
  f.interceptWrite((name) => { if (name.includes("iconize.json")) throw new Error("Icon metadata disk failure"); });
  await assert.rejects(f.storage.moveNote("Note", "Folder"), /disk failure/);
  assert.equal(await f.read("Note.md"), "Original bytes");
  assert.equal((await f.storage.readIconizeData()).assignments["file:Note.md"].icon, "FabJava");
});

test("the complete offline catalog has unique resolvable symbols in all 13 upstream packs", async () => {
  const manifest = JSON.parse(await fs.readFile("public/iconize/manifest.json"));
  assert.equal(manifest.packs.length, 13); const seen = new Set(); let count = 0;
  for (const pack of manifest.packs) {
    const icons = JSON.parse(await fs.readFile("public/iconize/" + pack.id + ".json"));
    const sprite = await fs.readFile("public/iconize/" + pack.id + ".svg", "utf8");
    const symbols = new Set([...sprite.matchAll(/<symbol[^>]*\bid="([^"]+)"/g)].map(match => match[1]));
    assert.equal(icons.length, pack.count); assert.equal(symbols.size, pack.count);
    for (const [id] of icons) { assert(!seen.has(id), "Duplicate " + id); seen.add(id); assert(symbols.has(id), "Missing symbol " + id); }
    assert(!/<script|foreignObject|\son\w+=|https?:\/\/(?!www.w3.org)/i.test(sprite)); count += icons.length;
  }
  for (const id of ["FabJava", "SiPostgresql", "FarMoneyBill1", "LiWarehouse", "LiAlarmClockMinus", "LiAirplay", "LiUniversity"]) assert(seen.has(id), "Imported icon is available: " + id);
  assert.equal(count, 18530);
  assert((JSON.parse(await fs.readFile("public/iconize/emojis.json"))).length >= 1800);
});
