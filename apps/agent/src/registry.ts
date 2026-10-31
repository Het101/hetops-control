import { MAX_SERIES, EntitySchema, EventSchema, SeriesSchema, type AgentState, type Entity, type Event, type Series, type ServerId, type SourceReport, type StreamMessage } from "@hetops-control/contracts";

export type SourceContext = { server: ServerId; now: () => Date };
// watch: optional push; the source calls changed() when its data moved, and the registry runs it soon instead of at the next period
export interface Source { id: string; periodMs: number; watch?(changed: () => void): void; collect(ctx: SourceContext): Promise<{ entities: Entity[]; events?: Event[]; series?: Series[] }> }

export class Registry {
  private data = new Map<string, { entities: Entity[]; series: Series[]; report: SourceReport }>();
  private listeners = new Set<(m: StreamMessage) => void>();
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();
  private kicks = new Map<string, NodeJS.Timeout>();

  constructor(private server: ServerId, private sources: Source[], private now: () => Date = () => new Date()) {
    for (const s of sources) this.data.set(s.id, { entities: [], series: [], report: { id: s.id, periodMs: s.periodMs, ok: false } });
  }

  start(): void {
    if (this.timers.length) return; // idempotent
    for (const s of this.sources) {
      const tick = () => { void this.runOnce(s.id); };
      tick();
      this.timers.push(setInterval(tick, s.periodMs));
      s.watch?.(() => this.kick(s.id));
    }
  }

  stop(): void { this.timers.forEach(clearInterval); this.timers = []; this.kicks.forEach(clearTimeout); this.kicks.clear(); }

  // a burst of changes (a rollout, a relist) becomes one run a second later; a change during a run reruns after it
  private kick(id: string): void {
    if (!this.timers.length || this.kicks.has(id)) return;
    this.kicks.set(id, setTimeout(() => {
      this.kicks.delete(id);
      if (this.running.has(id)) this.kick(id); else void this.runOnce(id);
    }, 1000));
  }

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
      // invalid items are dropped one by one (the good data stays visible) and the source is marked failing below
      const bad: string[] = [];
      const keep = <T extends { id: string; server: ServerId }>(kind: string, items: unknown[], schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; code: string }[] } } }): T[] => {
        const ok: T[] = [];
        items.forEach((x, i) => {
          const r = schema.safeParse(x); const rawId = (x as { id?: unknown })?.id; const name = typeof rawId === "string" && rawId.length <= 128 && /^[A-Za-z0-9_./:@-]+$/.test(rawId) ? rawId : `#${i}`;
          const why = !r.success ? describe(r.error) : r.data.server !== this.server ? "server mismatch" : "";
          if (why || !r.success) { bad.push(`${kind} ${name}: ${why}`); return; }
          ok.push(r.data);
        });
        return ok;
      };
      const entities = keep<Entity>("entity", out.entities, EntitySchema).map(e => ({ ...e, source: id })); // the center ages each entity by its source's period
      const evs = (out.events ?? []).map((e, i) => {
        const r = EventSchema.safeParse(e);
        if (!r.success) throw new Error(`invalid event ${i}: ${describe(r.error)}`);
        return r.data;
      });
      const series = keep<Series>("series", out.series ?? [], SeriesSchema).map(x => ({ ...x, source: id }));
      const error = bad.length ? `${bad.length} invalid item${bad.length === 1 ? "" : "s"} dropped, first: invalid ${bad[0]}` : undefined;
      this.data.set(id, { entities, series, report: { id, periodMs: src.periodMs, ok: !error, lastRunAt, ...(error ? { error } : {}) } });
      events = evs;
    } catch (err) {
      // message only, never stack or payload; the source's entities disappear
      this.data.set(id, { entities: [], series: [], report: { id, periodMs: src.periodMs, ok: false, lastRunAt, error:  err instanceof Error ? err.message : String(err) } });
    } finally { clearTimeout(timer); }
    this.emit({ type: "state", state: this.state() });
    for (const event of events) this.emit({ type: "event", event });
  }

  /**
   * Resolved here, not at collect time, so the outcome never depends on timing: sources are walked in configured order,
   * an id held by an earlier source always wins (per kind: entities and series are separate namespaces), series stop at MAX_SERIES.
   * Every source that lost items is reported failing, so the UI shows it blind while the kept data stays visible.
   */
  state(): AgentState {
    const entities: Entity[] = []; const series: Series[] = []; const reports: SourceReport[] = [];
    const ents = new Set<string>(); const sers = new Set<string>();
    for (const src of this.sources) {
      const d = this.data.get(src.id)!; const notes: string[] = []; if (d.report.error) notes.push(d.report.error);
      const dups: string[] = []; let capped = 0;
      for (const e of d.entities) { if (ents.has(e.id)) dups.push(`entity ${e.id}`); else { ents.add(e.id); entities.push(e); } }
      for (const x of d.series) {
        if (sers.has(x.id)) dups.push(`series ${x.id}`);
        else if (series.length >= MAX_SERIES) capped++;
        else { sers.add(x.id); series.push(x); }
      }
      // ids already passed the id pattern at collect time, so they are safe to quote
      if (dups.length) notes.push(`${dups.length} duplicate id${dups.length === 1 ? "" : "s"} dropped (held by an earlier source), first: ${dups[0]}`);
      if (capped) notes.push(`series cap (${MAX_SERIES}) reached, ${capped} dropped`);
      reports.push(notes.length ? { ...d.report, ok: false, error: notes.join("; ") } : d.report);
    }
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { server: this.server, version: process.env.VERSION ?? "dev", generatedAt: this.now().toISOString(),
      entities: entities.sort(byId), sources: reports, series: series.sort(byId) };
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
