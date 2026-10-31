import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Entity, Series, Status } from "@hetops-control/contracts";
import type { Source } from "../registry.js";
import { json } from "./http.js";

// The calls the control-reader user may make (role control_reader: cluster monitor + read_slm, read on the two streams).
export interface EsReader { health(): Promise<any>; flow(): Promise<any>; slm(): Promise<any> }

export const STREAMS = ["default", "security"] as const;
const STEP = 10 * 60_000;
// one search over both data streams; buckets per backing index are summed per stream, so a rollover never splits a series
const FLOW = {
  size: 0, track_total_hits: false, query: { range: { "@timestamp": { gte: "now-24h/m" } } },
  aggs: { idx: { terms: { field: "_index", size: 64 }, aggs: { h: { date_histogram: { field: "@timestamp", fixed_interval: "10m",
    min_doc_count: 0, extended_bounds: { min: "now-24h/m", max: "now/m" } } } } } },
};

/** The Authorization header for a file-realm user whose username and password are files in authDir (read on every call). */
export const basicAuth = (authDir: string) => {
  const [u, p] = ["username", "password"].map(f => readFileSync(join(authDir, f), "utf8").trim());
  return { authorization: `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}` };
};

// credentials are read on every call (a rotated secret is picked up) and only ever go into the Authorization header
export function realEs(base: string, authDir: string): EsReader {
  const auth = () => basicAuth(authDir);
  return {
    health: () => json(`${base}/_cluster/health`, { headers: auth() }),
    flow: () => json(`${base}/${STREAMS.map(s => `logs-lab-${s}`).join(",")}/_search`,
      { method: "POST", headers: { ...auth(), "content-type": "application/json" }, body: JSON.stringify(FLOW) }),
    slm: () => json(`${base}/_slm/policy`, { headers: auth() }),
  };
}

const HEALTH: Record<string, Status> = { green: "ok", yellow: "attention", red: "down" };

export function elasticsearchSource(api: EsReader): Source {
  return {
    id: "elasticsearch", periodMs: 60_000,
    async collect({ server, now }) {
      const observedAt = now().toISOString();
      const [h, f] = await Promise.all([api.health(), api.flow()]);
      const health = String(h?.status ?? "unknown");
      const check: Entity = { id: `${server}/check/elasticsearch`, kind: "check", server, name: "Elasticsearch", parent: `${server}/cluster`,
        status: HEALTH[health] ?? "unknown", ...(health !== "green" ? { statusReason: `cluster health ${health}` } : {}),
        facts: { health: { value: health }, nodes: { value: Number(h?.number_of_nodes ?? 0) },
          unassignedShards: { value: Number(h?.unassigned_shards ?? 0) }, activeShards: { value: Number(h?.active_shards_percent_as_number ?? 0), unit: "%", max: 100 } },
        links: [], actions: [], observedAt };

      const agg = f?.aggregations?.idx;
      if (!agg || !Array.isArray(agg.buckets)) throw new Error("log flow: no aggregation in the response");
      // a partial sum would draw a dip that never happened
      if (agg.sum_other_doc_count > 0) throw new Error("log flow: more backing indices than the terms size");
      const sums = new Map<string, Map<number, number>>(STREAMS.map(s => [s, new Map()]));
      const grid = new Set<number>();
      for (const b of agg.buckets) {
        const stream = /^\.ds-logs-lab-([a-z0-9_-]+?)-\d{4}\.\d\d\.\d\d-\d+$/.exec(String(b.key))?.[1];
        const m = stream ? sums.get(stream) : undefined;
        for (const x of b.h?.buckets ?? []) { grid.add(x.key); if (m) m.set(x.key, (m.get(x.key) ?? 0) + x.doc_count); }
      }
      const keys = [...grid].sort((a, b) => a - b);
      const series: Series[] = STREAMS.map(s => ({ id: `${server}/logs/${s}`, server, label: `Lab logs: ${s}`, unit: "docs", stepMs: STEP,
        points: keys.map((k): [number, number] => [k, sums.get(s)!.get(k) ?? 0]), observedAt }));
      return { entities: [check], series };
    },
  };
}

const HOUR = 3600_000;
const when = (ms: unknown) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);
const reason = (details: unknown) => { try { return String(JSON.parse(String(details)).reason ?? details); } catch { return String(details ?? ""); } };

export function snapshotsSource(api: EsReader): Source {
  return {
    id: "snapshots", periodMs: 5 * 60_000,
    async collect({ server, now }) {
      const t = now().getTime(), observedAt = now().toISOString();
      const policies = await api.slm();
      if (!policies || typeof policies !== "object") throw new Error("slm: not an object");
      const entities = Object.entries<any>(policies).map(([name, p]): Entity => {
        const ok = p.last_success?.time, bad = p.last_failure?.time, st = p.stats ?? {};
        const lastOk = when(ok), ageHours = lastOk ? Math.round((t - ok) / HOUR * 10) / 10 : undefined;
        let status: Status = "ok", statusReason: string | undefined;
        if (!lastOk) { status = "down"; statusReason = "no successful snapshot on record"; }
        else if (typeof bad === "number" && bad > ok) { status = "attention"; statusReason = `last run failed: ${reason(p.last_failure.details).slice(0, 160)}`; }
        else if (ageHours! > 26) { status = "attention"; statusReason = `no snapshot for ${Math.floor(ageHours!)} h`; }   // nightly, plus slack
        const facts: Entity["facts"] = {
          repository: { value: String(p.policy?.repository ?? "") }, indices: { value: (p.policy?.config?.indices ?? []).join(", ") },
          snapshots: { value: Number(st.snapshots_taken ?? 0) - Number(st.snapshots_deleted ?? 0) }, failed: { value: Number(st.snapshots_failed ?? 0) },
        };
        if (lastOk) { facts.lastOk = { value: lastOk }; facts.ageHours = { value: ageHours!, unit: "h" }; }
        const lastFailure = when(bad), nextRun = when(p.next_execution_millis);
        if (lastFailure) facts.lastFailure = { value: lastFailure };
        if (nextRun) facts.nextRun = { value: nextRun };
        return { id: `${server}/backup/${name}`, kind: "backup", server, name, status, ...(statusReason ? { statusReason } : {}),
          facts, links: [], actions: [], observedAt };
      });
      return { entities };
    },
  };
}
