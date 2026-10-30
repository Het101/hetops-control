import { ServerIdSchema, worst, type AgentState, type CenterMessage, type CenterState, type Entity, type Event, type ServerId } from "@hetops-control/contracts";

type Link = { state?: AgentState; reachable: boolean; since: Date };

/** The merged estate: the latest state per agent, aged at read time so nothing stale ever shows healthy. */
export class Store {
  private links = new Map<ServerId, Link>();
  private listeners = new Set<(m: CenterMessage) => void>();

  constructor(private now: () => Date = () => new Date()) {
    for (const s of ServerIdSchema.options) this.links.set(s, { reachable: false, since: now() });
  }

  /** Replaces the server's entities with `s`; returns the status changes (and "reachable again") as events. */
  apply(server: ServerId, s: AgentState): Event[] {
    const link = this.links.get(server)!; const at = this.now().toISOString(); const events: Event[] = [];
    // only after markUnreachable: a first connect is not news
    if (!link.reachable && link.state) events.push({ at, server, source: "center", kind: "info", summary: `${server} reachable again` });
    const prev = new Map(link.state?.entities.map(e => [e.id, e.status]));
    for (const e of s.entities) {
      const was = prev.get(e.id);
      // new entities are not a change; removed ones are covered by ageing
      if (was && was !== e.status) events.push({ at, server, source: e.source ?? "center", kind: "status", entity: e.id,
        summary: `${e.name} (${server}) ${was} → ${e.status}${e.statusReason ? `: ${e.statusReason}` : ""}` });
    }
    if (!link.reachable) { link.reachable = true; link.since = this.now(); }
    link.state = s;
    this.publish(events);
    return events;
  }

  /** One event per outage, however often it is called while the agent stays silent. */
  markUnreachable(server: ServerId, since: Date): Event[] {
    const link = this.links.get(server)!;
    if (!link.reachable) return [];
    link.reachable = false; link.since = since;
    const events: Event[] = [{ at: this.now().toISOString(), server, source: "center", kind: "info",
      summary: `${server} unreachable (agent silent since ${since.toISOString().slice(11, 19)})` }];
    this.publish(events);
    return events;
  }

  /** Agent events (restarts, deploys …) pass through to listeners. */
  record(e: Event): void { this.emit({ type: "event", event: e }); }

  snapshot(): CenterState {
    const now = this.now().getTime(); const entities: Entity[] = [];
    const servers = {} as CenterState["servers"];
    for (const [server, link] of this.links) {
      const aged = (link.state?.entities ?? []).map(e => age(e, link, now));
      entities.push(...aged);
      servers[server] = { status: link.reachable ? worst(aged.map(e => e.status)) : "unknown", reachable: link.reachable,
        since: link.since.toISOString(), ...(link.state ? { agentVersion: link.state.version } : {}) };
    }
    return { generatedAt: new Date(now).toISOString(), servers, entities };
  }

  on(fn: (m: CenterMessage) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  private publish(events: Event[]) {
    this.emit({ type: "state", state: this.snapshot() });
    for (const event of events) this.emit({ type: "event", event });
  }

  private emit(m: CenterMessage) {
    for (const l of [...this.listeners]) {
      try { l(m); } catch (e) { console.error("listener failed:", e instanceof Error ? e.message : String(e)); }
    }
  }
}

function age(e: Entity, link: Link, now: number): Entity {
  if (!link.reachable) return { ...e, status: "unknown", statusReason: `agent unreachable since ${link.since.toISOString()}` };
  const sources = link.state!.sources;
  // an entity without a source (older agent) ages by the slowest source, the most lenient choice
  const period = sources.find(s => s.id === e.source)?.periodMs ?? Math.max(0, ...sources.map(s => s.periodMs));
  const ms = now - Date.parse(e.observedAt);
  return ms > 3 * period ? { ...e, status: "unknown", statusReason: `stale: no data for ${Math.round(ms / 1000)} s` } : e;
}
