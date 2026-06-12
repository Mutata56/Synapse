/**
 * Локальный стор календарных задач, редактируемая противоположность
 * read-only внешнего стора `calendar`. Хранит задачи, которые юзер ставит на
 * дату в приложении и которые рендерятся на сетке календаря. Персистится в
 * `.tasks.json` в воркспейсе: весь список перезаписывается при каждой мутации
 * (он маленький, и одна атомарная запись дает консистентность файла). Список
 * в памяти это рабочая копия, файл это источник истины между запусками.
 *
 * В отличие от заметок, задачи никогда не становятся markdown-файлами, это
 * отдельные датированные записи, сохраненные в формате CalDAV для будущего
 * шага "пуш в Яндекс".
 */

import { create } from "zustand";
import { readTasks, writeTasks } from "../lib/storage";
import {
  compareTasks,
  isValidDay,
  newTaskId,
  normalizeTags,
  normalizeTime,
  type Recurrence,
  type Task,
} from "../lib/tasks";

type TaskPatch = Partial<
  Pick<Task, "title" | "day" | "time" | "done" | "repeat" | "color" | "tags">
>;

type TasksState = {
  tasks: Task[];
  /** True после чтения файла, чтобы `load` не перечитывал повторно. */
  loaded: boolean;
  load: () => Promise<void>;
  add: (
    day: string,
    title: string,
    time?: string | null,
    repeat?: Recurrence | null,
  ) => Promise<void>;
  update: (id: string, patch: TaskPatch) => Promise<void>;
  /** Для повтора `date` обязателен (ставит/снимает метку в `doneDates`); у
   *  разовой задачи `date` игнорируется, переключается её общий `done`. */
  toggle: (id: string, date?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const tasks = await readTasks();
    set({ tasks: tasks.sort(compareTasks), loaded: true });
  },

  add: async (day, title, time = null, repeat = null) => {
    const t = title.trim();
    if (!t || !isValidDay(day)) return;
    const now = Date.now();
    const task: Task = {
      id: newTaskId(),
      title: t,
      day,
      time: normalizeTime(time),
      done: false,
      repeat: repeat ?? null,
      doneDates: [],
      color: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    const tasks = [...get().tasks, task].sort(compareTasks);
    set({ tasks });
    await writeTasks(tasks);
  },

  update: async (id, patch) => {
    const tasks = get()
      .tasks.map((t) => {
        if (t.id !== id) return t;
        const next: Task = { ...t, updatedAt: Date.now() };
        if (patch.title !== undefined) {
          const tt = patch.title.trim();
          if (tt) next.title = tt; // не обнуляем название
        }
        if (patch.day !== undefined && isValidDay(patch.day)) next.day = patch.day;
        if (patch.time !== undefined) next.time = normalizeTime(patch.time);
        if (patch.done !== undefined) next.done = patch.done;
        if (patch.repeat !== undefined) next.repeat = patch.repeat;
        if (patch.color !== undefined) next.color = patch.color;
        if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
        return next;
      })
      .sort(compareTasks);
    set({ tasks });
    await writeTasks(tasks);
  },

  // Отдельно от `update`, чтобы пропустить пересортировку: переключение
  // `done` никогда не меняет порядок, строка остается на месте, а не прыгает.
  toggle: async (id, date) => {
    const tasks = get().tasks.map((t) => {
      if (t.id !== id) return t;
      const now = Date.now();
      // Разовая: переключаем общий `done`. Повтор: ставим/снимаем метку на
      // конкретную дату вхождения в `doneDates`.
      if (!t.repeat || !date) {
        return { ...t, done: !t.done, updatedAt: now };
      }
      const cur = t.doneDates ?? [];
      const doneDates = cur.includes(date)
        ? cur.filter((d) => d !== date)
        : [...cur, date];
      return { ...t, doneDates, updatedAt: now };
    });
    set({ tasks });
    await writeTasks(tasks);
  },

  remove: async (id) => {
    const tasks = get().tasks.filter((t) => t.id !== id);
    set({ tasks });
    await writeTasks(tasks);
  },
}));
