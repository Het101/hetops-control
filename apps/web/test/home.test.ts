import { describe, it, expect } from "vitest";
import type { Entity, Event, Series } from "@hetops-control/contracts";
import { deployDays, moduleState, perMinute, waitingDeploys } from "../src/lib/home.js";
import type { State } from "../src/lib/api.js";

const at = "2026-10-30T07:42:00.000Z", now = Date.parse(at);
const ev = (p: Partial<Event> & Pick<Event, "at">): Event => ({ server: "lab", source: "kubernetes", kind: "info", summary: "x", ...p });
const ent = (p: Partial<Entity> & Pick<Entity, "id" | "kind">): Entity => ({ server: "lab", name: p.id.split("/").at(-1)!, status: "ok", facts: {}, links: [], actions: [], observedAt: at, ...p });
const state = (sources: { id: string; ok: boolean; error?: string }[], failing: { id: string; error: string }[] = []) => ({
  generatedAt: at, entities: [], series: [], headline: { title: "", needs: [] },
  servers: { lab: { status: "ok", reachable: true, configured: true, since: at, sources: sources.map(s => ({ periodMs: 1000, lastRunAt: at, ...s })), failingSources: failing },
    staging: { status: "unknown", reachable: false, configured: false, since: at }, ops: { status: "ok", reachable: true, configured: true, since: at } },
}) as unknown as State;

describe("moduleState", () => {
  it("hides a module whose source never reported, and says empty, ok or failing otherwise", () => {
    expect(moduleState(undefined, "slo", false).mode).toBe("hidden");
    expect(moduleState(state([]), "slo", false).mode).toBe("hidden");
    expect(moduleState(state([{ id: "slo", ok: true }]), "slo", false).mode).toBe("empty");
    expect(moduleState(state([{ id: "slo", ok: true }]), "slo", true).mode).toBe("ok");
    // data present without a source report (e.g. carried by the center) still shows
    expect(moduleState(state([]), "slo", true).mode).toBe("ok");
  });
  it("a failing source wins over any data: never stale numbers", () => {
    const m = moduleState(state([{ id: "crowdsec", ok: false, error: "403 from LAPI" }]), "crowdsec", true);
    expect(m.mode).toBe("failing"); expect(m.fail).toEqual({ server: "lab", error: "403 from LAPI" });
    expect(moduleState(state([], [{ id: "crowdsec", error: "timeout" }]), "crowdsec", false).mode).toBe("failing");
  });
});

describe("deployDays", () => {
  const events = [ev({ at: "2026-10-30T07:31:00.000Z", kind: "sync" }), ev({ at: "2026-10-30T03:40:00.000Z", kind: "deploy" }),
    ev({ at: "2026-10-30T03:11:58.000Z", kind: "restart" }), ev({ at: "2026-10-28T12:00:00.000Z", kind: "deploy" }), ev({ at: "2026-10-27T22:10:00.000Z" })];
  it("14 UTC days oldest first, counting rollouts and syncs only", () => {
    const d = deployDays(events, now);
    expect(d).toHaveLength(14);
    expect(d[0]!.day).toBe("2026-10-17"); expect(d.at(-1)).toEqual({ day: "2026-10-30", n: 2, known: true });
    expect(d.find(x => x.day === "2026-10-28")!.n).toBe(1);
  });
  it("days before the oldest event held are unknown, not quiet", () => {
    const d = deployDays(events, now);
    expect(d.find(x => x.day === "2026-10-26")!.known).toBe(false);
    expect(d.find(x => x.day === "2026-10-27")).toEqual({ day: "2026-10-27", n: 0, known: true });
    expect(deployDays([], now).every(x => !x.known)).toBe(true);
  });
});

describe("waitingDeploys", () => {
  it("apps with an undeployed commit, short sha, by name", () => {
    const w = waitingDeploys([ent({ id: "lab/app/x/radar", kind: "app", facts: { undeployedCommit: { value: "7a5cba8e91" } } }),
      ent({ id: "lab/app/x/api", kind: "app" }), ent({ id: "lab/site/y", kind: "site", facts: { undeployedCommit: { value: "abc" } } }),
      ent({ id: "lab/app/x/drill", kind: "app", facts: { undeployedCommit: { value: "" } } })]);
    expect(w.map(x => [x.e.name, x.commit])).toEqual([["radar", "7a5cba8"]]);
  });
});

describe("perMinute", () => {
  const s = (points: [number, number][]): Series => ({ id: "ops/logs/default", server: "ops", label: "", unit: "docs", stepMs: 600_000, points, observedAt: at });
  it("the latest 10-min bucket as a compact per-minute rate", () => {
    expect(perMinute(s([[0, 5], [600_000, 13_000]]))).toBe("1.3k");
    expect(perMinute(s([[0, 50]]))).toBe("5");
    expect(perMinute(s([]))).toBeUndefined(); expect(perMinute(undefined)).toBeUndefined();
  });
});
