import { describe, it, expect } from "vitest";
import type { Entity, Event, Series } from "@hetops-control/contracts";
import { alarms, areas, backupView, byHour, countdown, eventDays, filterEvents, hourly, knocks, landDots, pips, serverApps, sourceState, span } from "../src/lib/pages.js";

const at = "2026-10-30T07:42:00.000Z", now = Date.parse(at);
const ent = (p: Partial<Entity> & Pick<Entity, "id" | "kind">): Entity => ({ server: "lab", name: p.id.split("/").at(-1)!, status: "ok", facts: {}, links: [], actions: [], observedAt: at, ...p });
const ev = (p: Partial<Event> & Pick<Event, "at">): Event => ({ server: "lab", source: "kubernetes", kind: "info", summary: "x", ...p });

describe("span", () => {
  it("reads like a person", () => {
    expect(span(45_000)).toBe("45 s"); expect(span(12 * 60_000)).toBe("12 min");
    expect(span((3 * 60 + 12) * 60_000)).toBe("3 h 12 min"); expect(span(3 * 3600_000)).toBe("3 h"); expect(span(52 * 3600_000)).toBe("2 d 4 h");
  });
});

describe("timeline", () => {
  const events = [ev({ at: "2026-10-30T07:31:00.000Z", server: "ops", kind: "sync", source: "argo", summary: "logging synced" }),
    ev({ at: "2026-10-30T03:12:00.000Z", kind: "status", level: "attention", summary: "chaos-api ok → attention", entity: "lab/app/chaos/chaos-api" }),
    ev({ at: "2026-10-30T03:11:58.000Z", kind: "restart", summary: "chaos-api restarted" }),
    ev({ at: "2026-10-29T22:10:00.000Z", source: "center", summary: "lab reachable again" })];
  const all = { server: [], kind: [], source: [], level: [], q: "" };
  it("filters by chips (empty = all), search, day and hour", () => {
    expect(filterEvents(events, all)).toHaveLength(4);
    expect(filterEvents(events, { ...all, server: ["ops"] }).map(e => e.summary)).toEqual(["logging synced"]);
    expect(filterEvents(events, { ...all, level: ["attention", "down"] })).toHaveLength(1);
    expect(filterEvents(events, { ...all, level: ["none"] })).toHaveLength(3);
    expect(filterEvents(events, { ...all, q: "CHAOS" })).toHaveLength(2);
    expect(filterEvents(events, { ...all, day: "2026-10-30", hour: 3 })).toHaveLength(2);
  });
  it("days newest first; 24 hourly buckets with the hot ones", () => {
    expect(eventDays(events)).toEqual(["2026-10-30", "2026-10-29"]);
    const h = hourly(events, "2026-10-30");
    expect(h).toHaveLength(24); expect(h[3]).toEqual({ hour: 3, n: 2, hot: 1 }); expect(h[7]!.n).toBe(1); expect(h[22]!.n).toBe(0);
  });
  it("groups by hour in order", () => {
    expect(byHour(events).map(g => [g.key, g.events.length])).toEqual([["2026-10-30T07", 1], ["2026-10-30T03", 2], ["2026-10-29T22", 1]]);
  });
});

describe("alarms", () => {
  it("firing alerts by severity, failing checks, blind checks as info; the longest firing first", () => {
    const list = alarms([
      ent({ id: "lab/alert/a", kind: "alert", facts: { severity: { value: "warning" }, since: { value: "2026-10-30T07:00:00.000Z" } } }),
      ent({ id: "lab/alert/b", kind: "alert", facts: { severity: { value: "warning" }, since: { value: "2026-10-30T05:00:00.000Z" } } }),
      ent({ id: "lab/alert/resolved", kind: "alert", facts: { firing: { value: 0 }, severity: { value: "critical" } } }),
      ent({ id: "lab/alert/odd", kind: "alert", facts: { severity: { value: "page" } } }),
      ent({ id: "ops/site/www", kind: "site", status: "down", statusReason: "3 failed in a row" }),
      ent({ id: "ops/check/es", kind: "check", status: "unknown" }),
      ent({ id: "ops/check/ok", kind: "check" }),
      ent({ id: "lab/app/x", kind: "app", status: "down" }),
    ], [ev({ at: "2026-10-30T06:00:00.000Z", kind: "status", entity: "ops/site/www", level: "down" })]);
    expect(list.map(a => [a.entity.id, a.severity])).toEqual([["ops/site/www", "critical"], ["lab/alert/b", "warning"], ["lab/alert/a", "warning"],
      ["ops/check/es", "info"], ["lab/alert/odd", "info"]]);
    expect(list[0]!.since).toBe(Date.parse("2026-10-30T06:00:00.000Z"));
  });
});

