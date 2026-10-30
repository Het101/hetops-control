import { EntitySchema, EventSchema, SeriesSchema, type AgentState, type Entity, type Event, type Series, type ServerId, type SourceReport, type StreamMessage } from "@hetops-control/contracts";

export type SourceContext = { server: ServerId; now: () => Date };
export interface Source { id: string; periodMs: number; collect(ctx: SourceContext): Promise<{ entities: Entity[]; events?: Event[]; series?: Series[] }> }

export class Registry {
  private data = new Map<string, { entities: Entity[]; series: Series[]; report: SourceReport }>();
  private listeners = new Set<(m: StreamMessage) => void>();
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();

  constructor(private server: ServerId, private sources: Source[], private now: () => Date = () => new Date()) {
    for (const s of sources) this.data.set(s.id, { entities: [], series: [], report: { id: s.id, periodMs: s.periodMs, ok: false } });
  }

  start(): void {
    if (this.timers.length) return; // idempotent
    for (const s of this.sources) {
      const tick = () => { void this.runOnce(s.id); };
      tick();
      this.timers.push(setInterval(tick, s.periodMs));
    }
  }

  stop(): void { this.timers.forEach(clearInterval); this.timers = []; }

  listenerCount(): number { return this.listeners.size; }

  async runOnce(id: string): Promise<void> {
    const src = this.sources.find(s => s.id === id);
    if (!src) throw new Error(`unknown source ${id}`);
    if (this.running.has(id)) return; // never overlap runs of one source, even after a timeout
    this.running.add(id);
    const lastRunAt = this.now().toISOString();
    const ms = Math.min(src.periodMs, 30_000);
    let events: Event[] = [];
    let timer: NodeJS.Timeout | undefined;
    // held until the original collect settles; a late result is discarded
    const call = (async () => src.collect({ server: this.server, now: this.now }))();
    void call.then(() => this.running.delete(id), () => this.running.delete(id));
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms); });
      const out = await Promise.race([call, timeout]);
      const entities = out.entities.map((e, i) => {
        const r = EntitySchema.safeParse(e);
        if (!r.success) throw new Error(`invalid entity ${(e as { id?: unknown })?.id ?? i}: ${describe(r.error)}`);
        return { ...r.data, source: id }; // the center ages each entity by its source's period
      });
      const evs = (out.events ?? []).map((e, i) => {
        const r = EventSchema.safeParse(e);
        if (!r.success) throw new Error(`invalid event ${i}: ${describe(r.error)}`);
        return r.data;
      });
      const series = (out.series ?? []).map((x, i) => {
        const r = SeriesSchema.safeParse(x);
        if (!r.success) throw new Error(`invalid series ${(x as { id?: unknown })?.id ?? i}: ${describe(r.error)}`);
        return { ...r.data, source: id };
      });
      this.data.set(id, { entities, series, report: { id, periodMs: src.periodMs, ok: true, lastRunAt } });
      events = evs;
    } catch (err) {
      // message only, never stack or payload; the source's entities disappear
      this.data.set(id, { entities: [], series: [], report: { id, periodMs: src.periodMs, ok: false, lastRunAt, error:  err instanceof Error ? err.message : String(err) } });
    } finally { clearTimeout(timer); }
    this.emit({ type: "state", state: this.state() });
    for (const event of events) this.emit({ type: "event", event });
  }

  state(): AgentState {
    const all = [...this.data.values()];
    return { server: this.server, version: process.env.VERSION ?? "dev", generatedAt: this.now().toISOString(),
      entities: all.flatMap(d => d.entities).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      sources: all.map(d => d.report), series: all.flatMap(d => d.series).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
  }

  on(listener: (m: StreamMessage) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(m: StreamMessage) {
    for (const l of [...this.listeners]) {
      try { l(m); } catch (e) { console.error("listener failed:", e instanceof Error ? e.message : String(e)); }
    }
  }
}

// paths and issue codes only, never the rejected values
const describe = (e: { issues: { path: PropertyKey[]; code: string }[] }) => e.issues.map(i => `${i.path.join(".") || "(root)"} ${i.code}`).join("; ");
