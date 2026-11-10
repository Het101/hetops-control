import { describe, it, expect } from "vitest";
import type { Event } from "@hetops-control/contracts";
import { threads } from "../src/lib/incidents.js";

const ev = (hhmm: string, summary: string, o: Partial<Event> = {}): Event =>
  ({ at: `2026-11-07T${hhmm}:00.000Z`, server: "lab", source: "kubernetes", kind: "status", summary, ...o });
const API = "lab/app/clinic/api";

describe("threads (one incident, one row)", () => {
  // newest first, as the center serves them
  const feed = [
    ev("21:40", "pod chaos-selftest deleted"),
    ev("21:39", "api (lab) attention → ok", { entity: API, level: "ok" }),
    ev("21:38", "Sync clinic (lab): Sync started", { kind: "action", source: "control", entity: API, actor: "owner" }),
    ev("21:38", "api restarted", { kind: "restart", entity: API }),
    ev("21:37", "api (lab) ok → down: no pods ready", { entity: API, level: "down" }),
    ev("21:30", "clinic synced to 1da6255", { kind: "sync", source: "argo" }),
  ];
  const out = threads(feed);
  it("folds a fall, what was done, and the recovery into one thread, and leaves the rest as events", () => {
    expect(out.map(x => x.kind)).toEqual(["event", "thread", "event"]);
    const t = out[1]!;
    if (t.kind !== "thread") throw new Error("not a thread");
    expect(t.entity).toBe(API);
    expect(t.events.map(e => e.summary)).toEqual(["api (lab) ok → down: no pods ready", "api restarted", "Sync clinic (lab): Sync started", "api (lab) attention → ok"]);
    expect([t.opened, t.closed, t.worst]).toEqual(["2026-11-07T21:37:00.000Z", "2026-11-07T21:39:00.000Z", "down"]);
    expect(t.lasted).toBe(120_000);
    expect(t.actions).toBe(1);
  });
  it("keeps an incident open until it recovers", () => {
    const open = threads([ev("21:38", "api restarted", { kind: "restart", entity: API }), ev("21:37", "api (lab) ok → attention", { entity: API, level: "attention" })]);
    expect(open).toHaveLength(1);
    const t = open[0]!;
    expect(t.kind === "thread" && t.closed).toBeUndefined();
  });
  it("a second fall after recovery is a second incident; the same entity on another server is another thread", () => {
    const two = threads([
      ev("22:10", "api ok", { entity: API, level: "ok" }), ev("22:05", "api down", { entity: API, level: "down" }),
      ev("21:39", "api ok", { entity: API, level: "ok" }), ev("21:37", "api down", { entity: API, level: "down" }),
      ev("21:36", "api down", { entity: API, level: "down", server: "ops" }),
    ]);
    expect(two.filter(x => x.kind === "thread")).toHaveLength(3);
  });
  it("a restart or action with nothing open stays a plain event", () => {
    expect(threads([ev("21:38", "api restarted", { kind: "restart", entity: API })]).map(x => x.kind)).toEqual(["event"]);
  });
});
