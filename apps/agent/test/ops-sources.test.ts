import { describe, it, expect } from "vitest"; import { EntitySchema, SeriesSchema } from "@hetops-control/contracts";
import { gatusSource } from "../src/sources/gatus.js"; import { elasticsearchSource, snapshotsSource } from "../src/sources/elasticsearch.js";
import { buildSources } from "../src/sources/index.js";
// Recorded on hetops-3, 30 Oct 2026 (no secrets, no IPs). es-flow.json was recorded with a terms size of 2, which is why
// it has sum_other_doc_count > 0 and only the default stream's two backing indices.
import statuses from "./fixtures/gatus-statuses.json"; import uptimes from "./fixtures/gatus-uptimes.json";
import health from "./fixtures/es-health.json"; import slm from "./fixtures/es-slm.json"; import flow from "./fixtures/es-flow.json";

const at = (iso: string) => ({ server: "ops" as const, now: () => new Date(iso) });
const NOW = "2026-10-30T19:20:00Z";
const gatus = (s: any[] = statuses, up: Record<string, string> = uptimes) =>
  ({ statuses: async () => s, uptime24h: async (k: string) => { if (!(k in up)) throw new Error("404"); return Number(up[k]); } });
const es = (over: Record<string, unknown> = {}) => ({ health: async () => health, slm: async () => slm, flow: async () => complete(), ...over }) as any;
const complete = () => { const f = structuredClone(flow) as any; f.aggregations.idx.sum_other_doc_count = 0; return f; };

describe("gatus source (recorded)", () => {
  it("makes one schema-valid entity per endpoint: sites and products are sites, the rest checks", async () => {
    const { entities } = await gatusSource(gatus()).collect(at(NOW));
    expect(entities).toHaveLength(statuses.length);
    for (const e of entities) EntitySchema.parse(e);
    expect(entities.filter(e => e.kind === "site").length).toBe(statuses.filter(s => ["sites", "products"].includes(s.group)).length);
    expect(entities.every(e => e.status === "ok")).toBe(true);
    const portfolio = entities.find(e => e.name === "Portfolio")!;
    expect(portfolio.id).toBe("ops/site/sites_portfolio");
    expect(portfolio.facts.httpStatus?.value).toBe(200);
    expect(portfolio.facts.uptime24h?.value).toBe(100);
    expect(entities.find(e => e.name === "Radar Cloud")!.facts.uptime24h?.value).toBe(99.93);
    expect(entities.find(e => e.name.startsWith("Nightly snapshot (all"))!.id).toBe("ops/check/logs_nightly-snapshot--all-logs--local-");
  });
  it("is attention after one or two failures and down after three", async () => {
    const s = structuredClone(statuses) as any[]; const r = s.find(e => e.key === "sites_portfolio").results;
    r.at(-1).success = false; r.at(-1).conditionResults[0].success = false;
    let e = (await gatusSource(gatus(s)).collect(at(NOW))).entities.find(x => x.name === "Portfolio")!;
    expect([e.status, e.statusReason]).toEqual(["attention", "1 failed in a row: [STATUS] < 300"]);
    r.at(-2).success = false; r.at(-3).success = false;
    e = (await gatusSource(gatus(s)).collect(at(NOW))).entities.find(x => x.name === "Portfolio")!;
    expect(e.status).toBe("down");
  });
  it("is unknown, never ok, when Gatus has stopped producing results, and keeps the entity when the uptime call fails", async () => {
    const { entities } = await gatusSource(gatus(statuses, {})).collect(at("2026-10-30T21:00:00Z"));
    expect(entities.every(e => e.status === "unknown" && /^no result for \d+ min$/.test(e.statusReason!))).toBe(true);
    expect(entities.every(e => e.facts.uptime24h === undefined)).toBe(true);
  });
});

