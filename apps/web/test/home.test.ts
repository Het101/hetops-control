import { describe, it, expect } from "vitest";
import type { Entity, Event, Series } from "@hetops-control/contracts";
import { deployRiver, moduleState, perMinute, waitingDeploys } from "../src/lib/home.js";
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

describe("deployRiver", () => {
  const events = [ev({ at: "2026-10-30T07:31:00.000Z", kind: "sync", server: "ops" }), ev({ at: "2026-10-30T03:40:00.000Z", kind: "deploy" }),
    ev({ at: "2026-10-30T03:11:58.000Z", kind: "restart" }), ev({ at: "2026-10-28T12:00:00.000Z", kind: "deploy" }), ev({ at: "2026-10-27T22:10:00.000Z" })];
  it("spans only what is known: from the oldest event held (at most 14 days back) to now", () => {
    const r = deployRiver(events, now);
    expect(r.start).toBe(Date.parse("2026-10-27T22:10:00.000Z")); expect(r.end).toBe(now); expect(r.short).toBe(true);
    const full = deployRiver([...events, ev({ at: "2026-09-01T00:00:00.000Z" })], now);
    expect(full.start).toBe(now - 14 * 86_400_000); expect(full.short).toBe(false);
  });
  it("one lane per server that deployed, in server order; one dot per rollout or sync, oldest first", () => {
    const r = deployRiver(events, now);
    expect(r.total).toBe(3);
    expect(r.lanes.map(l => [l.server, l.deps.map(d => d.at.slice(0, 16))])).toEqual([
      ["lab", ["2026-10-28T12:00", "2026-10-30T03:40"]], ["ops", ["2026-10-30T07:31"]]]);
  });
  it("nothing held: no span, no lanes", () => {
    expect(deployRiver([], now)).toEqual({ start: now, end: now, short: true, lanes: [], total: 0 });
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
