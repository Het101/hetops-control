import { describe, it, expect } from "vitest"; import { hostloadSource } from "../src/sources/hostload.js";
import nodes from "./fixtures/nodes.json"; import summary from "./fixtures/summary.json";
const kube = (s: unknown = summary) => ({ listNodes: async () => nodes.items, nodeSummary: async () => s }) as any;
const ctx = { server: "lab" as const, now: () => new Date("2026-10-30T12:00:00Z") };

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
});
