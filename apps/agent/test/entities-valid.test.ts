import { describe, it, expect } from "vitest"; import { EntitySchema } from "@hetops-control/contracts";
import { kubernetesSource } from "../src/sources/kubernetes.js"; import { argoSource } from "../src/sources/argo.js"; import { hostloadSource } from "../src/sources/hostload.js";
import nodes from "./fixtures/nodes.json"; import pods from "./fixtures/pods.json"; import workloads from "./fixtures/workloads.json"; import argo from "./fixtures/argo.json"; import summary from "./fixtures/summary.json";

// client-node deserialises every timestamp to a Date; kubectl JSON (our fixtures) has strings. Mimic the client.
const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const asClient = (v: any): any => typeof v === "string" && iso.test(v) ? new Date(v) : Array.isArray(v) ? v.map(asClient)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, asClient(x)])) : v;
const kube = (conv: (x: any) => any, over: Record<string, unknown> = {}) => ({ listNodes: async () => nodes.items, listPods: async () => conv(pods.items),
  listWorkloads: async () => workloads.items, listArgoApps: async () => argo.items, nodeSummary: async () => summary, version: async () => "v1.35.9", ...over }) as any;
const ctx = { server: "lab" as const, now: () => new Date("2026-10-30T12:00:00Z") };

describe("every source emits schema-valid entities", () => {
  for (const [label, conv] of [["kubectl JSON", (x: any) => x], ["client-node Dates", asClient]] as const) {
    it(`kubernetes (${label})`, async () => {
      const { entities } = await kubernetesSource(kube(conv)).collect(ctx);
      for (const e of entities) EntitySchema.parse(e);
      expect(entities.find(e => e.id === "lab/app/argocd/argocd-applicationset-controller")!.facts.lastRestartAt?.value).toBe("2026-10-25T09:52:59.000Z".replace(label === "kubectl JSON" ? ".000" : "", ""));
    });
  }
  it("restarted container with no finishedAt: falls back, never emits a bad fact", async () => {
    const p = structuredClone(pods.items) as any[]; const c = p[0].status.containerStatuses[0];
    c.lastState = { waiting: {} }; c.restartCount = 3; c.state = { running: { startedAt: "2026-10-30T11:00:00Z" } };
    const a = (await kubernetesSource(kube(asClient, { listPods: async () => asClient(p) })).collect(ctx)).entities.map(e => EntitySchema.parse(e));
    expect(a.find(e => e.facts.lastRestartAt?.value === "2026-10-30T11:00:00.000Z")).toBeDefined();
    c.state = {}; c.lastState = {};
    for (const e of (await kubernetesSource(kube(asClient, { listPods: async () => p })).collect(ctx)).entities) EntitySchema.parse(e);
  });
  it("argo", async () => { for (const e of (await argoSource(kube(asClient)).collect(ctx)).entities) EntitySchema.parse(e); });
  it("hostload", async () => { for (const e of (await hostloadSource(kube(asClient)).collect(ctx)).entities) EntitySchema.parse(e); });
});
