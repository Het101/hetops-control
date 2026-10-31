import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { ObjectSerializer } from "@kubernetes/client-node/dist/serializer.js";
import { kubernetesSource, typed, watched, type InformerLike } from "../src/sources/kubernetes.js";
import { Registry, type Source } from "../src/registry.js";
import nodes from "./fixtures/nodes.json"; import pods from "./fixtures/pods.json"; import workloads from "./fixtures/workloads.json";

// A stand-in for client-node's ListWatch: start() runs the scripted LIST/WATCH outcome, emit() plays a watch event.
const fake = (items: any[] = []) => {
  const cbs: Record<string, ((x?: any) => void)[]> = {}, key = (o: any) => `${o.metadata.namespace}/${o.metadata.name}`;
  const objs = new Map(items.map(o => [key(o), o]));
  const f = {
    starts: 0, failStart: undefined as unknown,   // set to an error: the next start() reports it the way client-node does
    on: (v: string, cb: (x?: any) => void) => { (cbs[v] ??= []).push(cb); },
    start: async () => { f.starts++; await null; if (f.failStart) cbs.error?.forEach(cb => cb(f.failStart)); },
    list: () => [...objs.values()],
    emit(v: "add" | "update" | "delete" | "error", x?: any) {
      if (v === "add" || v === "update") objs.set(key(x), x); else if (v === "delete") objs.delete(key(x));
      cbs[v]?.forEach(cb => cb(x));
    },
  };
  return f;
};
const flush = () => vi.advanceTimersByTimeAsync(0);
let t = 0; const clock = () => t;
const ctx = { server: "lab" as const, now: () => new Date("2026-10-30T12:00:00Z") };
beforeEach(() => { vi.useFakeTimers(); t = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("watched cache", () => {
  it("is blind until the first sync, then serves the cache and announces it", async () => {
    const inf = fake(pods.items); const changed = vi.fn();
    const read = watched(inf as InformerLike, "pods", 10_000, changed, clock);
    expect(read).toThrow("pods: not synced yet");                         // first read starts the informer
    await flush();
    expect(read()).toHaveLength(pods.items.length);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(inf.starts).toBe(1);
  });
  it("follows add, update and delete, announcing each", async () => {
    const inf = fake(); const changed = vi.fn();
    const read = watched(inf as InformerLike, "pods", 10_000, changed, clock); try { read(); } catch { /* not synced */ } await flush();
    const p = structuredClone(pods.items[0]) as any;
    inf.emit("add", p); expect(read()).toHaveLength(1);
    inf.emit("update", { ...p, status: { phase: "Failed" } }); expect(read()[0].status.phase).toBe("Failed");
    inf.emit("delete", p); expect(read()).toHaveLength(0);
    expect(changed).toHaveBeenCalledTimes(4);                              // sync + three changes
  });
  it("keeps serving through a short watch error, goes blind after one period, recovers with backoff", async () => {
    const inf = fake(pods.items);
    const read = watched(inf as InformerLike, "pods", 10_000, () => {}, clock); try { read(); } catch { /* not synced */ } await flush();
    inf.failStart = new Error("connect ECONNREFUSED");
    inf.emit("error", new Error("Gateway Timeout")); t = 5_000;
    expect(read()).toHaveLength(pods.items.length);                        // within the period: the cache is still current enough
    await vi.advanceTimersByTimeAsync(1_000); expect(inf.starts).toBe(2);  // retry after 1 s, fails again
    t = 10_001;
    expect(read).toThrow(/pods watch failing for 10 s: connect ECONNREFUSED/);
    await vi.advanceTimersByTimeAsync(1_999); expect(inf.starts).toBe(2);  // backoff doubled to 2 s
    inf.failStart = undefined;
    await vi.advanceTimersByTimeAsync(1); expect(inf.starts).toBe(3);
    expect(read()).toHaveLength(pods.items.length);                        // recovered
  });
  it("retries a failing first LIST and stays blind meanwhile", async () => {
    const inf = fake(pods.items); inf.failStart = new Error("pods is forbidden");
    const read = watched(inf as InformerLike, "pods", 10_000, () => {}, clock);
    expect(read).toThrow("pods: not synced yet"); await flush();
    expect(read).toThrow("pods: pods is forbidden");
    for (const ms of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) { const n = inf.starts; await vi.advanceTimersByTimeAsync(ms); expect(inf.starts).toBe(n + 1); }
    inf.failStart = undefined; await vi.advanceTimersByTimeAsync(30_000);
    expect(read()).toHaveLength(pods.items.length);
  });
});

describe("kubernetes source over watched caches", () => {
  const reader = (p: ReturnType<typeof fake>, changed: () => void = () => {}) => {
    const cache = (items: any[]) => watched(fake(items) as InformerLike, "x", 10_000, changed, clock);
    const n = cache(nodes.items), w = cache(workloads.items), pr = watched(p as InformerLike, "pods", 10_000, changed, clock);
    return { listNodes: async () => n(), listPods: async () => pr(), listWorkloads: async () => w(), listArgoApps: async () => [],
      nodeSummary: async () => ({}), version: async () => "v1.35.9" };
  };
  it("reports the error (the registry turns it into ok:false and drops the entities), then recovers", async () => {
    const p = fake(pods.items), reg = new Registry("lab", [kubernetesSource(reader(p))], ctx.now);
    await reg.runOnce("kubernetes");
    expect(reg.state().sources[0]).toMatchObject({ ok: false, error: "x: not synced yet" });
    await flush(); await reg.runOnce("kubernetes");
    expect(reg.state().sources[0]!.ok).toBe(true);
    p.failStart = new Error("Service Unavailable"); p.emit("error", new Error("Service Unavailable")); t = 20_000;
    await reg.runOnce("kubernetes");
    expect(reg.state().sources[0]).toMatchObject({ ok: false, error: "pods watch failing for 20 s: Service Unavailable" });
    expect(reg.state().entities).toHaveLength(0);                          // blind, never stale-green
    p.failStart = undefined; await vi.advanceTimersByTimeAsync(30_000); await reg.runOnce("kubernetes");
    expect(reg.state().sources[0]!.ok).toBe(true);
  });
  it("a pod restart arriving on the watch runs the source within about a second and emits the restart", async () => {
    const p = fake(pods.items); const src = kubernetesSource({ ...reader(p, () => changed()), onChange: fn => { changed = fn; } });
    let changed = () => {};
    const reg = new Registry("lab", [src], ctx.now); const events: string[] = [];
    reg.on(m => { if (m.type === "event") events.push(m.event.summary); });
    reg.start(); await vi.advanceTimersByTimeAsync(1_100);                  // first tick (not synced), sync, kicked rerun: baseline
    expect(reg.state().sources[0]!.ok).toBe(true);
    const pod = structuredClone(p.list()[0]); pod.status.containerStatuses[0].restartCount += 1;
    p.emit("update", pod);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(events).toEqual([expect.stringContaining(`${pod.metadata.namespace}/${pod.metadata.name}/`)]);
    reg.stop();
  });
});

describe("registry push", () => {
  it("coalesces a burst of changes into one run a second later", async () => {
    let changed = () => {}; const collect = vi.fn(async () => ({ entities: [] }));
    const s: Source = { id: "s", periodMs: 60_000, watch: fn => { changed = fn; }, collect };
    const reg = new Registry("lab", [s], ctx.now); reg.start(); await flush();
    expect(collect).toHaveBeenCalledTimes(1);
    changed(); changed(); changed();
    await vi.advanceTimersByTimeAsync(999); expect(collect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(collect).toHaveBeenCalledTimes(2);
    reg.stop(); changed(); await vi.advanceTimersByTimeAsync(5_000); expect(collect).toHaveBeenCalledTimes(2);
  });
});

describe("entity output does not depend on how an object reached the cache", () => {
  it("watch events deserialised by typed() read the same as the typed LIST", async () => {
    // what listPodForAllNamespaces etc. return: the list deserialised by client-node's ObjectSerializer
    const listed = (type: string, items: any[]) => ObjectSerializer.deserialize({ items }, `${type}List`).items;
    const kind = (items: any[]) => items.map((i: any, n: number) => ({ ...i, kind: workloads.items[n]!.kind }));
    const viaList = { pods: listed("V1Pod", pods.items), nodes: listed("V1Node", nodes.items),
      workloads: kind(workloads.items.map(w => listed(`V1${w.kind}`, [w])[0])) };
    const viaWatch = { pods: pods.items.map(typed("V1Pod")), nodes: nodes.items.map(typed("V1Node")),
      workloads: kind(workloads.items.map(w => typed(`V1${w.kind}`)(w))) };
    const run = async (o: typeof viaList) => kubernetesSource({ listNodes: async () => o.nodes, listPods: async () => o.pods,
      listWorkloads: async () => o.workloads, listArgoApps: async () => [], nodeSummary: async () => ({}), version: async () => "v1.35.9" }).collect(ctx);
    const a = await run(viaList), b = await run(viaWatch);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.entities.find(e => e.id === "lab/app/argocd/argocd-applicationset-controller")!.facts.lastRestartAt?.value).toBe("2026-10-25T09:52:59.000Z");
  });
});
