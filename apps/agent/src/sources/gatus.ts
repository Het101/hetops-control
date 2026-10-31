import type { Entity, Series, Status } from "@hetops-control/contracts";
import type { Source } from "../registry.js";
import { http, json } from "./http.js";

/** One endpoint's history as Gatus holds it: state changes (newest 50, oldest first) and the mean response time per hour, in ms. */
export interface GatusHistory { events: { type: string; timestamp: string }[]; responseTimes: { timestamps: number[]; values: number[] } }
// Gatus's API, shaped as recorded (test/fixtures/gatus-*.json). results are oldest first.
export interface GatusReader { statuses(): Promise<any[]>; uptime24h(key: string): Promise<number>; history(key: string): Promise<GatusHistory> }

export function realGatus(base: string): GatusReader {
  const at = (key: string) => `${base}/api/v1/endpoints/${encodeURIComponent(key)}`;
  return {
    statuses: () => json(`${base}/api/v1/endpoints/statuses`),
    // a bare ratio such as "0.999285"; the statuses page only holds the last results, Gatus keeps the hourly uptime
    uptime24h: async (key) => {
      const v = Number(await http(`${at(key)}/uptimes/24h`));
      if (!Number.isFinite(v)) throw new Error("uptime is not a number");
      return v;
    },
    // Gatus exposes no hourly uptime, but its events (every flip between healthy and unhealthy, from START) give the down time
    // exactly, and response-times/24h/history gives the hourly mean; both survive an agent restart
    history: async (key) => {
      const [s, rt] = await Promise.all([json(`${at(key)}/statuses?pageSize=1`), json(`${at(key)}/response-times/24h/history`)]);
      return { events: Array.isArray(s?.events) ? s.events : [], responseTimes: { timestamps: rt?.timestamps ?? [], values: rt?.values ?? [] } };
    },
  };
}

const MIN = 60_000, HOUR = 60 * MIN;
// public sites and products are sites; the log, snapshot and watcher checks are checks
const SITE_GROUPS = new Set(["sites", "products"]);
/** sites that get a 24 h history: two series each, well inside the agent's MAX_SERIES (64) beside the other ops sources */
export const HISTORY_SITES = 20;
const iso = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isNaN(t) ? undefined : t; };

/**
 * The last `hours` clock hours (the current one partial) as [hour start, uptime %] and [hour start, mean ms]. An hour Gatus did not
 * watch (before its last START, or before the oldest event it still holds) has no point: the board draws it hollow, never up.
 */
export function hourly(h: GatusHistory, now: number, hours = 24): { uptime: [number, number][]; latency: [number, number][] } {
  const evs = h.events.flatMap(e => { const t = iso(e.timestamp); return t === undefined || t > now ? [] : [{ type: e.type, t }]; }).sort((a, b) => a.t - b.t);
  const start = evs.findLast(e => e.type === "START"), from = start?.t ?? evs[0]?.t;
  // down from each UNHEALTHY to the next HEALTHY (or START: what came before a restart is not known), or to now
  const down: [number, number][] = []; let since: number | undefined;
  for (const e of evs) { if (e.type === "UNHEALTHY") since ??= e.t; else if (since !== undefined) { down.push([since, e.t]); since = undefined; } }
  if (since !== undefined) down.push([since, now]);
  const end = Math.floor(now / HOUR) * HOUR, first = end - (hours - 1) * HOUR;
  const uptime: [number, number][] = [];
  for (let s = first; s <= end && from !== undefined; s += HOUR) {
    const a = Math.max(s, from), b = Math.min(s + HOUR, now);
    if (b <= a) continue;
    const lost = down.reduce((n, [x, y]) => n + Math.max(0, Math.min(y, b) - Math.max(x, a)), 0);
    uptime.push([s, Math.round((1 - lost / (b - a)) * 10000) / 100]);
  }
  const ms = new Map<number, number>();
  h.responseTimes.timestamps.forEach((t, i) => { const v = h.responseTimes.values[i];
    if (Number.isFinite(t) && t >= first && t <= end && typeof v === "number" && Number.isFinite(v)) ms.set(Math.floor(t / HOUR) * HOUR, v); });
  return { uptime, latency: [...ms].sort((x, y) => x[0] - y[0]) };
}

