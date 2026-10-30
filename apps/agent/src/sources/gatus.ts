import type { Entity, Status } from "@hetops-control/contracts";
import type { Source } from "../registry.js";
import { http, json } from "./http.js";

// Gatus's API, shaped as recorded (test/fixtures/gatus-*.json). results are oldest first.
export interface GatusReader { statuses(): Promise<any[]>; uptime24h(key: string): Promise<number> }

export function realGatus(base: string): GatusReader {
  return {
    statuses: () => json(`${base}/api/v1/endpoints/statuses`),
    // a bare ratio such as "0.999285"; the statuses page only holds the last results, Gatus keeps the hourly uptime
    uptime24h: async (key) => {
      const v = Number(await http(`${base}/api/v1/endpoints/${encodeURIComponent(key)}/uptimes/24h`));
      if (!Number.isFinite(v)) throw new Error("uptime is not a number");
      return v;
    },
  };
}

const MIN = 60_000;
// public sites and products are sites; the log, snapshot and watcher checks are checks
const SITE_GROUPS = new Set(["sites", "products"]);
const iso = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isNaN(t) ? undefined : t; };

export function gatusSource(api: GatusReader): Source {
  return {
    id: "gatus", periodMs: 30_000,
    async collect({ server, now }) {
      const t = now().getTime(), observedAt = now().toISOString();
      const endpoints = await api.statuses();
      if (!Array.isArray(endpoints)) throw new Error("statuses is not a list");
      const entities = await Promise.all(endpoints.map(async (e): Promise<Entity> => {
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
        let uptime: number | undefined;
        try { uptime = await api.uptime24h(e.key); } catch { /* the fact is left out; the status above stands */ }
        const kind = SITE_GROUPS.has(e.group) ? "site" as const : "check" as const;
        const facts: Entity["facts"] = { group: { value: String(e.group ?? "") } };
        if (typeof last?.status === "number") facts.httpStatus = { value: last.status };
        if (typeof last?.duration === "number") facts.latencyMs = { value: Math.round(last.duration / 1e5) / 10, unit: "ms" };   // ns
        if (uptime !== undefined) facts.uptime24h = { value: Math.round(uptime * 10000) / 100, unit: "%", max: 100 };
        if (lastAt !== undefined) facts.lastCheck = { value: new Date(lastAt).toISOString() };
        return { id: `${server}/${kind}/${String(e.key).replace(/[^A-Za-z0-9_.-]+/g, "-")}`, kind, server, name: String(e.name), status,
          ...(statusReason ? { statusReason } : {}), facts, links: [], actions: [], observedAt };
      }));
      return { entities };
    },
  };
}
