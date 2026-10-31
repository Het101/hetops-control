import type { Entity, ServerId, Status } from "@hetops-control/contracts";
import { num, type State } from "./api.js";
import { ago, hhmm, sourceState, span, str, time } from "./pages.js";

/**
 * The estate's wiring as a static model (from the infra: tunnels, tailnet, log shipping, snapshots), with the live state laid
 * over it. Every edge's state comes from the real signals that prove it; no signal is unknown, never green by default.
 */

/** a link's state: a status, or planned (not built yet, drawn dashed and hollow) */
export type LinkState = Status | "planned";
export type Signal = { label: string; state: LinkState; detail: string; entity?: string };
export type Flow = { dots: number; secs: number };
type Link = { label: string; href: string };
export type NodeId = "world" | "cloudflare" | "r2" | "lab" | "staging" | "ops" | "disk";

type NodeModel = { id: NodeId; name: string; sub: string; x: number; y: number; server?: ServerId; facts: [string, string][]; links: Link[] };
type EdgeModel = { id: string; from: NodeId; to: NodeId; name: string; via: string; d: string; at: [number, number]; facts: [string, string][]; links: Link[] };

/** the map's own coordinate space; the page scales it */
export const W = 1200, H = 540;
const TS = { label: "Tailscale machines", href: "https://login.tailscale.com/admin/machines" };
const CF = { label: "Cloudflare tunnels", href: "https://one.dash.cloudflare.com" };

export const NODES: NodeModel[] = [
  { id: "world", name: "The internet", sub: "visitors and probes", x: 130, y: 80, facts: [["reaches", "the estate only through Cloudflare"]], links: [] },
  { id: "cloudflare", name: "Cloudflare", sub: "edge · tunnels · Access", x: 600, y: 80,
    facts: [["serves", "hetops.dev sites, control.hetops.dev, kibana-ops.hetops.dev"], ["guards", "Cloudflare Access in front of control and Kibana"]], links: [CF] },
  { id: "r2", name: "Cloudflare R2", sub: "hetops-logs-security", x: 1070, y: 80,
    facts: [["bucket", "hetops-logs-security"], ["holds", "nightly-security snapshots"]], links: [{ label: "R2 buckets", href: "https://dash.cloudflare.com" }] },
  { id: "lab", name: "Lab", sub: "my-workspace · 100.93.151.22", x: 230, y: 300, server: "lab",
    facts: [["host", "my-workspace"], ["tailnet", "100.93.151.22 · tag:lab"], ["serves", "the public hetops.dev sites through Traefik and Coolify"]],
    links: [{ label: "Apps", href: "/apps" }, TS] },
  { id: "staging", name: "Staging", sub: "tag:staging · joining next", x: 600, y: 290, server: "staging",
    facts: [["tailnet", "tag:staging, not joined yet"]], links: [TS] },
  { id: "ops", name: "Ops", sub: "hetops-3 · 100.89.67.82", x: 970, y: 300, server: "ops",
    facts: [["host", "hetops-3"], ["tailnet", "100.89.67.82 · tag:ops"], ["runs", "this center, Gatus, Elasticsearch and Kibana"]],
    links: [{ label: "Kibana", href: "https://kibana-ops.hetops.dev" }, TS] },
  { id: "disk", name: "Ops disk", sub: "local snapshot repo", x: 1110, y: 455, facts: [["holds", "nightly-all snapshots"]], links: [{ label: "Backups", href: "/backups" }] },
];

