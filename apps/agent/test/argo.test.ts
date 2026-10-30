import { describe, it, expect } from "vitest"; import { argoSource } from "../src/sources/argo.js";
import argo from "./fixtures/argo.json";
const kube = (apps: unknown[]) => ({ listArgoApps: async () => apps }) as any;
const at = (iso: string) => ({ server: "lab" as const, now: () => new Date(iso) });
const now = "2026-10-30T12:00:00Z";

describe("argo source", () => {
  it("makes one argo-app per application with sync and health facts", async () => {
    const { entities } = await argoSource(kube(argo.items)).collect(at(now));
    expect(entities).toHaveLength(argo.items.length);
    expect(entities.every(e => e.kind === "argo-app" && e.parent === "lab/cluster")).toBe(true);
    expect(entities.every(e => typeof e.facts.sync?.value === "string" && typeof e.facts.health?.value === "string")).toBe(true);
    const healthy = argo.items.filter(a => a.status.sync.status === "Synced" && a.status.health.status === "Healthy").length;
    expect(entities.filter(e => e.status === "ok").length).toBe(healthy);
  });
  it("marks an app OutOfSync for over 10 minutes attention, but not before", async () => {
    const a = structuredClone(argo.items); a[0]!.status.sync.status = "OutOfSync";
    const src = argoSource(kube(a));
    const first = await src.collect(at("2026-10-30T11:49:00Z"));                // first seen 11 min before now
    expect(first.entities[0]!.status).toBe("ok");
    expect((await src.collect(at(now))).entities[0]!.status).toBe("attention");
  });
  it("marks an app Degraded for over 30 minutes down and forgets once healthy", async () => {
    const a = structuredClone(argo.items); a[0]!.status.health.status = "Degraded";
    const src = argoSource(kube(a));
    await src.collect(at("2026-10-30T11:29:00Z"));
    expect((await src.collect(at(now))).entities[0]!.status).toBe("down");
    a[0]!.status.health.status = "Healthy"; await src.collect(at(now));
    a[0]!.status.health.status = "Degraded";
    expect((await src.collect(at("2026-10-30T12:05:00Z"))).entities[0]!.status).toBe("ok");
  });
});
