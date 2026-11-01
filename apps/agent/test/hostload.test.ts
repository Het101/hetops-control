import { describe, it, expect } from "vitest"; import { hostloadSource, quantity } from "../src/sources/hostload.js";
import nodes from "./fixtures/nodes.json"; import summary from "./fixtures/summary.json";
const kube = (s: unknown = summary, list: unknown[] = nodes.items) =>
  ({ listNodes: async () => list, nodeSummary: async (n: string) => { if (s instanceof Error || n === "broken") throw s instanceof Error ? s : new Error("connection refused"); return s; } }) as any;
const ctx = { server: "lab" as const, now: () => new Date("2026-10-30T12:00:00Z") };

describe("quantity", () => {
  it("reads millicores and binary suffixes", () => {
    expect(quantity("3500m")).toBe(3.5);
    expect(quantity("4")).toBe(4);
    expect(quantity("2Gi")).toBe(2 * 1024 ** 3);
    expect(quantity("24548180Ki")).toBe(24548180 * 1024);
    expect(quantity("1e3")).toBeNaN();
  });
});

describe("hostload source", () => {
  it("makes one node entity with cpu, memory and disk in percent", async () => {
    const { entities } = await hostloadSource(kube()).collect(ctx);
    expect(entities).toHaveLength(1);
    const n = entities[0]!;
    expect(n.id).toBe("lab/node/my-workspace");
    expect(n.facts.cpu?.value).toBe(Math.round(summary.node.cpu.usageNanoCores / (4 * 1e9) * 1000) / 10);
    for (const f of ["memory", "disk"]) {
      const v = Number(n.facts[f]?.value); expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(100);
    }
    expect(n.status).toBe("ok");
  });
  it("marks a node above 85% disk attention", async () => {
    const s = structuredClone(summary); s.node.fs.usedBytes = s.node.fs.capacityBytes * 0.9;
    expect((await hostloadSource(kube(s)).collect(ctx)).entities[0]!.status).toBe("attention");
  });
  it("isolates a node whose summary fails: unknown with a reason, other nodes unaffected", async () => {
    const list = [...nodes.items, { metadata: { name: "broken" }, status: { capacity: { cpu: "2", memory: "4Gi" } } }];
    const { entities } = await hostloadSource(kube(summary, list)).collect(ctx);
    expect(entities).toHaveLength(2);
    expect(entities[0]!.status).toBe("ok");
    expect(entities[1]!.status).toBe("unknown");
    expect(entities[1]!.statusReason).toContain("connection refused");
    expect(entities[1]!.facts).toEqual({});
  });
  it("omits a fact it cannot compute instead of emitting NaN", async () => {
    const s = structuredClone(summary) as any; delete s.node.cpu.usageNanoCores;
    const list = [{ metadata: { name: "my-workspace" }, status: { capacity: { cpu: "4", memory: "1e3" } } }];
    const n = (await hostloadSource(kube(s, list)).collect(ctx)).entities[0]!;
    expect(n.status).toBe("unknown");
    expect(n.facts.cpu).toBeUndefined(); expect(n.facts.memory).toBeUndefined();
    expect(n.facts.disk?.value).toBeTypeOf("number");
    expect(Object.values(n.facts).every(f => Number.isFinite(f.value))).toBe(true);
  });
});

describe("hostload history", () => {
  const at = (iso: string) => ({ server: "lab" as const, now: () => new Date(iso) });
  const withCpu = (nano: number) => { const s = structuredClone(summary); s.node.cpu.usageNanoCores = nano; return s; };
  it("keeps 10-minute means of the busiest node's cpu and memory as two series, and drops what is older than 24 h", async () => {
    let s: unknown = withCpu(2e9);   // 50% of 4 cores
    const src = hostloadSource({ listNodes: async () => nodes.items, nodeSummary: async () => s } as any);
    await src.collect(at("2026-10-29T11:55:00Z"));                  // more than 24 h before the last: dropped
    await src.collect(at("2026-10-30T12:01:00Z"));
    s = withCpu(1e9); await src.collect(at("2026-10-30T12:08:00Z")); // same bucket: 50 and 25 → 37.5
    s = withCpu(3e9); const out = await src.collect(at("2026-10-30T12:12:00Z")); // next bucket: 75
    const cpu = out.series!.find(x => x.id === "lab/host/cpu")!;
    expect(cpu).toMatchObject({ server: "lab", unit: "%", stepMs: 600_000, label: "CPU of the busiest node, 10-minute mean" });
    expect(cpu.points).toEqual([[Date.parse("2026-10-30T12:00:00Z"), 37.5], [Date.parse("2026-10-30T12:10:00Z"), 75]]);
    const mem = out.series!.find(x => x.id === "lab/host/memory")!;
    expect(mem.points).toHaveLength(2); expect(mem.points.every(p => p[1] > 0 && p[1] <= 100)).toBe(true);
  });
  it("a reading it cannot make adds nothing to the history", async () => {
    const s = structuredClone(summary) as any; delete s.node.cpu.usageNanoCores;
    const out = await hostloadSource(kube(s)).collect(ctx);
    expect(out.series!.find(x => x.id === "lab/host/cpu")!.points).toEqual([]);
  });
});