export const EDGES: EdgeModel[] = [
  { id: "public", from: "world", to: "cloudflare", name: "Public HTTPS", via: "HTTPS", d: "M130 80 H600", at: [365, 80],
    facts: [["path", "visitors and Gatus probes → Cloudflare"]], links: [] },
  { id: "tunnel-lab", from: "cloudflare", to: "lab", name: "Cloudflare Tunnel to the lab", via: "TUNNEL", d: "M600 80 C600 190 230 170 230 300", at: [415, 183],
    facts: [["serves", "the public hetops.dev sites"], ["through", "Traefik and Coolify on the lab"]], links: [CF] },
  { id: "tunnel-ops", from: "cloudflare", to: "ops", name: "Cloudflare Tunnel to ops", via: "TUNNEL", d: "M600 80 C600 190 970 170 970 300", at: [785, 183],
    facts: [["serves", "control.hetops.dev, kibana-ops.hetops.dev"], ["behind", "Cloudflare Access"]], links: [CF, { label: "Kibana", href: "https://kibana-ops.hetops.dev" }] },
  { id: "agent-lab", from: "ops", to: "lab", name: "Center to the lab agent", via: "TCP 7443", d: "M970 300 Q600 480 230 300", at: [600, 390],
    facts: [["over", "Tailscale, ops → lab"], ["port", "tcp 7443"]], links: [TS] },
  { id: "gateway", from: "ops", to: "lab", name: "Gatus to the lab gateway", via: "PROBE", d: "M970 300 Q600 560 230 300", at: [600, 430],
    facts: [["over", "Tailscale, ops → lab"], ["checks", "the lab gateway answers"]], links: [] },
  { id: "logs", from: "lab", to: "ops", name: "Lab logs to ops", via: "9200", d: "M230 300 Q600 640 970 300", at: [600, 470],
    facts: [["over", "Tailscale, lab → ops"], ["port", "9200"], ["ships", "filebeat → Elasticsearch, logs-lab-default and logs-lab-security"]],
    links: [{ label: "Kibana", href: "https://kibana-ops.hetops.dev" }] },
  { id: "agent-staging", from: "ops", to: "staging", name: "Center to the staging agent", via: "TCP 7443", d: "M970 300 L600 290", at: [785, 295],
    facts: [["over", "Tailscale, ops → staging"], ["port", "tcp 7443"]], links: [TS] },
  { id: "snap-disk", from: "ops", to: "disk", name: "Snapshots to the ops disk", via: "NIGHTLY", d: "M970 300 Q1110 330 1110 455", at: [1075, 355],
    facts: [["policy", "nightly-all"], ["repository", "local disk on ops"]], links: [{ label: "Backups", href: "/backups" }] },
  { id: "snap-r2", from: "ops", to: "r2", name: "Security snapshots to R2", via: "NIGHTLY", d: "M970 300 C1070 220 1070 160 1070 80", at: [1058, 190],
    facts: [["policy", "nightly-security"], ["bucket", "hetops-logs-security"]], links: [{ label: "Backups", href: "/backups" }] },
];

const MIN = 60_000;
const RANK: Record<LinkState, number> = { down: 0, attention: 1, unknown: 2, ok: 3, planned: 4 };
/** the worst of the signals; none at all is unknown */
export const worst = (s: Signal[]): LinkState => s.length ? s.map(x => x.state).sort((a, b) => RANK[a] - RANK[b])[0]! : "unknown";
export const WORD: Record<LinkState, string> = { ok: "CARRYING TRAFFIC", attention: "NEEDS A LOOK", down: "DOWN", unknown: "NO SIGNAL", planned: "NOT BUILT YET" };
export const hot = (s: LinkState) => s === "down" || s === "attention";

/** why a server's readings cannot be trusted right now: its agent is unreachable, or the source is failing */
function blind(state: State, server: ServerId, source: string): string | undefined {
  const v = state.servers[server];
  if (!v.reachable) return `can't read ${source}: the ${server} agent is unreachable`;
  const f = sourceState(state, source).failing.find(x => x.server === server);
  return f ? `can't read ${source} on ${server}: ${f.error}` : undefined;
}

/** a single check or backup entity as a signal; blind when its source can't be read */
function entitySignal(state: State, e: Entity, label: string, detail?: string): Signal {
  const b = blind(state, e.server, e.source ?? e.kind);
  if (b) return { label, state: "unknown", detail: b, entity: e.id };
  return { label, state: e.status, detail: e.statusReason ?? detail ?? (e.status === "ok" ? "passing" : e.status), entity: e.id };
}

/** a group of site checks as one signal: all failing is down, some failing needs a look, any unread is unknown */
function sitesSignal(state: State, sites: Entity[], label: string, anyOk = false): Signal[] {
  if (!sites.length) return [];
  const b = blind(state, sites[0]!.server, "gatus");
  if (b) return [{ label, state: "unknown", detail: b }];
  const failing = sites.filter(e => hot(e.status)), ok = sites.filter(e => e.status === "ok").length;
  const names = failing.slice(0, 3).map(e => `${e.name} ${e.status}`).join(", ");
  let s: LinkState;
  if (anyOk) s = ok ? "ok" : failing.length ? "down" : "unknown";
  else s = failing.length === sites.length ? "down" : failing.length ? "attention" : ok === sites.length ? "ok" : "unknown";
  const detail = failing.length ? `${failing.length} of ${sites.length} failing: ${names}` : `${ok} of ${sites.length} answering`;
  return [{ label, state: s, detail }];
}

