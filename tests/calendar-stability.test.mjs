import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test, after } from "node:test";
import { build } from "esbuild";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-calendar-stability-"));
async function compiled(entry, plugins = []) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm", plugins });
  const file = path.join(temporary, `${Math.random().toString(36).slice(2)}.mjs`);
  await fs.writeFile(file, result.outputFiles[0].text); return import(pathToFileURL(file));
}
const ics = await compiled("src/lib/ics.ts"), model = await compiled("src/lib/calendarModel.ts"), clock = await compiled("src/lib/calendarClock.ts");
const feed = (...events) => `BEGIN:VCALENDAR\n${events.map(event => `BEGIN:VEVENT\nUID:series\n${event}\nEND:VEVENT`).join("\n")}\nEND:VCALENDAR`;
const expand = (text, from, to) => ics.expandEvents(ics.parseIcs(text), Date.parse(from), Date.parse(to));
const starts = events => events.map(event => new Date(event.start).toISOString());
async function inZone(zone, run) { const previous = process.env.TZ; try { process.env.TZ = zone; return await run(); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; } }

test("IANA events preserve their clock in their own zone across DST", () => inZone("Europe/Moscow", () => {
  const events = expand(feed("DTSTART;TZID=America/New_York:20261025T090000\nDTEND;TZID=America/New_York:20261025T100000\nRRULE:FREQ=WEEKLY;COUNT=3"), "2026-10-24", "2026-11-10");
  assert.deepEqual(starts(events), ["2026-10-25T13:00:00.000Z", "2026-11-01T14:00:00.000Z", "2026-11-08T14:00:00.000Z"]);
  assert(events.every(event => event.end - event.start === 3600000));
}));
test("UTC daily repeats never adopt the machine's DST offset", () => inZone("America/New_York", () => {
  assert.deepEqual(starts(expand(feed("DTSTART:20260307T090000Z\nDTEND:20260307T100000Z\nRRULE:FREQ=DAILY;COUNT=3"), "2026-03-07", "2026-03-11")), ["2026-03-07T09:00:00.000Z", "2026-03-08T09:00:00.000Z", "2026-03-09T09:00:00.000Z"]);
}));
test("monthly and leap-year COUNT skip nonexistent dates without consuming instances", () => {
  assert.deepEqual(starts(expand(feed("DTSTART:20260131T090000Z\nDTEND:20260131T100000Z\nRRULE:FREQ=MONTHLY;COUNT=4"), "2026-01-01", "2026-08-01")), ["2026-01-31T09:00:00.000Z", "2026-03-31T09:00:00.000Z", "2026-05-31T09:00:00.000Z", "2026-07-31T09:00:00.000Z"]);
  assert.deepEqual(starts(expand(feed("DTSTART:20240229T090000Z\nRRULE:FREQ=YEARLY;COUNT=3"), "2024-01-01", "2033-01-01")), ["2024-02-29T09:00:00.000Z", "2028-02-29T09:00:00.000Z", "2032-02-29T09:00:00.000Z"]);
});
test("DST gaps are skipped in repetitions; ambiguous starts use the earlier offset", () => inZone("Europe/Moscow", () => {
  assert.deepEqual(starts(expand(feed("DTSTART;TZID=America/New_York:20260307T023000\nRRULE:FREQ=DAILY;COUNT=3"), "2026-03-07", "2026-03-11")), ["2026-03-07T07:30:00.000Z", "2026-03-09T06:30:00.000Z", "2026-03-10T06:30:00.000Z"]);
  assert.equal(new Date(ics.parseIcs(feed("DTSTART;TZID=America/New_York:20261101T013000"))[0].start).toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(new Date(ics.parseIcs(feed("DTSTART;TZID=America/New_York:20260308T023000"))[0].start).toISOString(), "2026-03-08T07:30:00.000Z");
  assert.deepEqual(starts(expand(feed("DTSTART;TZID=Australia/Lord_Howe:20261003T021500\nRRULE:FREQ=DAILY;COUNT=2"), "2026-10-02", "2026-10-07")), ["2026-10-02T15:45:00.000Z", "2026-10-04T15:15:00.000Z"]);
}));
test("WEEKLY intervals honor Monday default and explicit WKST", () => {
  const base = "DTSTART:19970902T090000Z\nRRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU";
  assert.deepEqual(starts(expand(feed(base), "1997-09-01", "1997-10-01")).map(value => value.slice(0, 10)), ["1997-09-02", "1997-09-07", "1997-09-16", "1997-09-21"]);
  assert.deepEqual(starts(expand(feed(base + ";WKST=SU"), "1997-09-01", "1997-10-01")).map(value => value.slice(0, 10)), ["1997-09-02", "1997-09-14", "1997-09-16", "1997-09-28"]);
});
test("EXDATE counts an excluded slot and UNTIL includes the final valid start", () => {
  const events = expand(feed("DTSTART:20261001T090000Z\nRRULE:FREQ=DAILY;COUNT=4;UNTIL=20261003T090000Z\nEXDATE:20261002T090000Z"), "2026-10-01", "2026-10-10");
  assert.deepEqual(starts(events), ["2026-10-01T09:00:00.000Z", "2026-10-03T09:00:00.000Z"]);
});
test("moved and cancelled single instances replace their original occurrence", () => {
  const events = expand(feed("DTSTART:20261001T090000Z\nDTEND:20261001T100000Z\nRRULE:FREQ=DAILY;COUNT=3", "RECURRENCE-ID:20261002T090000Z\nDTSTART:20261002T130000Z\nDTEND:20261002T140000Z\nSUMMARY:Moved", "RECURRENCE-ID:20261003T090000Z\nSTATUS:CANCELLED"), "2026-10-01", "2026-10-05");
  assert.deepEqual(starts(events), ["2026-10-01T09:00:00.000Z", "2026-10-02T13:00:00.000Z"]); assert.equal(events[1].summary, "Moved");
});
test("all-day events end at midnight across 23- and 25-hour days without leaking into tomorrow", () => inZone("America/New_York", () => {
  for (const [start, from, to, hours] of [["20260308", "2026-03-08", "2026-03-10", 23], ["20261101", "2026-11-01", "2026-11-03", 25]]) {
    const parsed = ics.parseIcs(feed(`DTSTART;VALUE=DATE:${start}`));
    const event = ics.expandEvents(parsed, model.dateFromDay(from).getTime(), model.dateFromDay(to).getTime())[0];
    assert.equal((event.end - event.start) / 3600000, hours);
    const days = model.getCalendarEventDays(parsed, from, to, "America/New_York");
    assert.equal(days.get(from).length, 1); assert.equal(days.has(model.shiftDay(from, 1)), false);
  }
}));
test("zero-duration meetings are visible on their date; invalid dates do not roll over", () => {
  assert.equal(expand(feed("DTSTART:20261010T120000Z"), "2026-10-10", "2026-10-11").length, 1);
  for (const value of ["20260231T120000Z", "20261301T090000Z", "20261010T250000Z", "20260230"]) assert.equal(ics.parseIcs(feed(`DTSTART:${value}`)).length, 0);
  assert.throws(() => ics.parseIcs(feed("DTSTART;TZID=Unknown/Custom:20261010T090000")), /часовой пояс/);
});
test("unbounded historical series seek directly to the visible period", () => {
  assert.equal(expand(feed("DTSTART:19000101T090000Z\nRRULE:FREQ=DAILY"), "2026-10-01", "2026-11-01").length, 31);
  assert.equal(expand(feed("DTSTART:19000101T090000Z\nRRULE:FREQ=DAILY;COUNT=50000"), "2026-10-01", "2026-11-01").length, 31);
  assert.equal(expand(feed("DTSTART:19000101T090000Z\nRRULE:FREQ=DAILY;COUNT=200"), "2026-10-01", "2026-11-01").length, 0);
});
test("range caches evict old periods and date metadata is rebased after a timezone change", async () => {
  const tasks = [{ id: "one", day: "2026-01-01", title: "one", repeat: { freq: "daily", every: 1 }, createdAt: 1 }];
  const first = model.getCalendarTaskDays(tasks, "2026-01-01", "2026-01-31");
  for (let month = 2; month <= 6; month++) { const date = `2026-${String(month).padStart(2, "0")}-01`; model.getCalendarTaskDays(tasks, date, model.shiftDay(date, 20)); }
  assert.notEqual(model.getCalendarTaskDays(tasks, "2026-01-01", "2026-01-31"), first);
  const tree = [{ kind: "note", note: { id: "one", title: "one", createdAt: Date.parse("2026-10-10T23:00:00Z") } }];
  const before = await inZone("UTC", () => model.getCalendarNoteIndex(tree, "UTC"));
  const next = await inZone("Asia/Tokyo", () => model.getCalendarNoteIndex(tree, "Asia/Tokyo"));
  assert(before.byDay.has("2026-10-10")); assert(next.byDay.has("2026-10-11"));
});
test("the midnight clock owns one timer, recovers on focus without visibility changes and cleans up", () => {
  let now = new Date(2026, 9, 10, 23, 59), zone = "Europe/Moscow", resumes = 0, serial = 0;
  const timers = new Map(), updates = [], win = new EventTarget(), doc = new EventTarget(); doc.hidden = false;
  Object.assign(win, { setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) });
  const stop = clock.watchCalendarClock(value => updates.push(value), () => resumes++, { window: win, document: doc, now: () => now, zone: () => zone });
  assert.equal(timers.size, 1);
  now = new Date(2026, 9, 12, 8); zone = "Asia/Tokyo"; win.dispatchEvent(new Event("focus"));
  assert.deepEqual(updates.at(-1), { day: "2026-10-12", zone }); assert.equal(resumes, 1); assert.equal(timers.size, 1);
  doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange")); assert.equal(resumes, 1);
  doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange")); assert.equal(resumes, 2); assert.equal(timers.size, 1);
  timers.values().next().value.fn(); assert.equal(timers.size, 1);
  stop(); assert.equal(timers.size, 0); win.dispatchEvent(new Event("focus")); assert.equal(resumes, 2);
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const mocks = { name: "stability-mocks", setup(builder) {
  builder.onResolve({ filter: /(^@tauri-apps\/api\/core$|\/lib\/storage$|\/store\/notes$|\/store\/tasks$|^\.\/notes$)/ }, args => ({ path: args.path, namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.includes("storage") ? "export const readTasks=()=>globalThis.stability.read(); export const writeTasks=value=>globalThis.stability.write(value);" : args.path.endsWith("tasks") ? "export const useTasksStore=globalThis.stability.tasks;" : args.path.includes("notes") ? "export const flushAllPending=()=>globalThis.stability.flushNotes(); export const useNotesStore={getState:()=>({settings:{calendarIcsUrl:globalThis.stability.url,modules:{calendar:globalThis.stability.calendarEnabled ?? true}}})};" : "export const invoke=(name,args)=>globalThis.stability.invoke(name,args);" }));
} };
test("exit drains edits accepted while waiting, survives Calendar unmount, and coalesces repeated Quit", async () => {
  const gate = deferred(), order = [], file = path.join(temporary, "durable-tasks.json");
  globalThis.stability = { read: async () => [], write: async value => { if (!order.length) { order.push("first-start"); await gate.promise; } await fs.writeFile(file, JSON.stringify(value)); order.push(value.at(-1).title); }, flushNotes: async () => {}, invoke: async () => { order.push("exit"); } };
  const { useTasksStore: tasks } = await compiled("src/store/tasks.ts", [mocks]); globalThis.stability.tasks = tasks;
  const { exitAfterSaving } = await compiled("src/lib/applicationExit.ts", [mocks]);
  await tasks.getState().load(); const one = tasks.getState().add("2026-10-11", "one");
  const quit = exitAfterSaving(); assert.equal(quit, exitAfterSaving());
  await new Promise(resolve => setTimeout(resolve, 3));
  const two = tasks.getState().add("2026-10-11", "two");
  await new Promise(resolve => setTimeout(resolve, 2050)); assert(!order.includes("exit"));
  gate.resolve(); await Promise.all([one, two, quit]);
  assert.deepEqual(order, ["first-start", "one", "two", "exit"]); assert.equal(JSON.parse(await fs.readFile(file, "utf8")).length, 2);
});
test("failed task writes block exit and a successful retry releases the barrier", async () => {
  let fails = true, exits = 0;
  globalThis.stability = { read: async () => [], write: async () => { if (fails) throw new Error("disk full"); }, flushNotes: async () => {}, invoke: async () => exits++ };
  const { useTasksStore: tasks } = await compiled("src/store/tasks.ts", [mocks]); globalThis.stability.tasks = tasks;
  const { exitAfterSaving } = await compiled("src/lib/applicationExit.ts", [mocks]);
  await assert.rejects(tasks.getState().add("2026-10-11", "one")); await assert.rejects(exitAfterSaving()); assert.equal(exits, 0);
  fails = false; await tasks.getState().add("2026-10-11", "retry"); await exitAfterSaving(); assert.equal(exits, 1);
});
test("foreground feed checks are deduplicated, rebase floating dates locally and back off offline retries", async () => inZone("UTC", async () => {
  let requests = 0, fail = false;
  globalThis.stability = { url: "fixture", invoke: async () => { requests++; if (fail) throw new Error("offline"); return feed("DTSTART:20261010T090000\nDTEND:20261010T100000"); } };
  const { useCalendarStore: store } = await compiled("src/store/calendar.ts", [mocks]); await store.getState().syncNow();
  const before = store.getState().events[0].start;
  await inZone("Asia/Tokyo", () => { store.getState().syncIfStale(); assert.equal(store.getState().events[0].start, before - 9 * 3600000); });
  store.getState().syncIfStale(); assert.equal(store.getState().events[0].start, before);
  assert.equal(requests, 1);
  fail = true; await store.getState().syncNow();
  const durable = store.getState().events; for (let i = 0; i < 25; i++) store.getState().syncIfStale(); assert.equal(requests, 2); assert.equal(store.getState().events, durable);
  fail = false; await store.getState().syncNow(); assert.equal(requests, 3); assert.equal(store.getState().status, "ok");
  fail = true; await store.getState().syncNow(); globalThis.stability.url = "different-feed"; store.getState().syncIfStale(); assert.equal(requests, 5);
}));
test("an unsupported updated feed reports its error while retaining the last successful events", async () => {
  let broken = false;
  globalThis.stability = { url: "fixture", invoke: async () => broken ? feed("DTSTART;TZID=Unknown/Custom:20261010T090000") : feed("DTSTART:20261010T090000Z") };
  const { useCalendarStore: store } = await compiled("src/store/calendar.ts", [mocks]); await store.getState().syncNow();
  const events = store.getState().events, lastSync = store.getState().lastSync; broken = true; await store.getState().syncNow();
  assert.equal(store.getState().status, "error"); assert.match(store.getState().error, /часовой пояс/); assert.equal(store.getState().events, events); assert.equal(store.getState().lastSync, lastSync);
});
after(() => fs.rm(temporary, { recursive: true, force: true }));

test("disabled calendar cannot start feed requests and discards an in-flight completion", async () => {
  const gate = deferred(); let requests = 0;
  globalThis.stability = { url: "fixture", calendarEnabled: false, invoke: async () => { requests++; return gate.promise; } };
  const { useCalendarStore: store } = await compiled("src/store/calendar.ts", [mocks]);
  await store.getState().syncNow(); store.getState().syncIfStale(); assert.equal(requests, 0);
  globalThis.stability.calendarEnabled = true;
  const pending = store.getState().syncNow(); assert.equal(requests, 1);
  globalThis.stability.calendarEnabled = false;
  gate.resolve(feed("DTSTART:20261010T090000Z")); await pending;
  assert.equal(store.getState().status, "idle"); assert.equal(store.getState().events.length, 0); assert.equal(store.getState().lastSync, null);
  store.getState().syncIfStale(); assert.equal(requests, 1);
});

test("disabled calendar cannot publish an in-flight feed failure", async () => {
  const gate = deferred();
  globalThis.stability = { url: "fixture", calendarEnabled: true, invoke: () => gate.promise };
  const { useCalendarStore: store } = await compiled("src/store/calendar.ts", [mocks]);
  const pending = store.getState().syncNow();
  globalThis.stability.calendarEnabled = false; gate.reject(new Error("Fixture: offline")); await pending;
  assert.equal(store.getState().status, "idle"); assert.equal(store.getState().error, null);
});
