import { ServerIdSchema, worst, type AgentState, type CenterMessage, type CenterState, type Entity, type Event, type ServerId, type ServerView, type Status } from "@hetops-control/contracts";

// skewMs = center clock - agent clock at the last apply; ageing adds it so agent clock drift never fakes staleness
type Link = { state?: AgentState; skewMs: number; reachable: boolean; since: Date };

/** The merged estate: the latest state per agent, aged at read time so nothing stale ever shows healthy. */
export class Store {
  private links = new Map<ServerId, Link>();
  private listeners = new Set<(m: CenterMessage) => void>();

  constructor(private now: () => Date = () => new Date()) {
    for (const s of ServerIdSchema.options) this.links.set(s, { reachable: false, since: now(), skewMs: 0 });
  }

  /** Replaces the server's entities with `s`; returns the status changes (and "reachable again") as events. */
  apply(server: ServerId, s: AgentState): Event[] {
    const link = this.links.get(server)!; const receivedAt = this.now(); const at = receivedAt.toISOString(); const events: Event[] = [];
    // only after markUnreachable: a first connect is not news
    if (!link.reachable && link.state) events.push({ at, server, source: "center", kind: "info", summary: `${server} reachable again` });
    const prev = new Map(link.state?.entities.map(e => [e.id, e.status]));
    for (const e of s.entities) {
      const was = prev.get(e.id);
      // a new entity is not a change; a removed one simply leaves the snapshot with this state
      if (was && was !== e.status) events.push({ at, server, source: e.source ?? "center", kind: "status", entity: e.id,
        summary: `${e.name} (${server}) ${was} → ${e.status}${e.statusReason ? `: ${e.statusReason}` : ""}` });
    }
    if (!link.reachable) { link.reachable = true; link.since = receivedAt; }
    link.state = s; link.skewMs = receivedAt.getTime() - Date.parse(s.generatedAt);
    this.publish(events);
    return events;
  }

  /** One event per outage, however often it is called while the agent stays silent. */
  markUnreachable(server: ServerId, since: Date): Event[] {
    const link = this.links.get(server)!;
    if (!link.reachable) return [];
    link.reachable = false; link.since = since;
    const events: Event[] = [{ at: this.now().toISOString(), server, source: "center", kind: "info",
      summary: `${server} unreachable (agent silent since ${since.toISOString().slice(11, 19)} UTC)` }];
    this.publish(events);
    return events;
  }

  /** Agent events (restarts, deploys …) pass through to listeners. */
  record(e: Event): void { this.emit({ type: "event", event: e }); }

  snapshot(): CenterState {
    const now = this.now().getTime(); const entities: Aged[] = [];
    const servers = {} as CenterState["servers"];
    for (const [server, link] of this.links) {
      const aged = (link.state?.entities ?? []).map(e => age(e, link, now));
      entities.push(...aged);
      // a source that has neither run nor failed yet is pending, not failing
      const srcs = link.reachable ? link.state?.sources ?? [] : []; const pending = (x: { ok: boolean; lastRunAt?: string; error?: string }) => !x.ok && !x.lastRunAt && !x.error;
      const failing = srcs.filter(x => !x.ok && !pending(x)).map(x => ({ id: x.id, ...(x.error ? { error: x.error } : {}) }));
      const starting = srcs.length > 0 && srcs.every(pending);
      servers[server] = { ...rollUp(link, aged.map(a => a.entity.status), aged.filter(a => a.stale).length, failing.length, starting), reachable: link.reachable,
        since: link.since.toISOString(), ...(link.state ? { agentVersion: link.state.version } : {}), ...(failing.length ? { failingSources: failing } : {}) };
    }
    return { generatedAt: new Date(now).toISOString(), servers, entities: entities.map(a => a.entity) };
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

type Aged = { entity: Entity; stale: boolean };

function age(e: Entity, link: Link, now: number): Aged {
  if (!link.reachable) return { entity: { ...e, status: "unknown", statusReason: `agent unreachable since ${link.since.toISOString()}` }, stale: false };
  const sources = link.state!.sources;
  // an entity without a source (older agent) ages by the slowest source, the most lenient choice
  const period = sources.find(s => s.id === e.source)?.periodMs ?? Math.max(0, ...sources.map(s => s.periodMs));
  const ms = now - (Date.parse(e.observedAt) + link.skewMs);
  return ms > 3 * period ? { entity: { ...e, status: "unknown", statusReason: `stale: no data for ${Math.round(ms / 1000)} s` }, stale: true } : { entity: e, stale: false };
}

/** unknown only when we cannot see the server; a failing source or a stale reading means we are partly blind, which is never "ok". */
function rollUp(link: Link, statuses: Status[], stale: number, failing: number, starting: boolean): Pick<ServerView, "status" | "statusReason"> {
  if (!link.reachable) return { status: "unknown",
    statusReason: link.state ? `agent unreachable since ${link.since.toISOString().slice(11, 16)} UTC` : "not connected yet" };
  const known = statuses.filter(s => s !== "unknown");
  const blind = [failing && `${failing} ${failing === 1 ? "source" : "sources"} failing`, stale && `${stale} ${stale === 1 ? "reading" : "readings"} stale`].filter(Boolean).join(", ");
  if (!statuses.length && !failing) return starting ? { status: "unknown", statusReason: "starting" } : { status: "unknown", statusReason: "no data yet" };
  const top = worst(known);
  if (blind && (!known.length || top === "ok" || top === "unknown")) return { status: "attention", statusReason: blind };
  return known.length ? { status: top } : { status: "unknown", statusReason: "no known readings" };
}