/** the center's link to an agent: never configured is planned, reachable is ok, configured and unreachable is down */
function agentSignal(state: State, server: ServerId, now: number): Signal {
  const v = state.servers[server], label = `${server} agent`;
  if (!v.configured) return { label, state: "planned", detail: v.statusReason ?? "not connected yet" };
  if (v.reachable) return { label, state: "ok", detail: `answering since ${hhmm(v.since)} UTC (${ago(v.since, now)})` };
  return { label, state: "down", detail: `unreachable since ${hhmm(v.since)} UTC, ${ago(v.since, now)}${v.lastError ? `: ${v.lastError}` : ""}` };
}

/**
 * Log flow over the last 10 minutes from the ops/logs/* series (10-min buckets: every bucket that overlaps the window counts).
 * Flowing is ok with a docs/min rate; nothing is down, with how long ago the last doc arrived.
 */
export function logFlow(state: State, now: number): { signal?: Signal; perMin?: number } {
  const series = state.series.filter(s => /^ops\/logs\//.test(s.id));
  if (!series.length) return {};
  const label = "log docs, last 10 min";
  const b = blind(state, "ops", "elasticsearch");
  if (b) return { signal: { label, state: "unknown", detail: b } };
  let docs = 0, from = now, lastDoc: number | undefined;
  for (const s of series) for (const [t, v] of s.points) {
    if (t + s.stepMs > now - 10 * MIN && t <= now) { docs += v; from = Math.min(from, t); }
    if (v > 0) lastDoc = Math.max(lastDoc ?? 0, Math.min(t + s.stepMs, now));
  }
  if (docs > 0) {
    const perMin = Math.round(docs / Math.max((now - from) / MIN, 1));
    return { perMin, signal: { label, state: "ok", detail: `${perMin.toLocaleString()} docs/min` } };
  }
  return { perMin: 0, signal: { label, state: "down", detail: lastDoc === undefined ? "no logs from the lab in the last 24 h" : `the last log arrived ${span(now - lastDoc)} ago` } };
}

export type EdgeView = EdgeModel & { state: LinkState; reason: string; signals: Signal[]; flow?: Flow; perMin?: number };
export type NodeView = NodeModel & { state: LinkState; reason: string; signals: Signal[]; stats?: string };

const sitesOf = (state: State, ops: boolean) => state.entities.filter(e => e.server === "ops" && (e.kind === "site" || e.kind === "check")
  && (ops ? /control|kibana/i.test(`${e.id} ${e.name}`) && (e.kind === "site" || str(e, "group") === "watchers") : e.kind === "site" && !/control|kibana/i.test(`${e.id} ${e.name}`)));
const check = (state: State, re: RegExp) => state.entities.filter(e => e.kind === "check" && e.server === "ops" && e.source === "gatus" && re.test(e.name));
const backupTo = (state: State, r2: boolean) => state.entities.filter(e => e.kind === "backup" && /r2/i.test(str(e, "repository") ?? e.name) === r2);

/** dots for a flowing edge: busier links get more and faster dots; a stopped, unknown or planned link has none */
export function flowOf(state: LinkState, perMin?: number, base: Flow = { dots: 2, secs: 5 }): Flow | undefined {
  if (state !== "ok" && state !== "attention") return undefined;
  if (perMin === undefined) return base;
  if (perMin <= 0) return undefined;
  const l = Math.log10(perMin + 1);
  return { dots: Math.min(6, Math.max(1, Math.round(l * 1.4))), secs: Math.round(Math.min(9, Math.max(1.8, 9 - l * 2)) * 10) / 10 };
}

function signalsFor(state: State, id: string, now: number, logs: ReturnType<typeof logFlow>): Signal[] {
  const ent = (list: Entity[], label: (e: Entity) => string, detail?: (e: Entity) => string | undefined) => list.map(e => entitySignal(state, e, label(e), detail?.(e)));
  const lastOk = (e: Entity) => { const t = time(e, "lastOk"); return t ? `last ok ${hhmm(t)} UTC, ${ago(t, now)}` : undefined; };
  switch (id) {
    case "public": return sitesSignal(state, sitesOf(state, false).concat(sitesOf(state, true)), "any public site answering", true);
    case "tunnel-lab": return sitesSignal(state, sitesOf(state, false), "public sites (Gatus)");
    case "tunnel-ops": return ent(sitesOf(state, true), e => e.name);
    case "agent-lab": return [agentSignal(state, "lab", now)];
    case "agent-staging": return [agentSignal(state, "staging", now)];
    case "gateway": return ent(check(state, /gateway|tailscale/i), e => e.name);
    case "logs": return [...ent(check(state, /arriv/i), e => e.name), ...(logs.signal ? [logs.signal] : [])];
    case "snap-disk": return ent(backupTo(state, false), e => `${e.name} snapshot`, lastOk);
    case "snap-r2": return ent(backupTo(state, true), e => `${e.name} snapshot`, lastOk);
  }
  return [];
}

export function topology(state: State, now: number): { nodes: NodeView[]; edges: EdgeView[]; headline: string } {
  const logs = logFlow(state, now);
  const edges: EdgeView[] = EDGES.map(m => {
    const signals = signalsFor(state, m.id, now, logs);
    // planned only while every signal says so; one real signal makes it a live link
    const st = signals.length && signals.every(s => s.state === "planned") ? "planned" : worst(signals.filter(s => s.state !== "planned"));
    const bad = signals.find(s => s.state === st);
    const reason = !signals.length ? "no signal reports on this link yet" : st === "ok" ? [...new Set(signals.map(s => s.detail))].join(" · ") : bad?.detail ?? st;
    const perMin = m.id === "logs" ? logs.perMin : undefined;
    const base = m.id.startsWith("snap") ? { dots: 1, secs: 9 } : m.id.startsWith("tunnel") || m.id === "public" ? { dots: 3, secs: 4.5 } : { dots: 2, secs: 4 };
    return { ...m, state: st, reason, signals, perMin, flow: flowOf(st, perMin, base) };
  });
  const nodes: NodeView[] = NODES.map(m => {
    const touching = edges.filter(e => e.from === m.id || e.to === m.id);
    const signals = touching.map((e): Signal => ({ label: e.name, state: e.state, detail: e.reason }));
    if (!m.server) {
      // an outside service is fine while anything gets through it; a single failing link is that link's ember, not the service's
      const live = signals.filter(s => s.state !== "planned");
      const st = live.some(s => s.state === "ok") ? "ok" : worst(live);
      const all = live.every(s => s.state === "ok");
      return { ...m, state: st, reason: st === "ok" ? (all ? "every link to it carries traffic" : "carrying traffic; a link through it needs a look")
        : signals.find(s => s.state === st)?.detail ?? st, signals };
    }
    const v = state.servers[m.server];
    const cluster = state.entities.find(e => e.kind === "cluster" && e.server === m.server);
    const apps = state.entities.filter(e => e.kind === "app" && e.server === m.server).length;
    const run = num(cluster, "podsRunning"), tot = num(cluster, "podsTotal");
    const stats = cluster ? [`${apps} apps`, run !== undefined && tot !== undefined ? `${run}/${tot} pods` : undefined].filter(Boolean).join(" · ") : undefined;
    const st: LinkState = !v.configured ? "planned" : !v.reachable ? "down" : v.status;
    return { ...m, state: st, reason: v.statusReason ?? (st === "ok" ? "healthy" : st), signals, stats };
  });
  return { nodes, edges, headline: headlineOf(edges) };
}

/** one sentence about the links: what needs the owner first, then what is blind, else all carrying traffic */
export function headlineOf(edges: EdgeView[]): string {
  const live = edges.filter(e => e.state !== "planned");
  const bad = live.filter(e => hot(e.state)).sort((a, b) => RANK[a.state] - RANK[b.state]);
  if (bad.length) {
    const first = bad[0]!, stopped = first.id === "logs" ? /last log arrived (.+?) ago/.exec(first.signals.map(s => s.detail).join(" "))?.[1] : undefined;
    const lead = stopped ? `Logs from the lab stopped ${stopped} ago.` : `${first.name} ${first.state === "down" ? "is down" : "needs a look"}.`;
    return bad.length > 1 ? `${lead} ${bad.length - 1} more link${bad.length > 2 ? "s need" : " needs"} you.` : lead;
  }
  const blindN = live.filter(e => e.state === "unknown").length;
  if (blindN === live.length) return "No link reports a signal yet.";
  if (blindN) return `Every link that reports is carrying traffic; ${blindN} ${blindN === 1 ? "has" : "have"} no signal yet.`;
  return "Every link is carrying traffic.";
}
