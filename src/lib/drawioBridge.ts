/** Small host protocol boundary. The editor stays in its own lazy local frame. */
export type DrawioEvent = { event: string; xml?: string; data?: string; format?: string; filename?: string; error?: unknown; exit?: boolean; href?: string; message?: unknown; [key: string]: unknown };
export type DrawioHooks = { ready: (ready: boolean) => void; change: (xml: string) => void; save: (xml: string, exit: boolean) => void; export: (event: DrawioEvent) => void; exit: () => void; link: (url: string) => void; error: (error: Error) => void };
const MAX_MESSAGE = 64 * 1024 * 1024;
export function parseDrawioEvent(data: unknown): DrawioEvent | null {
  if (typeof data !== "string" || data.length > MAX_MESSAGE) return null;
  try { const value: unknown = JSON.parse(data); return value !== null && typeof value === "object" && typeof (value as DrawioEvent).event === "string" ? value as DrawioEvent : null; } catch { return null; }
}
export function trustedDrawioMessage(event: Pick<MessageEvent, "source" | "origin">, source: MessageEventSource | null, origin: string): boolean {
  return source !== null && event.source === source && event.origin === origin;
}
function replyId(event: DrawioEvent): string | null {
  let message = event.message;
  if (typeof message === "string") { try { message = JSON.parse(message); } catch { return null; } }
  return message !== null && typeof message === "object" && typeof (message as Record<string, unknown>).requestId === "string" ? (message as { requestId: string }).requestId : null;
}
type Pending = { resolve: (event: DrawioEvent) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export class DrawioSession {
  private pending = new Map<string, Pending>();
  private sequence = 0;
  private generation = 0;
  private stopped = false;
  private ready = false;
  private queue: Promise<unknown> = Promise.resolve();
  private initialXml: string;
  private loading: Pending | null = null;
  private bootTimer: ReturnType<typeof setTimeout>;
  constructor(private send: (message: Record<string, unknown>) => void, xml: string, private hooks: DrawioHooks, private config: Record<string, unknown> = {}, private loadOptions: Record<string, unknown> = {}) {
    this.initialXml = xml;
    this.bootTimer = setTimeout(() => this.hooks.error(new Error("Редактор не загрузился. Повтори открытие холста.")), 20000);
  }
  accept(event: DrawioEvent): void {
    if (this.stopped) return;
    switch (event.event) {
      case "configure": this.send({ action: "configure", config: this.config }); return;
      case "init":
        this.generation++;
        this.rejectPending(new Error("Редактор перезапущен. Повтори действие."));
        this.queue = Promise.resolve();
        this.ready = false; this.hooks.ready(false);
        this.send({ action: "load", xml: this.initialXml, autosave: 1, exportProtocol: 1, zoomEvents: 1, saveAndExit: 0, noSaveBtn: 1, noExitBtn: 1, ...this.loadOptions }); return;
      case "load":
        if (event.error) { const error = new Error(String(event.error)); this.loading?.reject(error); this.clearLoad(); this.hooks.error(error); return; }
        if (typeof event.xml === "string") { this.initialXml = event.xml; this.hooks.change(event.xml); }
        this.ready = true; clearTimeout(this.bootTimer); this.hooks.ready(true);
        this.loading?.resolve(event); this.clearLoad(); return;
      case "autosave": if (typeof event.xml === "string") { this.initialXml = event.xml; this.hooks.change(event.xml); } return;
      case "save": if (typeof event.xml === "string") { this.initialXml = event.xml; this.hooks.change(event.xml); this.hooks.save(event.xml, event.exit === true); } return;
      case "exit": this.hooks.exit(); return;
      case "openLink": if (typeof event.href === "string" && /^(https?:|mailto:)/i.test(event.href)) this.hooks.link(event.href); return;
      case "export": {
        const id = replyId(event); const pending = id ? this.pending.get(id) : undefined;
        if (pending && id) {
          clearTimeout(pending.timer); this.pending.delete(id);
          if (event.error) pending.reject(new Error(String(event.error))); else pending.resolve(event);
        } else if (!id && typeof event.data === "string") this.hooks.export(event);
        return;
      }
    }
  }
  private clearLoad(): void { if (this.loading) clearTimeout(this.loading.timer); this.loading = null; }
  private request(payload: Record<string, unknown>, timeout = 20000, serial = true): Promise<DrawioEvent> {
    if (this.stopped || !this.ready) return Promise.reject(new Error("Холст ещё не готов."));
    const generation = this.generation;
    const task = () => new Promise<DrawioEvent>((resolve, reject) => {
      if (this.stopped || !this.ready || generation !== this.generation) { reject(new Error("Редактор перезапущен или закрыт. Повтори действие.")); return; }
      const requestId = `synapse-${++this.sequence}`;
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error("Редактор не ответил. Изменения остаются в открытом холсте.")); }, timeout);
      this.pending.set(requestId, { resolve, reject, timer });
      this.send({ action: "export", ...payload, requestId });
    });
    if(!serial)return task();
    const result = this.queue.then(task, task); this.queue = result.catch(() => {}); return result;
  }
  async xml(): Promise<string> {
    if (!this.ready) return this.initialXml;
    this.send({ action: "resetEditor" }); // commit the active label before serializing
    const event = await this.request({ format: "xml" }, 1500, false);
    if (typeof event.xml !== "string") throw new Error("Редактор не вернул схему.");
    this.initialXml = event.xml; this.hooks.change(event.xml); return event.xml;
  }
  requestExport(options: Record<string,unknown>): Promise<DrawioEvent> { return this.request(options); }
  export(format: "xmlsvg" | "xmlpng" | "svg" | "png", options: Record<string, unknown> = {}): Promise<DrawioEvent> {
    this.send({ action: "resetEditor" });
    return this.request({ format, embedImages: true, embedFonts: false, border: 10, ...options });
  }
  load(xml: string, title = "", options: Record<string,unknown> = {}): Promise<DrawioEvent> {
    if (this.loading) return Promise.reject(new Error("Дождись загрузки предыдущей схемы."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.clearLoad(); reject(new Error("Не удалось открыть схему.")); }, 20000);
      this.loading = { resolve, reject, timer };
      this.send({ action: "load", ...(xml.startsWith("data:image/png") ? { xmlpng: xml } : { xml }), title, autosave: 1, exportProtocol: 1, saveAndExit: 0, noSaveBtn: 1, noExitBtn: 1, ...options });
    });
  }
  saved(): void { this.send({ action: "status", message: "", modified: false }); }
  private rejectPending(error: Error): void {
    this.loading?.reject(error); this.clearLoad();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  dispose(): void {
    this.stopped = true; clearTimeout(this.bootTimer);
    this.rejectPending(new Error("Холст закрыт."));
  }
}
