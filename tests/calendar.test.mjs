import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { fixture } from "./helpers/workspace.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-calendar-tests-"));
async function compiled(entry, plugins = []) {
  const result = await build({ entryPoints: [path.join(root, entry)], bundle: true, write: false, platform: "node", format: "esm", plugins });
  const file = path.join(temporary, `${Math.random().toString(36).slice(2)}.mjs`);
  await fs.writeFile(file, result.outputFiles[0].text);
  return import(pathToFileURL(file));
}
const model = await compiled("src/lib/calendarModel.ts"), recurrence = await compiled("src/lib/tasks.ts"), ics = await compiled("src/lib/ics.ts");
const note = (id, day, extra = {}) => ({ id, title: id, folder: id.split("/")[0], createdAt: model.dateFromDay(day).getTime(), updatedAt: 1, icon: null, cover: null, preview: "", tags: [], links: [], favorite: false, ...extra });
const task = (id, day, extra = {}) => ({ id, day, title: id, time: null, done: false, createdAt: 1, updatedAt: 1, ...extra });

test("month and week share a Monday-based range, including leap dates and year boundaries", () => {
  const month = model.calendarRange("2024-02-29", "month");
  assert.equal(month.days.length, 42); assert.equal(month.from, "2024-01-29"); assert.equal(month.monthTo, "2024-02-29");
  assert.deepEqual(model.calendarRange("2026-01-01", "week").days, ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  assert.equal(model.shiftPeriod("2024-01-31", 1, "month"), "2024-02-29");
  assert.equal(model.shiftPeriod("2024-02-29", 1, "week"), "2024-03-07");
});
test("note dates are indexed once per immutable tree; a backdated daily note belongs to its named day", () => {
  const journal = note("Дневник/2020/2020-01-03", "2026-10-11", { mood: 4 });
  const tree = [{ kind: "folder", children: [{ kind: "note", note: journal }, { kind: "note", note: note("Работа/пример", "2026-10-11") }] }];
  const index = model.getCalendarNoteIndex(tree);
  assert.equal(model.getCalendarNoteIndex(tree), index);
  assert.equal(index.byDay.get("2020-01-03")[0], journal); assert.equal(index.byDay.get("2026-10-11").length, 1);
  assert.equal(index.journals.get("2020-01-03").mood, 4);
  const changed = [...tree, { kind: "note", note: note("Новая", "2026-10-12") }];
  assert.notEqual(model.getCalendarNoteIndex(changed), index); assert.equal(index.byDay.has("2026-10-12"), false);
});
test("recurrence jumps agree with a day-by-day oracle for 31st, leap days, intervals and inclusive until", () => {
  for (const start of ["2020-01-31", "2024-02-29", "2025-12-31"]) for (const freq of ["daily", "weekly", "monthly"]) for (const every of [1, 2, 7]) {
    const value = task("repeat", start, { repeat: { freq, every, until: "2026-11-02" } });
    const expected = [];
    for (let day = "2026-09-28"; day <= "2026-11-08"; day = model.shiftDay(day, 1)) if (recurrence.occursOn(value, day)) expected.push(day);
    assert.deepEqual(recurrence.occurrencesInRange(value, "2026-09-28", "2026-11-08"), expected, JSON.stringify(value));
  }
  const monthly = task("31", "2024-01-31", { repeat: { freq: "monthly", every: 1 } });
  assert.deepEqual(recurrence.occurrencesInRange(monthly, "2024-02-01", "2024-04-30"), ["2024-03-31"]);
  assert.deepEqual(recurrence.occurrencesInRange(monthly, "2025-01-01", "2024-01-01"), []);
  assert.equal(recurrence.isValidDay("2026-02-31"), false); assert.equal(recurrence.isValidDay("2024-02-29"), true);
});
test("daily intervals keep the same calendar dates across DST time zones", () => {
  const previous = process.env.TZ;
  try { for (const zone of ["Europe/Moscow", "America/New_York", "Australia/Lord_Howe"]) {
    process.env.TZ = zone;
    assert.deepEqual(recurrence.occurrencesInRange(task("dst", "2026-03-07", { repeat: { freq: "daily", every: 2 } }), "2026-03-07", "2026-03-13"), ["2026-03-07", "2026-03-09", "2026-03-11", "2026-03-13"]);
  } } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test("visible recurrence indexes are shared and a newer task revision invalidates them", () => {
  const tasks = [task("daily", "2026-10-01", { repeat: { freq: "daily", every: 1 } })];
  const first = model.getCalendarTaskDays(tasks, "2026-10-01", "2026-10-31");
  assert.equal(first, model.getCalendarTaskDays(tasks, "2026-10-01", "2026-10-31")); assert.equal(first.size, 31);
  const next = model.getCalendarTaskDays([{ ...tasks[0], title: "updated" }], "2026-10-01", "2026-10-31");
  assert.notEqual(next, first); assert.equal(next.get("2026-10-02")[0].title, "updated");
});
test("filters use occurrence completion and find task tags, note folders and event locations", () => {
  const range = model.calendarRange("2026-10-11", "week");
  const tasks = [task("repeat", "2026-10-01", { repeat: { freq: "daily", every: 1 }, doneDates: ["2026-10-11"], tags: ["study"] })];
  const index = model.getCalendarNoteIndex([{ kind: "note", note: note("Работа/заметка", "2026-10-11") }]);
  const taskDays = model.getCalendarTaskDays(tasks, range.from, range.to), events = new Map([["2026-10-11", [{ uid: "1", summary: "meeting", location: "study", start: 1, end: 2 }]]]);
  const filtered = model.calendarDays(index, taskDays, events, range, { ...model.DEFAULT_CALENDAR_FILTERS, completed: false });
  assert.equal(filtered.find(day => day.key === "2026-10-11").tasks.length, 0); assert.equal(filtered.find(day => day.key === "2026-10-10").tasks.length, 1);
  const searched = model.calendarDays(index, taskDays, events, range, { ...model.DEFAULT_CALENDAR_FILTERS, query: "STUDY" });
  assert.equal(searched.find(day => day.key === "2026-10-11").events.length, 1);
  assert.equal(model.calendarDays(index, taskDays, events, range, { ...model.DEFAULT_CALENDAR_FILTERS, query: "Работа" }).find(day => day.key === "2026-10-11").notes.length, 1);
});
test("multi-day events cover each intersected day, with exclusive end dates and bounded recurring overlap", () => {
  const events = ics.parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:all\nSUMMARY:Long\nDTSTART;VALUE=DATE:20261010\nDTEND;VALUE=DATE:20261013\nEND:VEVENT\nBEGIN:VEVENT\nUID:repeat\nSUMMARY:Series\nDTSTART;VALUE=DATE:20261001\nDTEND;VALUE=DATE:20261015\nRRULE:FREQ=WEEKLY;COUNT=2\nEND:VEVENT\nEND:VCALENDAR");
  const days = model.getCalendarEventDays(events, "2026-10-10", "2026-10-15");
  assert(days.get("2026-10-12").some(event => event.uid === "all"));
  assert(!days.get("2026-10-13").some(event => event.uid === "all"));
  assert.equal(days.get("2026-10-10").filter(event => event.uid === "repeat").length, 2);
  assert.equal(days, model.getCalendarEventDays(events, "2026-10-10", "2026-10-15"));
});
test("crowded-day pagination stays bounded and clamps after deletions", () => {
  assert.deepEqual(model.calendarWindow(50000, 0), { offset: 0, end: 20 });
  assert.deepEqual(model.calendarWindow(21, 20), { offset: 20, end: 21 });
  assert.deepEqual(model.calendarWindow(20, 20), { offset: 0, end: 20 });
  assert.deepEqual(model.calendarWindow(0, 100), { offset: 0, end: 0 });
});
test("writing streak is anchored to today or yesterday", () => {
  const journals = new Map(["2026-10-09", "2026-10-10"].map(day => [day, note(`Дневник/2026/${day}`, day)]));
  assert.equal(model.writingStreak({ journals }, "2026-10-11"), 2); assert.equal(model.writingStreak({ journals }, "2026-10-12"), 0);
});

const mocks = { name: "calendar-store-mocks", setup(builder) {
  builder.onResolve({ filter: /(^@tauri-apps\/api\/core$|\/lib\/storage$|^\.\/notes$)/ }, args => ({ path: args.path, namespace: "calendar-test" }));
  builder.onLoad({ filter: /.*/, namespace: "calendar-test" }, args => ({ contents: args.path.includes("storage") ? "export const readTasks = () => globalThis.calendarTest.read(); export const writeTasks = value => globalThis.calendarTest.write(value);" : args.path === "./notes" ? "export const useNotesStore = { getState: () => ({ settings: { calendarIcsUrl: globalThis.calendarTest.url } }) };" : "export const invoke = (name,args) => globalThis.calendarTest.invoke(name,args);" }));
} };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
test("task load is shared and durable edits queue without losing simultaneous additions", async () => {
  let reads = 0, active = 0, maxActive = 0; const saved = [];
  globalThis.calendarTest = { read: async () => { reads++; return [task("existing", "2026-10-11")]; }, write: async value => { active++; maxActive = Math.max(maxActive, active); await new Promise(resolve => setTimeout(resolve, 4)); saved.push(structuredClone(value)); active--; } };
  const { useTasksStore: store } = await compiled("src/store/tasks.ts", [mocks]);
  await Promise.all([store.getState().load(), store.getState().load()]); assert.equal(reads, 1);
  await Promise.all([store.getState().add("2026-10-11", "A"), store.getState().add("2026-10-11", "B"), store.getState().toggle("existing")]);
  assert.equal(maxActive, 1); assert.equal(store.getState().tasks.length, 3); assert.equal(saved.at(-1).find(value => value.id === "existing").done, true);
});
test("failed loading blocks writes, and failed saving keeps the durable state retryable", async () => {
  let writes = 0, loadFails = true, saveFails = false;
  globalThis.calendarTest = { read: async () => { if (loadFails) throw new Error("unreadable"); return [task("existing", "2026-10-11")]; }, write: async () => { writes++; if (saveFails) throw new Error("disk full"); } };
  const { useTasksStore: store } = await compiled("src/store/tasks.ts", [mocks]);
  await assert.rejects(store.getState().add("2026-10-11", "A")); assert.equal(writes, 0); assert.equal(store.getState().loaded, false);
  loadFails = false; await store.getState().load(); saveFails = true;
  await assert.rejects(store.getState().add("2026-10-11", "A")); assert.equal(store.getState().tasks.length, 1);
  saveFails = false; await store.getState().add("2026-10-11", "B"); assert.equal(store.getState().tasks.length, 2);
});
test("recurring completion and undo deletion preserve task identity and metadata", async () => {
  const original = task("repeat", "2026-10-01", { repeat: { freq: "daily", every: 1 }, tags: ["study"], color: "#123456" });
  globalThis.calendarTest = { read: async () => [original], write: async () => {} };
  const { useTasksStore: store } = await compiled("src/store/tasks.ts", [mocks]); await store.getState().load();
  await store.getState().toggle(original.id, "2026-10-11"); assert.deepEqual(store.getState().tasks[0].doneDates, ["2026-10-11"]);
  const removed = store.getState().tasks[0]; await store.getState().remove(original.id); await store.getState().restore(removed); await store.getState().restore(removed);
  assert.equal(store.getState().tasks.length, 1); assert.deepEqual(store.getState().tasks[0].tags, ["study"]); assert.equal(store.getState().tasks[0].color, "#123456");
});
test("the navigation flusher waits for the accepted task write", async () => {
  const gate = deferred();
  globalThis.calendarTest = { read: async () => [], write: () => gate.promise };
  const { useTasksStore: store } = await compiled("src/store/tasks.ts", [mocks]);
  await store.getState().load();
  const addition = store.getState().add("2026-10-11", "pending");
  let flushed = false;
  const flushing = store.getState().flush().then(() => { flushed = true; });
  await new Promise(resolve => setTimeout(resolve, 4));
  assert.equal(flushed, false); assert.equal(store.getState().tasks.length, 0);
  gate.resolve(); await Promise.all([addition, flushing]); assert.equal(store.getState().tasks.length, 1);
});
test("a corrupted task file is reported rather than treated as an empty collection", async t => {
  const workspace = await fixture(t);
  await fs.writeFile(path.join(workspace.notes, ".tasks.json"), "broken JSON");
  await assert.rejects(workspace.storage.readTasks());
  assert.equal(await workspace.read(".tasks.json"), "broken JSON");
});
test("iCal requests are shared and a replaced feed cannot publish a late result", async () => {
  const requests = [], feed = uid => `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:${uid}\nDTSTART;VALUE=DATE:20261011\nEND:VEVENT\nEND:VCALENDAR`;
  globalThis.calendarTest = { url: "first", invoke: () => { const request = deferred(); requests.push(request); return request.promise; } };
  const { useCalendarStore: store } = await compiled("src/store/calendar.ts", [mocks]);
  const one = store.getState().syncNow(), shared = store.getState().syncNow(); assert.equal(one, shared); assert.equal(requests.length, 1);
  globalThis.calendarTest.url = "second"; const two = store.getState().syncNow(); requests[1].resolve(feed("second")); await two;
  requests[0].resolve(feed("first")); await one; assert.equal(store.getState().events[0].uid, "second");
  store.getState().syncIfStale(); assert.equal(requests.length, 2);
  globalThis.calendarTest.url = ""; await store.getState().syncNow(); assert.equal(store.getState().events.length, 0); assert.equal(store.getState().status, "idle");
});
test("a failed iCal request exposes recovery and a retry can succeed", async () => {
  let fail = true;
  globalThis.calendarTest = { url: "feed", invoke: async () => { if (fail) throw "offline"; return "BEGIN:VCALENDAR\nEND:VCALENDAR"; } };
  const { useCalendarStore: store } = await compiled("src/store/calendar.ts", [mocks]); await store.getState().syncNow(); assert.equal(store.getState().status, "error");
  fail = false; await store.getState().syncNow(); assert.equal(store.getState().status, "ok");
});
test.after(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
