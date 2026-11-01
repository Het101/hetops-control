import { describe, it, expect } from "vitest";
import type { Event } from "@hetops-control/contracts";
import { away, AWAY_MS } from "../src/lib/away.js";

const ev = (at: string, p: Partial<Event> = {}): Event => ({ at: `2026-11-01T${at}:00.000Z`, server: "lab", source: "kubernetes", kind: "info", summary: "x", ...p });
// newest first, as the center serves them
const events = [
  ev("07:10", { kind: "status", entity: "ops/site/a", level: "ok" }),
  ev("06:50", { kind: "status", entity: "lab/app/b", level: "attention" }),
  ev("06:30", { kind: "status", entity: "ops/site/a", level: "attention" }),
  ev("05:00", { kind: "sync" }),
  ev("01:00", { kind: "status", entity: "ops/site/c", level: "down" }),   // before you left: not counted
];

describe("away", () => {
  it("says nothing for a short absence", () => {
    expect(away(events, Date.parse("2026-11-01T06:00:00.000Z"), Date.parse("2026-11-01T06:00:00.000Z") + AWAY_MS - 1)).toBeUndefined();
  });
  it("counts what happened since you left: everything, what recovered on its own, what still waits", () => {
    const since = Date.parse("2026-11-01T02:00:00.000Z"), now = Date.parse("2026-11-01T07:30:00.000Z");
    expect(away(events, since, now)).toEqual({ since, events: 4, recovered: 1, waiting: 1 });
  });
  it("a quiet absence is still said", () => {
    const since = Date.parse("2026-11-01T07:20:00.000Z");
    expect(away(events, since, since + AWAY_MS)).toEqual({ since, events: 0, recovered: 0, waiting: 0 });
  });
});