describe("elasticsearch source (recorded)", () => {
  it("reports cluster health as a check and the log flow as two 10-minute series", async () => {
    const out = await elasticsearchSource(es()).collect(at(NOW));
    const [check] = out.entities; EntitySchema.parse(check);
    expect([check!.id, check!.status, check!.facts.health?.value]).toEqual(["ops/check/elasticsearch", "ok", "green"]);
    expect(out.series!.map(s => s.id)).toEqual(["ops/logs/default", "ops/logs/security"]);
    for (const s of out.series!) SeriesSchema.parse(s);
    const [def, sec] = out.series!;
    expect(def!.points).toHaveLength(145);
    const [a, b] = flow.aggregations.idx.buckets;   // two backing indices of the default stream, summed per bucket
    expect(def!.points[100]).toEqual([a!.h.buckets[100]!.key, a!.h.buckets[100]!.doc_count + b!.h.buckets[100]!.doc_count]);
    expect(sec!.points.every(p => p[1] === 0)).toBe(true);
  });
  it("fails rather than draw a partial flow, and maps red to down", async () => {
    await expect(elasticsearchSource(es({ flow: async () => flow })).collect(at(NOW))).rejects.toThrow(/more backing indices/);
    const { entities } = await elasticsearchSource(es({ health: async () => ({ ...health, status: "red" }) })).collect(at(NOW));
    expect([entities[0]!.status, entities[0]!.statusReason]).toEqual(["down", "cluster health red"]);
  });
});

describe("snapshots source (recorded)", () => {
  it("makes one backup per SLM policy with lastOk, age, count and next run", async () => {
    const { entities } = await snapshotsSource(es()).collect(at(NOW));
    for (const e of entities) EntitySchema.parse(e);
    const all = entities.find(e => e.id === "ops/backup/nightly-all")!;
    expect(all.status).toBe("ok");
    expect(all.facts.lastOk?.value).toBe(new Date(slm["nightly-all"].last_success.time).toISOString());
    expect(all.facts.snapshots?.value).toBe(3);
    expect(all.facts.repository?.value).toBe("local");
    expect(all.facts.nextRun?.value).toBe(new Date(slm["nightly-all"].next_execution_millis).toISOString());
    const sec = entities.find(e => e.id === "ops/backup/nightly-security")!;
    expect(sec.status).toBe("ok");                      // its failure is older than its last success
    expect(sec.facts.lastFailure).toBeDefined();
  });
  it("needs you when the last run failed or no snapshot came for 26 h, and is down with none on record", async () => {
    const s = structuredClone(slm) as any;
    s["nightly-security"].last_failure.time = s["nightly-security"].last_success.time + 1;
    delete s["nightly-all"].last_success;
    const { entities } = await snapshotsSource(es({ slm: async () => s })).collect(at(NOW));
    const sec = entities.find(e => e.name === "nightly-security")!;
    expect(sec.status).toBe("attention");
    expect(sec.statusReason).toBe("last run failed: [r2] Could not determine repository generation from root blobs");
    const all = entities.find(e => e.name === "nightly-all")!;
    expect([all.status, all.facts.lastOk]).toEqual(["down", undefined]);
    const late = await snapshotsSource(es()).collect(at("2026-11-01T12:00:00Z"));
    expect(late.entities.every(e => e.status === "attention" && /^no snapshot for \d+ h$/.test(e.statusReason!))).toBe(true);
  });
});

describe("buildSources", () => {
  it("adds the ops sources only where their URLs are set", () => {
    const kube = {} as any;
    expect(buildSources(kube, {}).map(s => s.id)).toEqual(["kubernetes", "argo", "hostload"]);
    expect(buildSources(kube, { GATUS_URL: "http://gatus.watch.svc:8080", ES_URL: "https://ops-logs-es-http.logging.svc:9200" }).map(s => s.id))
      .toEqual(["kubernetes", "argo", "hostload", "gatus", "elasticsearch", "snapshots"]);
  });
});
