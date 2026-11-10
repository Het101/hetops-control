import { describe, expect, it } from "vitest";
import type { ActionRun, Entity, Event, ServerView } from "@hetops-control/contracts";
import { burn, climb, overall, RISE_MS, STEAM_MS, type BurnInput, type Rising } from "../src/lib/burn.js";

const now = Date.parse("2026-11-10T07:42:00Z");
const view = (reachable = true): ServerView => ({ status: "ok", reachable, configured: reachable, agentVersion: reachable ? "1" : undefined } as ServerView);
const app = (over: Partial<Entity> = {}): Entity => ({ id: "lab/app/chaos/chaos-api", kind: "app", server: "lab", name: "chaos-api", status: "ok",
  facts: { namespace: { value: "chaos" }, pods: { value: 2, max: 2 }, podsDesired: { value: 2 } }, links: [], actions: [], observedAt: "2026-11-10T07:42:00Z", ...over });
const run = (state: ActionRun["state"], over: Partial<ActionRun> = {}): ActionRun => ({ id: "00000000-0000-4000-8000-000000000000", action: "k8s.restart",
  label: "Restart", server: "lab", target: "lab/app/chaos/chaos-api", targetName: "chaos-api", actor: "het", params: {}, state, at: "2026-11-10T07:31:00Z", ...over } as ActionRun);
const input = (over: Partial<BurnInput> = {}): BurnInput => ({ entities: [], servers: { lab: view(), staging: view(false), ops: view() }, runs: [], events: [], now, ...over });

describe("burn", () => {
  it("is calm when ok and nothing recent happened", () => expect(burn(app(), input()).burn).toBe("calm"));

  it("burns on attention, hotter on down", () => {
    expect(burn(app({ status: "attention", statusReason: "3 restarts in the last 30 min" }), input())).toEqual({ burn: "fire", hot: false, why: "3 restarts in the last 30 min" });
    expect(burn(app({ status: "down" }), input()).hot).toBe(true);
  });

  it("rains while an action on it runs, whatever its status", () => {
    expect(burn(app({ status: "down" }), input({ runs: [run("running")] }))).toEqual({ burn: "rain", hot: false, why: "Restart running" });
  });

  it("rains while its Argo app syncs, matched by namespace", () => {
    const argo: Entity = { ...app(), id: "lab/argo-app/chaos", kind: "argo-app", name: "chaos", facts: { sync: { value: "OutOfSync" }, health: { value: "Progressing" } } };
    const e = app({ status: "attention" });
    expect(burn(e, input({ entities: [e, argo] })).why).toBe("Argo is syncing");
    expect(burn(e, input({ entities: [e, { ...argo, name: "other" }] })).burn).toBe("fire");
  });

  it("burns again after a failed run, and says why", () => {
    expect(burn(app({ status: "down" }), input({ runs: [run("failed", { error: "OOMKilled" })] })).why).toBe("Restart did not take: OOMKilled");
  });

  it("steams for 30 minutes after it came back, then is calm", () => {
    const ev = (ago: number): Event => ({ at: new Date(now - ago).toISOString(), server: "lab", source: "kubernetes", kind: "status", summary: "ok", entity: app().id, level: "ok" });
    expect(burn(app(), input({ events: [ev(60_000)] })).burn).toBe("steam");
    expect(burn(app(), input({ events: [ev(STEAM_MS + 1)] })).burn).toBe("calm");
  });

  it("is fog when it can't be seen", () => {
    expect(burn(app({ status: "unknown" }), input()).burn).toBe("fog");
    expect(burn(app({ server: "staging" }), input())).toEqual({ burn: "fog", hot: false, why: "agent not connected" });
  });
});

describe("climb", () => {
  it("rains on pods coming back, for RISE_MS after the climb", () => {
    const m: Rising = new Map(), low = app({ status: "attention", facts: { ...app().facts, pods: { value: 0, max: 2 } } });
    expect(climb(m, [low], now).size).toBe(0);
    const up = app({ status: "attention", facts: { ...app().facts, pods: { value: 1, max: 2 } } });
    expect(climb(m, [up], now + 15_000).has(up.id)).toBe(true);
    expect(burn(up, input({ rising: climb(m, [up], now + 30_000) })).why).toBe("pods coming back");
    expect(climb(m, [up], now + 15_000 + RISE_MS).size).toBe(0);
  });
});

describe("overall", () => {
  it("leads with the most urgent state; fog only when nothing can be seen", () => {
    expect(overall([{ burn: "calm", hot: false }, { burn: "fire", hot: false }, { burn: "rain", hot: false }])).toBe("fire");
    expect(overall([{ burn: "calm", hot: false }, { burn: "fog", hot: false }])).toBe("calm");
    expect(overall([{ burn: "fog", hot: false }])).toBe("fog");
    expect(overall([])).toBe("fog");
  });
});
