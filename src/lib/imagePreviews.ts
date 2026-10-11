import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { LibraryImage } from "./imageLibrary";

export type ImagePreview = { url: string; width: number; height: number; previewWidth: number; previewHeight: number; bytes: number };
export type PreviewLoader = (image: LibraryImage, signal: AbortSignal, regenerate?: boolean) => Promise<ImagePreview>;
type Job = { key: string; image: LibraryImage; started: boolean; regenerate: boolean; clients: Map<AbortSignal, () => void>; resolve: (value: ImagePreview) => void; reject: (error: unknown) => void; promise: Promise<ImagePreview> };
const results = new Map<string, ImagePreview>();
const failures = new Map<string, unknown>();
const jobs = new Map<string, Job>();
const pending: Job[] = [];
const subscribers = new Map<string, Set<(preview: ImagePreview) => void>>();
let active = 0;
let watchingVisibility = false;
const keyFor = (image: LibraryImage) => `${image.id}\0${image.modifiedAt}\0${image.sizeBytes}`;

function remember<T>(map: Map<string, T>, key: string, value: T, limit: number) {
  map.delete(key); map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value!);
}

function visibilityListener() {
  const needed = active > 0 || pending.length > 0;
  if (needed && !watchingVisibility) { document.addEventListener("visibilitychange", drain); watchingVisibility = true; }
  else if (!needed && watchingVisibility) { document.removeEventListener("visibilitychange", drain); watchingVisibility = false; }
}

function drain() {
  while (active < 2 && pending.length && !document.hidden) {
    const job = pending.shift()!; job.started = true; active++;
    void invoke<Omit<ImagePreview, "url"> & { path: string }>("image_preview", { relativePath: job.image.id, regenerate: job.regenerate }).then((preview) => {
      const value: ImagePreview = { ...preview, url: convertFileSrc(preview.path) + (job.regenerate ? `?retry=${Date.now()}` : "") };
      remember(results, job.key, value, 128); failures.delete(job.key);
      for (const notify of subscribers.get(job.key) ?? []) notify(value);
      job.resolve(value);
    }).catch((error) => { remember(failures, job.key, error, 64); job.reject(error); }).finally(() => {
      for (const [signal, listener] of job.clients) signal.removeEventListener("abort", listener);
      jobs.delete(job.key); active--; drain();
    });
  }
  visibilityListener();
}

/** At most two native decodes, cancel offscreen queued work, pause new work
 * when hidden, and retain only a bounded metadata cache. No image byte IPC. */
export const loadImagePreview: PreviewLoader = (image, signal, regenerate = false) => {
  const key = keyFor(image);
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (regenerate) { results.delete(key); failures.delete(key); }
  const cached = results.get(key);
  if (cached) { remember(results, key, cached, 128); return Promise.resolve(cached); }
  if (failures.has(key)) return Promise.reject(failures.get(key));
  let job = jobs.get(key);
  if (!job) {
    let resolve!: Job["resolve"]; let reject!: Job["reject"];
    const promise = new Promise<ImagePreview>((yes, no) => { resolve = yes; reject = no; });
    job = { key, image, regenerate, started: false, clients: new Map(), resolve, reject, promise };
    jobs.set(key, job); pending.push(job);
  }
  const current = job;
  const abort = () => {
    current.clients.delete(signal);
    if (!current.started && !current.clients.size) {
      const position = pending.indexOf(current); if (position >= 0) pending.splice(position, 1);
      jobs.delete(key); current.reject(new DOMException("Aborted", "AbortError")); visibilityListener();
    }
  };
  current.clients.set(signal, abort); signal.addEventListener("abort", abort, { once: true });
  drain(); return current.promise;
};

export function subscribeImagePreview(image: LibraryImage, listener: (preview: ImagePreview) => void) {
  const key = keyFor(image); const listeners = subscribers.get(key) ?? new Set();
  listeners.add(listener); subscribers.set(key, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) subscribers.delete(key); };
}

export function prioritizeImagePreview(image: LibraryImage) {
  const job = jobs.get(keyFor(image)); if (!job || job.started) return;
  const position = pending.indexOf(job);
  if (position > 0) { pending.splice(position, 1); pending.unshift(job); }
}
