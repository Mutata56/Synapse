import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const baseline = process.argv[2] ?? "664129e";
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-calendar-bench-"));
async function moduleFor(name, source, resolveDir) {
  const result = await build({ stdin: { contents: source, resolveDir, loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm" });
  const file = path.join(temporary, `${name}.mjs`);
  await fs.writeFile(file, result.outputFiles[0].text);
  return import(pathToFileURL(file));
}
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  const oldSource = execFileSync("git", ["show", `${baseline}:src/lib/tasks.ts`], { encoding: "utf8" });
  const before = await moduleFor("before", oldSource, path.resolve("src/lib"));
  const after = await moduleFor("after", await fs.readFile("src/lib/tasks.ts", "utf8"), path.resolve("src/lib"));
  const model = await moduleFor("model", await fs.readFile("src/lib/calendarModel.ts", "utf8"), path.resolve("src/lib"));
  const tasks = Array.from({ length: 5000 }, (_, i) => ({ id: `t-${i}`, day: "2020-01-01", title: `Task ${i}`, time: null, repeat: { freq: ["daily", "weekly", "monthly"][i % 3], every: 1 }, done: false, createdAt: i, updatedAt: i }));
  const measure = library => { const times = []; let count = 0; for (let run = 0; run < 14; run++) { const start = performance.now(); count = 0; for (const task of tasks) { count += library.occurrencesInRange(task, "2026-09-28", "2026-11-08").length; count += library.occurrencesInRange(task, "2026-10-01", "2026-10-31").length; } if (run > 1) times.push(performance.now() - start); } return { medianMs: median(times), count }; };
  const beforeResult = measure(before), afterResult = measure(after);
  if (beforeResult.count !== afterResult.count) throw new Error("Recurrence output changed");
  const tree = Array.from({ length: 50000 }, (_, i) => ({ kind: "note", note: { id: `note-${i}`, title: `Note ${i}`, folder: "", createdAt: new Date(2026, 0, 1 + i % 300, 12).getTime(), updatedAt: i, favorite: false, tags: [], links: [], preview: "", icon: null, cover: null } }));
  const start = performance.now(), index = model.getCalendarNoteIndex(tree), coldNoteIndexMs = performance.now() - start;
  const range = model.calendarRange("2026-10-11", "month"), taskStart = performance.now();
  const taskDays = model.getCalendarTaskDays(tasks, range.from, range.to), coldVisibleTaskIndexMs = performance.now() - taskStart;
  const times = [];
  for (let i = 0; i < 32; i++) { const start = performance.now(); model.getCalendarNoteIndex(tree); model.getCalendarTaskDays(tasks, range.from, range.to); model.calendarDays(index, taskDays, new Map(), range, model.DEFAULT_CALENDAR_FILTERS); index.byDay.get(range.days[i % 42]); if (i > 1) times.push(performance.now() - start); }
  console.log(JSON.stringify({ baseline, recurringTasks: tasks.length, notes: tree.length, beforeSameWork: beforeResult, afterSameWork: afterResult, coldNoteIndexMs, coldVisibleTaskIndexMs, warmModelMedianMs: median(times), warmModelP95Ms: times.slice().sort((a, b) => a - b)[Math.floor(times.length * .95)], visibleDays: range.days.length }, null, 2));
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
