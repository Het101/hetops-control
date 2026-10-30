import { describe, it, expect } from "vitest";
import { EntitySchema, AgentStateSchema, worst } from "../src/index.js";

const entity = { id: "lab/app/clinic/api", kind: "app", server: "lab", name: "api", status: "ok",
  facts: { pods: { value: 3, unit: "pods" }, restarts24h: { value: 0 } }, links: [], actions: [],
  observedAt: "2026-10-30T11:33:44Z", parent: "lab/cluster" };

describe("contracts", () => {
  it("accepts a valid entity", () => { expect(EntitySchema.parse(entity)).toEqual(entity); });
  it("rejects an unknown status", () => { expect(() => EntitySchema.parse({ ...entity, status: "green" })).toThrow(); });
  it("rejects a server outside the estate", () => { expect(() => EntitySchema.parse({ ...entity, server: "mars" })).toThrow(); });
  it("worst() orders down > attention > unknown > ok", () => {
    expect(worst(["ok", "attention"])).toBe("attention");
    expect(worst(["ok", "unknown"])).toBe("unknown");
    expect(worst(["attention", "down", "ok"])).toBe("down");
    expect(worst([])).toBe("unknown");
  });
  it("accepts an agent state with a failed source", () => {
    const s = { server: "lab", version: "0.1.0", generatedAt: "2026-10-30T11:33:44Z", entities: [entity],
      sources: [{ id: "kubernetes", periodMs: 10000, ok: true, lastRunAt: "2026-10-30T11:33:44Z" },
                { id: "argo", periodMs: 15000, ok: false, lastRunAt: "2026-10-30T11:33:40Z", error: "forbidden" }] };
    expect(AgentStateSchema.parse(s).sources[1]!.error).toBe("forbidden");
  });
});

import { SeriesSchema, CenterStateSchema, EntityKindSchema } from "../src/index.js";
const series = { id: "ops/logs/default", server: "ops", label: "log lines", unit: "lines/min", stepMs: 60000,
  points: [[1761820000000, 4], [1761820060000, 7]], observedAt: "2026-10-30T11:33:44Z" };
describe("series", () => {
  it("accepts a valid series", () => { expect(SeriesSchema.parse(series)).toEqual(series); });
  it("rejects bad points, step, server", () => {
    expect(() => SeriesSchema.parse({ ...series, points: [[1, "x"]] })).toThrow();
    expect(() => SeriesSchema.parse({ ...series, points: [[1, 2, 3]] })).toThrow();
    expect(() => SeriesSchema.parse({ ...series, stepMs: 0 })).toThrow();
    expect(() => SeriesSchema.parse({ ...series, server: "mars" })).toThrow();
  });
  it("caps points at 2000", () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => [i, i]);
    expect(SeriesSchema.safeParse({ ...series, points: pts(2000) }).success).toBe(true);
    expect(SeriesSchema.safeParse({ ...series, points: pts(2001) }).success).toBe(false);
  });
  it("an agent state without series still validates (old agents)", () => {
    const s = { server: "lab", version: "1", generatedAt: "2026-10-30T11:33:44Z", entities: [], sources: [] };
    expect(AgentStateSchema.parse(s).series).toBeUndefined();
    expect(AgentStateSchema.parse({ ...s, series: [series] }).series).toHaveLength(1);
  });
  it("center state requires series and knows the new kinds", () => {
    const v = { status: "unknown", reachable: false, configured: false, since: "2026-10-30T11:33:44Z" };
    const c = { generatedAt: "2026-10-30T11:33:44Z", servers: { lab: v, staging: v, ops: v }, entities: [] };
    expect(CenterStateSchema.safeParse(c).success).toBe(false);
    expect(CenterStateSchema.safeParse({ ...c, series: [] }).success).toBe(true);
    for (const k of ["alert", "site", "backup", "deploy", "slo", "decision"]) expect(EntityKindSchema.safeParse(k).success).toBe(true);
  });
});
