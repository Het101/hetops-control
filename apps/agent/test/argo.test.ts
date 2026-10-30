import { describe, it, expect } from "vitest"; import { argoSource } from "../src/sources/argo.js";
import argo from "./fixtures/argo.json";
const kube = (apps: unknown[]) => ({ listArgoApps: async () => apps }) as any;
const at = (iso: string) => ({ server: "lab" as const, now: () => new Date(iso) });
const now = "2026-10-30T12:00:00Z";
const apps = () => structuredClone(argo.items) as any[];

describe("argo source", () => {
  it("makes one argo-app per application with sync, health and revision facts", async () => {
    const { entities } = await argoSource(kube(argo.items)).collect(at(now));
    expect(entities).toHaveLength(argo.items.length);
    expect(entities.every(e => e.kind === "argo-app" && e.parent === "lab/cluster")).toBe(true);
    expect(entities.every(e => typeof e.facts.sync?.value === "string" && typeof e.facts.health?.value === "string")).toBe(true);
    expect(entities.every(e => e.facts.revision?.value !== "")).toBe(true);    // multi-source apps fall back to revisions[0]
    const healthy = argo.items.filter(a => a.status.sync.status === "Synced" && a.status.health.status === "Healthy").length;
    expect(entities.filter(e => e.status === "ok").length).toBe(healthy);
  });
  it("shortens a git sha revision to 7 characters and keeps a chart version", async () => {
    const a = apps(); a[0].status.sync = { status: "Synced", revisions: ["35bd7f5f4675698cda636279ddaf8a1cb92d2de4"] };
    a[1].status.sync = { status: "Synced", revisions: ["9.2.0", "35bd7f5f4675698cda636279ddaf8a1cb92d2de4"] };
    const { entities } = await argoSource(kube(a)).collect(at(now));
    expect(entities[0]!.facts.revision?.value).toBe("35bd7f5");
    expect(entities[1]!.facts.revision?.value).toBe("9.2.0");
  });
  it("marks an app OutOfSync for over 10 minutes attention, but not before", async () => {
    const a = apps(); a[0].status.sync.status = "OutOfSync";
    const src = argoSource(kube(a));
    const first = await src.collect(at("2026-10-30T11:49:00Z"));                // first seen 11 min before now
    expect(first.entities[0]!.status).toBe("ok");
    expect(first.entities[0]!.statusReason).toBeUndefined();                     // 0 min: no reason yet
    expect((await src.collect(at("2026-10-30T11:52:00Z"))).entities[0]!.statusReason).toBe("OutOfSync for 3 min");
    expect((await src.collect(at(now))).entities[0]!.status).toBe("attention");
  });
  it("is attention, not down, when a long OutOfSync turns Degraded for one poll", async () => {
    const a = apps(); a[0].status.sync.status = "OutOfSync";
    const src = argoSource(kube(a));
    await src.collect(at("2026-10-30T11:20:00Z"));                               // OutOfSync for 40 min
    a[0].status.health.status = "Degraded";
    expect((await src.collect(at(now))).entities[0]!.status).toBe("attention");
  });
  it("marks an app Degraded for over 30 minutes down and forgets once healthy", async () => {
    const a = apps(); a[0].status.health.status = "Degraded";
    const src = argoSource(kube(a));
    await src.collect(at("2026-10-30T11:29:00Z"));                               // Degraded continuously for 31 min
    expect((await src.collect(at(now))).entities[0]!.status).toBe("down");
    a[0].status.health.status = "Healthy"; await src.collect(at(now));
    a[0].status.health.status = "Degraded";
    expect((await src.collect(at("2026-10-30T12:05:00Z"))).entities[0]!.status).toBe("ok");
  });
  it("treats Suspended as ok and keeps the 10-min rule for Unknown", async () => {
    const a = apps(); a[0].status.health.status = "Suspended"; a[1].status.sync.status = "Unknown";
    const src = argoSource(kube(a));
    await src.collect(at("2026-10-30T11:00:00Z"));
    const { entities } = await src.collect(at(now));
    expect(entities[0]!.status).toBe("ok"); expect(entities[0]!.statusReason).toBe("suspended");
    expect(entities[1]!.status).toBe("attention");
  });
});
