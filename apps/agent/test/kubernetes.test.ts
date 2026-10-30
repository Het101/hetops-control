import { describe, it, expect } from "vitest"; import { kubernetesSource } from "../src/sources/kubernetes.js";
import nodes from "./fixtures/nodes.json"; import pods from "./fixtures/pods.json"; import workloads from "./fixtures/workloads.json";
const kube = (over: Partial<Record<string, unknown>> = {}) => ({ listNodes: async () => nodes.items, listPods: async () => pods.items,
  listWorkloads: async () => workloads.items, listArgoApps: async () => [], nodeSummary: async () => ({}), version: async () => "v1.35.9", ...over });
const ctx = { server: "lab" as const, now: () => new Date("2026-10-30T12:00:00Z") };

describe("kubernetes source", () => {
  it("makes one cluster and one app per workload", async () => {
    const { entities } = await kubernetesSource(kube() as any).collect(ctx);
    expect(entities.filter(e => e.kind === "cluster")).toHaveLength(1);
    expect(entities.filter(e => e.kind === "app").length).toBe(workloads.items.length);
    expect(entities.every(e => e.kind === "cluster" || e.parent === "lab/cluster")).toBe(true);
    const cluster = entities.find(e => e.kind === "cluster")!;
    expect(cluster.facts.podsTotal?.value).toBe(pods.items.length);
    expect(cluster.facts.nodes?.value).toBe(1);
  });
  it("resolves pods to their deployment through the replicaset name", async () => {
    const { entities } = await kubernetesSource(kube() as any).collect(ctx);
    const d = workloads.items.find(w => w.metadata.name === "argocd-dex-server")!;
    const app = entities.find(e => e.id === `lab/app/${d.metadata.namespace}/${d.metadata.name}`)!;
    expect(app.facts.pods?.value).toBe(d.status.readyReplicas);
    expect(app.facts.restarts24h?.value).toBe(0);                              // fixture restarts are all > 24h old
    expect(app.facts.lastRestartAt?.value).toBe("2026-10-25T09:52:59Z");
  });
  it("marks a workload with no ready pods down and one with restarts attention", async () => {
    const w = structuredClone(workloads.items); (w[0] as any).status.readyReplicas = 0;
    const p = structuredClone(pods.items); (p[0] as any).status.containerStatuses[0].restartCount = 3;
    (p[0] as any).status.containerStatuses[0].lastState = { terminated: { finishedAt: "2026-10-30T03:12:00Z", reason: "OOMKilled" } };
    const { entities } = await kubernetesSource(kube({ listWorkloads: async () => w, listPods: async () => p }) as any).collect(ctx);
    expect(entities.some(e => e.status === "down")).toBe(true);
    expect(entities.some(e => e.status === "attention" && Number(e.facts.restarts24h?.value) > 0)).toBe(true);
  });
  it("emits a restart event only for restarts new since the last run", async () => {
    let current: unknown[] = pods.items;
    const src = kubernetesSource(kube({ listPods: async () => current }) as any);
    expect((await src.collect(ctx)).events ?? []).toHaveLength(0);           // first run: baseline only
    const p = structuredClone(pods.items); (p[0] as any).status.containerStatuses[0].restartCount += 1; current = p;
    const second = await src.collect(ctx);
    expect(second.events ?? []).toHaveLength(1);                               // one new restart
    expect(second.events![0]!.kind).toBe("restart");
    expect((await src.collect(ctx)).events ?? []).toHaveLength(0);            // nothing new
  });
  it("drops pods that disappear from the baseline", async () => {
    let current: any[] = pods.items;
    const src = kubernetesSource(kube({ listPods: async () => current }) as any);
    await src.collect(ctx);
    current = pods.items.slice(1); await src.collect(ctx);                     // pod 0 gone
    current = structuredClone(pods.items);                                     // same name back: counts from 0
    expect((await src.collect(ctx)).events ?? []).toHaveLength(1);
  });
  it("limits apps to the given namespaces", async () => {
    const { entities } = await kubernetesSource(kube() as any, { namespaces: ["argocd"] }).collect(ctx);
    const apps = entities.filter(e => e.kind === "app");
    expect(apps.length).toBe(workloads.items.filter(w => w.metadata.namespace === "argocd").length);
    expect(apps.every(e => e.facts.namespace?.value === "argocd")).toBe(true);
  });
});
