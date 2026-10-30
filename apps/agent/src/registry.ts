import { EntitySchema, type AgentState, type Entity, type Event, type ServerId, type SourceReport, type StreamMessage } from "@hetops-control/contracts";

export type SourceContext = { server: ServerId; now: () => Date };
export interface Source { id: string; periodMs: number; collect(ctx: SourceContext): Promise<{ entities: Entity[]; events?: Event[] }> }

export class Registry {
  private data = new Map<string, { entities: Entity[]; report: SourceReport }>();
  private listeners = new Set<(m: StreamMessage) => void>();
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();

  constructor(private server: ServerId, private sources: Source[], private now: () => Date = () => new Date()) {
    for (const s of sources) this.data.set(s.id, { entities: [], report: { id: s.id, periodMs: s.periodMs, ok: false } });
  }

  start(): void {
    for (const s of this.sources) {
      const tick = () => {
        if (this.running.has(s.id)) return; // never overlap runs of one source
        this.running.add(s.id);
        void this.runOnce(s.id).finally(() => this.running.delete(s.id));
      };
      tick();
      this.timers.push(setInterval(tick, s.periodMs));
    }
  }

  stop(): void { this.timers.forEach(clearInterval); this.timers = []; }

  async runOnce(id: string): Promise<void> {
    const src = this.sources.find(s => s.id === id);
    if (!src) throw new Error(`unknown source ${id}`);
    const lastRunAt = this.now().toISOString();
    const ms = Math.min(src.periodMs, 30_000);
    let events: Event[] = [];
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms); });
      const out = await Promise.race([src.collect({ server: this.server, now: this.now }), timeout]);
      const entities = out.entities.map(e => EntitySchema.parse(e));
      this.data.set(id, { entities, report: { id, periodMs: src.periodMs, ok: true, lastRunAt } });
      events = out.events ?? [];
    } catch (err) {
      // message only, never stack or payload; the source's entities disappear
      this.data.set(id, { entities: [], report: { id, periodMs: src.periodMs, ok: false, lastRunAt, error: err instanceof Error ? err.message : String(err) } });
    } finally { clearTimeout(timer); }
    this.emit({ type: "state", state: this.state() });
    for (const event of events) this.emit({ type: "event", event });
  }

  state(): AgentState {
    const all = [...this.data.values()];
    return { server: this.server, version: process.env.VERSION ?? "dev", generatedAt: this.now().toISOString(),
      entities: all.flatMap(d => d.entities).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      sources: all.map(d => d.report) };
  }

  on(listener: (m: StreamMessage) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(m: StreamMessage) { for (const l of this.listeners) l(m); }
}