export function gatusSource(api: GatusReader): Source {
  return {
    id: "gatus", periodMs: 30_000,
    async collect({ server, now }) {
      const t = now().getTime(), observedAt = now().toISOString();
      const endpoints = await api.statuses();
      if (!Array.isArray(endpoints)) throw new Error("statuses is not a list");
      let withHistory = 0;
      const out = await Promise.all(endpoints.map(async (e): Promise<{ entity: Entity; series: Series[] }> => {
        const results: any[] = Array.isArray(e.results) ? e.results : [];
        const last = results.at(-1), lastAt = iso(last?.timestamp);
        let fails = 0;
        for (let i = results.length - 1; i >= 0 && !results[i].success; i--) fails++;
        // how often this endpoint is checked, from its own results; no new result for 3 intervals means Gatus stopped watching it
        const prevAt = iso(results.at(-2)?.timestamp);
        const every = lastAt !== undefined && prevAt !== undefined ? Math.max(lastAt - prevAt, MIN) : 5 * MIN;
        let status: Status = "ok", statusReason: string | undefined;
        if (!last || lastAt === undefined) { status = "unknown"; statusReason = "no results yet"; }
        else if (t - lastAt > 3 * every) { status = "unknown"; statusReason = `no result for ${Math.floor((t - lastAt) / MIN)} min`; }
        else if (fails) {
          // Gatus alerts after 3 failures in a row: that is down; one or two is a blip worth a look
          status = fails >= 3 ? "down" : "attention";
          const why = last.conditionResults?.find((c: any) => !c.success)?.condition ?? last.errors?.[0] ?? "failed";
          statusReason = `${fails} failed in a row: ${String(why).slice(0, 120)}`;
        }
        const kind = SITE_GROUPS.has(e.group) ? "site" as const : "check" as const;
        const id = `${server}/${kind}/${String(e.key).replace(/[^A-Za-z0-9_.-]+/g, "-")}`;
        // past the cap a site keeps its row, only without history (drawn hollow)
        const wantHistory = kind === "site" && withHistory++ < HISTORY_SITES;
        const [uptime, hist] = await Promise.all([
          api.uptime24h(e.key).catch(() => undefined),   // the fact is left out; the status above stands
          wantHistory ? api.history(e.key).catch(() => undefined) : undefined]);
        const facts: Entity["facts"] = { group: { value: String(e.group ?? "") } };
        if (typeof last?.status === "number") facts.httpStatus = { value: last.status };
        if (typeof last?.duration === "number") facts.latencyMs = { value: Math.round(last.duration / 1e5) / 10, unit: "ms" };   // ns
        if (uptime !== undefined) facts.uptime24h = { value: Math.round(uptime * 10000) / 100, unit: "%", max: 100 };
        if (lastAt !== undefined) facts.lastCheck = { value: new Date(lastAt).toISOString() };
        const host = typeof last?.hostname === "string" && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(last.hostname) ? last.hostname.toLowerCase() : undefined;
        if (host) facts.host = { value: host };
        const links = kind === "site" && host && !host.endsWith(".svc") ? [{ label: host, href: `https://${host}` }] : [];
        const series: Series[] = [];
        if (hist) {
          const h = hourly(hist, t), name = String(e.name);
          series.push({ id: `${id}/uptime-1h`, server, label: `${name}: uptime per hour`, unit: "%", stepMs: HOUR, points: h.uptime, observedAt },
            { id: `${id}/latency-1h`, server, label: `${name}: mean response time per hour`, unit: "ms", stepMs: HOUR, points: h.latency, observedAt });
        }
        return { entity: { id, kind, server, name: String(e.name), status, ...(statusReason ? { statusReason } : {}), facts, links, actions: [], observedAt }, series };
      }));
      return { entities: out.map(o => o.entity), series: out.flatMap(o => o.series) };
    },
  };
}
