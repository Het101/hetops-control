import { describe, it, expect } from "vitest";
import type { Entity, Series } from "@hetops-control/contracts";
import { columns, incidents, siteRows, spark, summary, tickHeight, ticks } from "../src/lib/sites.js";

const H = 3_600_000, now = Date.parse("2026-10-30T07:42:00.000Z"), end = Date.parse("2026-10-30T07:00:00.000Z");
const site = (key: string, name: string, group: string, p: Partial<Entity> = {}, ms = 100, up = 100): Entity => ({ id: `ops/site/${key}`, kind: "site", server: "ops", name,
  status: "ok", facts: { group: { value: group }, host: { value: `${key}.dev` }, latencyMs: { value: ms }, uptime24h: { value: up } }, links: [], actions: [], observedAt: "2026-10-30T07:42:00.000Z", ...p });
const series = (id: string, pts: [number, number][]): Series => ({ id, server: "ops", label: "", unit: "%", stepMs: H, points: pts, observedAt: "2026-10-30T07:42:00.000Z" });

describe("ticks", () => {
  it("is the last 24 clock hours, newest last; an hour with no point is unknown, never up", () => {
    const t = ticks(series("x", [[end - 23 * H, 100], [end - H, 98.6], [end, 100]]), now);
    expect(t).toHaveLength(24);
    expect([t[0], t[22], t[23]]).toEqual([{ t: end - 23 * H, up: 100 }, { t: end - H, up: 98.6 }, { t: end, up: 100 }]);
    expect(t.slice(1, 22).every(k => k.up === undefined)).toBe(true);           // the restart gap: hollow
    expect(ticks(undefined, now).every(k => k.up === undefined)).toBe(true);
  });
  it("tick heights: full at 100 %, a visible notch for any down time, a floor at 0.3", () => {
    expect(tickHeight(100)).toBe(1);
    expect(tickHeight(99.99)).toBeLessThan(.91);
    expect(tickHeight(95)).toBeCloseTo(.6);
    expect(tickHeight(0)).toBe(.3);
  });
  it("counts consecutive hours with down time as one incident", () => {
    const k = (ups: (number | undefined)[]) => ups.map((up, i) => ({ t: i, up }));
    expect(incidents(k([100, 99, 98, 100, 99.9, undefined, 97]))).toBe(3);
    expect(incidents(k([100, undefined]))).toBe(0);
  });
});

describe("siteRows and summary", () => {
  const ents = [site("radar", "Radar Cloud", "products", {}, 212), site("hub", "Hub", "sites"),
    site("tv", "ThreadVault", "products", { status: "down", statusReason: "3 failed" }, 90, 99.71), site("blog", "Blog", "sites", {}, 92)];
  const ser = [series("ops/site/radar/uptime-1h", [[end - 3 * H, 100], [end - 2 * H, 98.61], [end - H, 100], [end, 100]]),
    series("ops/site/tv/uptime-1h", [[end - H, 40], [end, 0]]), series("ops/site/radar/latency-1h", [[end - 30 * H, 1], [end - H, 200], [end, 210]])];
  it("puts Sites before Products, what needs you first in each, then by name, with its series joined by id", () => {
    const rows = siteRows(ents, ser, now);
    expect(rows.map(r => r.e.name)).toEqual(["Blog", "Hub", "ThreadVault", "Radar Cloud"]);
    expect(rows[2]!.warm).toBe(true);
    expect(rows[3]!.lat).toEqual([200, 210]);      // older than 24 h is dropped
    expect(rows[0]!.ticks.every(k => k.up === undefined)).toBe(true);
    expect(rows[0]!.host).toBe("blog.dev");
  });
  it("summarises the board in one line", () => {
    expect(summary(siteRows(ents, ser, now))).toBe("3/4 up · slowest Radar Cloud 212 ms · 2 incidents in 24 h");
    expect(summary(siteRows([site("hub", "Hub", "sites")], [], now))).toBe("1/1 up · slowest Hub 100 ms");
    expect(summary(siteRows([site("hub", "Hub", "sites")], [series("ops/site/hub/uptime-1h", [[end, 100]])], now))).toBe("1/1 up · slowest Hub 100 ms · no incidents in 24 h");
  });
  it("draws a sparkline in its box, flat when every hour is the same, nothing for one point", () => {
    expect(spark([1, 3], 56, 14)).toBe("M0.0,13.0L56.0,1.0");
    expect(spark([5, 5, 5], 56, 14)).toBe("M0.0,7.0L28.0,7.0L56.0,7.0");
    expect(spark([5], 56, 14)).toBe("");
  });
});

describe("columns", () => {
  const rows = (n: number, m: number) => siteRows([...Array.from({ length: n }, (_, i) => site(`s${i}`, `S${i}`, "sites")),
    ...Array.from({ length: m }, (_, i) => site(`p${i}`, `P${i}`, "products"))], [], now);
  const shape = ([l, r]: ReturnType<typeof columns>) => [l, r].map(c => c.map(x => (x.row ? "r" : x.cont ? "c" : "h")).join(""));
  it("splits 5 and 5 at the group, each column under its heading", () => expect(shape(columns(rows(5, 5)))).toEqual(["hrrrrr", "hrrrrr"]));
  it("balances 7 and 3, repeating the heading of a group that runs on", () => expect(shape(columns(rows(7, 3)))).toEqual(["hrrrrr", "crrhrrr"]));
  it("never ends a column on a heading, and copes with one group or none", () => {
    expect(shape(columns(rows(1, 1)))).toEqual(["hr", "hr"]);
    expect(shape(columns(rows(4, 0)))).toEqual(["hrr", "crr"]);
    expect(shape(columns(rows(0, 0)))).toEqual(["", ""]);
  });
});
