/** Local calendar tasks. Reads are shared; durable mutations are serialized. */
import { create } from "zustand";
import { readTasks, writeTasks } from "../lib/storage";
import { compareTasks, isValidDay, newTaskId, normalizeTags, normalizeTime, type Recurrence, type Task } from "../lib/tasks";

export type TaskPatch = Partial<Pick<Task, "title" | "day" | "time" | "done" | "repeat" | "color" | "tags">>;
type TasksState = {
  tasks: Task[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  flush: () => Promise<void>;
  add: (day: string, title: string, time?: string | null, repeat?: Recurrence | null) => Promise<void>;
  update: (id: string, patch: TaskPatch) => Promise<void>;
  toggle: (id: string, date?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  restore: (task: Task) => Promise<void>;
};

export const useTasksStore = create<TasksState>((set, get) => {
  let pendingLoad: Promise<void> | null = null;
  let mutations: Promise<void> = Promise.resolve();
  const change = (apply: (tasks: Task[]) => Task[]): Promise<void> => {
    const request = mutations.catch(() => {}).then(async () => {
      await get().load();
      const previous = get().tasks, next = apply(previous);
      if (next === previous) return;
      // Do not advertise a successful change before its atomic file write.
      // A failed write leaves the last durable state available for retry.
      await writeTasks(next);
      set({ tasks: next });
    });
    mutations = request;
    return request;
  };
  return {
    tasks: [], loaded: false, loading: false, error: null,
    flush: () => mutations,
    load: () => {
      if (get().loaded) return Promise.resolve();
      if (pendingLoad) return pendingLoad;
      set({ loading: true, error: null });
      pendingLoad = (async () => {
        try { const tasks = await readTasks(); set({ tasks: tasks.sort(compareTasks), loaded: true, loading: false }); }
        catch (error) { set({ loading: false, error: error instanceof Error ? error.message : String(error) }); throw error; }
        finally { pendingLoad = null; }
      })();
      return pendingLoad;
    },
    add: (day, title, time = null, repeat = null) => {
      const text = title.trim();
      if (!text || !isValidDay(day)) return Promise.resolve();
      return change(tasks => { const now = Date.now(); return [...tasks, { id: newTaskId(), title: text, day, time: normalizeTime(time), done: false, repeat, doneDates: [], color: null, tags: [], createdAt: now, updatedAt: now }].sort(compareTasks); });
    },
    update: (id, patch) => change(tasks => {
      if (!tasks.some(task => task.id === id)) return tasks;
      return tasks.map(task => {
        if (task.id !== id) return task;
        const next = { ...task, updatedAt: Date.now() };
        if (patch.title?.trim()) next.title = patch.title.trim();
        if (patch.day !== undefined && isValidDay(patch.day)) next.day = patch.day;
        if (patch.time !== undefined) next.time = normalizeTime(patch.time);
        if (patch.done !== undefined) next.done = patch.done;
        if (patch.repeat !== undefined) next.repeat = patch.repeat;
        if (patch.color !== undefined) next.color = patch.color;
        if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
        return next;
      }).sort(compareTasks);
    }),
    toggle: (id, date) => change(tasks => {
      if (!tasks.some(task => task.id === id)) return tasks;
      return tasks.map(task => {
        if (task.id !== id) return task;
        if (!task.repeat || !date) return { ...task, done: !task.done, updatedAt: Date.now() };
        const current = task.doneDates ?? [];
        return { ...task, doneDates: current.includes(date) ? current.filter(day => day !== date) : [...current, date], updatedAt: Date.now() };
      });
    }),
    remove: id => change(tasks => tasks.some(task => task.id === id) ? tasks.filter(task => task.id !== id) : tasks),
    restore: task => change(tasks => tasks.some(item => item.id === task.id) ? tasks : [...tasks, task].sort(compareTasks)),
  };
});
