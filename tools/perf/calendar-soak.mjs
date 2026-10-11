/** Run with node --expose-gc. This measures model retention, not browser/native RSS. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

if (!global.gc) throw new Error("Use node --expose-gc tools/perf/calendar-soak.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-calendar-soak-"));
try {
  const result = await build({ entryPoints: ["src/lib/calendarModel.ts"], bundle: true, platform: "node", format: "esm", write: false });
  const file = path.join(temporary, "model.mjs"); await fs.writeFile(file, result.outputFiles[0].text);
  const model = await import(pathToFileURL(file));
  const notes = Array.from({ length: 50000 }, (_, i) => ({ kind: "note", note: { id: `n-${i}`, title: `Note ${i}`, folder: "", createdAt: Date.UTC(2026, 0, 1 + i % 300), tags: [], links: [] } }));
  let tasks = Array.from({ length: 5000 }, (_, i) => ({ id: `t-${i}`, day: "2020-01-01", title: `Task ${i}`, createdAt: i, time: null, repeat: { freq: ["daily", "weekly", "monthly"][i % 3], every: 1 } }));
  let tree = notes.slice();
  const samples = [], start = performance.now(); let visited = 0;
  function batch(round) {
    for (let i = 0; i < 60; i++) {
      const anchor = model.shiftPeriod("2026-10-11", round * 60 + i, "month"), range = model.calendarRange(anchor, "month");
      if (i % 15 === 0) { tree = notes.slice(); tasks = tasks.map((task, index) => index === 0 ? { ...task, title: `Revision ${visited}` } : task); }
      const index = model.getCalendarNoteIndex(tree), days = model.getCalendarTaskDays(tasks, range.from, range.to);
      model.calendarDays(index, days, new Map(), range, model.DEFAULT_CALENDAR_FILTERS);
      visited++;
    }
  }
  for (let round = 0; round < 8; round++) { batch(round); global.gc(); samples.push({ visited, heapUsedBytes: process.memoryUsage().heapUsed }); }
  console.log(JSON.stringify({ scope: "Node model heap after explicit GC; excludes React, native WebKit and application bootstrap", notes: notes.length, tasks: tasks.length, visitedRanges: visited, metadataRevisions: visited / 15, elapsedMs: performance.now() - start, samples, retainedGrowthAfterWarmupBytes: samples.at(-1).heapUsedBytes - samples[1].heapUsedBytes }, null, 2));
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