describe("apps", () => {
  it("pips: ready then missing, capped", () => {
    expect(pips(2, 3)).toEqual({ pips: ["up", "up", "missing"], more: 0 });
    expect(pips(14, 14, 10).more).toBe(4);
    expect(pips(0, 0).pips).toEqual([]);
  });
  it("sums a server", () => {
    const s = serverApps([ent({ id: "lab/app/a", kind: "app", facts: { pods: { value: 1 }, podsDesired: { value: 2 }, restarts24h: { value: 3 } }, status: "attention" }),
      ent({ id: "lab/argo-app/x", kind: "argo-app", facts: { sync: { value: "Synced" }, health: { value: "Healthy" } } }),
      ent({ id: "ops/app/b", kind: "app", server: "ops", facts: { pods: { value: 5 } } })], "lab");
    expect(s).toEqual({ apps: 1, ready: 1, desired: 2, restarts: 3, argo: 1, synced: 1, needs: 1 });
  });
});

describe("backups", () => {
  it("age against 26 h, a failure after the last success, and the countdown", () => {
    const b = backupView(ent({ id: "ops/backup/n", kind: "backup", facts: { lastOk: { value: "2026-10-30T01:30:00.000Z" },
      lastFailure: { value: "2026-10-29T01:30:00.000Z" }, nextRun: { value: "2026-10-31T01:30:00.000Z" } } }), now);
    expect(b.ageH).toBeCloseTo(6.2, 1); expect(b.overdue).toBe(false); expect(b.failedLast).toBe(false);
    expect(countdown(b.nextIn)).toBe("in 17 h 48 min");
    const none = backupView(ent({ id: "ops/backup/x", kind: "backup", facts: { lastFailure: { value: at } } }), now);
    expect(none).toMatchObject({ overdue: true, failedLast: true, frac: 1 });
    expect(countdown(-120_000)).toBe("due 2 min ago"); expect(countdown(undefined)).toBe("not scheduled");
  });
});

describe("security", () => {
  it("places decisions by country and counts the unknown ones", () => {
    const d = (id: string, country?: string) => ent({ id, kind: "decision", facts: country ? { country: { value: country } } : {} });
    const k = knocks([d("1", "RU"), d("2", "ru"), d("3", "CN"), d("4", "ZZ"), d("5")], 400, 170);
    expect(k.placed.map(p => [p.country, p.n])).toEqual([["RU", 2], ["CN", 1]]);
    expect(k.unplaced).toBe(2);
    expect(landDots(400, 170).length).toBeGreaterThan(100);
  });
});

describe("series areas", () => {
  it("breaks the line on a gap and never bridges it", () => {
    const s: Series = { id: "ops/logs/security", server: "ops", label: "", unit: "docs", stepMs: 10, observedAt: at,
      points: [[0, 1], [10, 2], [20, 4], [60, 4], [70, 2]] };
    const a = areas(s, 70, 40, 0, 70);
    expect(a.segments).toHaveLength(2); expect(a.gaps).toEqual([[20, 60]]); expect(a.top).toBe(4);
    expect(a.segments[0]!.line.startsWith("M0 ")).toBe(true);
  });
});

describe("sourceState", () => {
  it("lists reporting and failing servers", () => {
    const s = { servers: { lab: { sources: [{ id: "argo", periodMs: 1, ok: false, error: "forbidden" }] }, ops: { sources: [{ id: "argo", periodMs: 1, ok: true }] }, staging: {} } } as never;
    expect(sourceState(s, "argo")).toEqual({ reporting: ["lab", "ops"], failing: [{ server: "lab", error: "forbidden" }] });
    expect(sourceState(s, "crowdsec").reporting).toEqual([]);
  });
});
