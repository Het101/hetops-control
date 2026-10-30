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
