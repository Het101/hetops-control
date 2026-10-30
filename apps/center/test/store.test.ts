import { describe, it, expect } from "vitest"; import { CenterStateSchema } from "@hetops-control/contracts"; import { Store } from "../src/store.js";
const at = (s: string) => new Date(`2026-10-30T12:00:${s}Z`);
const state = (status: "ok" | "attention", observed = "2026-10-30T12:00:00Z") => ({ server: "lab" as const, version: "0.1.0", generatedAt: observed,
  sources: [{ id: "kubernetes", periodMs: 10000, ok: true, lastRunAt: observed }],
  entities: [{ id: "lab/app/clinic/api", kind: "app" as const, server: "lab" as const, name: "api", status, facts: {}, links: [], actions: [], observedAt: observed }] });

describe("store", () => {
  it("records a status change as an event", () => {
    let now = at("00"); const st = new Store(() => now);
    expect(st.apply("lab", state("ok"))).toHaveLength(0);
    now = at("10"); const ev = st.apply("lab", state("attention", "2026-10-30T12:00:10Z"));
    expect(ev).toHaveLength(1); expect(ev[0]!.summary).toContain("ok → attention");
  });
  it("ages data older than 3 periods to unknown", () => {
    let now = at("00"); const st = new Store(() => now); st.apply("lab", state("ok"));
    now = new Date("2026-10-30T12:00:31Z"); expect(st.snapshot().entities[0]!.status).toBe("unknown");
  });
  it("an unreachable agent turns its server and entities unknown", () => {
    const st = new Store(() => at("00")); st.apply("lab", state("ok")); st.markUnreachable("lab", at("05"));
    const s = st.snapshot(); expect(s.servers.lab.status).toBe("unknown"); expect(s.servers.lab.reachable).toBe(false);
    expect(s.entities.every(e => e.status === "unknown")).toBe(true);
  });
  it("staging, never connected, is unknown and not reachable", () => {
    expect(new Store().snapshot().servers.staging).toMatchObject({ status: "unknown", reachable: false });
  });
});

describe("store details", () => {
  const withSources = (observed: string) => ({ ...state("ok", observed),
    sources: [{ id: "kubernetes", periodMs: 10000, ok: true }, { id: "argo", periodMs: 60000, ok: true }],
    entities: [{ ...state("ok", observed).entities[0]!, source: "kubernetes" }, { ...state("ok", observed).entities[0]!, id: "lab/argo-app/x", name: "x" }] });
  it("ages by the entity's own source, falling back to the slowest period", () => {
    let now = at("00"); const st = new Store(() => now); st.apply("lab", withSources("2026-10-30T12:00:00Z"));
    now = new Date("2026-10-30T12:00:45Z"); const s = st.snapshot();
    expect(s.entities.find(e => e.id === "lab/app/clinic/api")).toMatchObject({ status: "unknown", statusReason: "stale: no data for 45 s" });
    expect(s.entities.find(e => e.id === "lab/argo-app/x")!.status).toBe("ok"); // no source → 3 × 60 s
  });
  it("emits one unreachable and one reachable-again event per server, and notifies listeners", () => {
    const st = new Store(() => at("10")); const got: string[] = []; st.on(m => got.push(m.type));
    st.apply("lab", state("ok"));
    const down = st.markUnreachable("lab", at("05"));
    expect(down.map(e => e.summary)).toEqual(["lab unreachable (agent silent since 12:00:05 UTC)"]);
    expect(st.markUnreachable("lab", at("06"))).toEqual([]);
    expect(st.snapshot().entities[0]!.statusReason).toBe("agent unreachable since 2026-10-30T12:00:05.000Z");
    expect(st.apply("lab", state("attention")).map(e => e.summary)).toEqual(["lab reachable again", "api (lab) ok → attention"]);
    expect(got).toEqual(["state", "state", "event", "state", "event", "event"]);
  });
  it("ages on the center's clock, so an agent clock 5 minutes behind is not stale", () => {
    let now = at("00"); const st = new Store(() => now); st.apply("lab", state("ok", "2026-10-30T11:55:00Z"));
    now = at("20"); expect(st.snapshot().entities[0]!.status).toBe("ok");
    now = at("31"); expect(st.snapshot().entities[0]!.status).toBe("unknown");
  });
  it("new and removed entities produce no status event; a reconnect replaces the server's entities", () => {
    const st = new Store(() => at("00")); st.apply("lab", state("ok"));
    expect(st.apply("lab", { ...state("ok"), entities: [] })).toEqual([]);
    expect(st.snapshot().entities).toEqual([]);
    expect(st.apply("lab", state("attention"))).toEqual([]);
  });
});

describe("server roll-up", () => {
  const e = (id: string, status: "ok" | "attention" | "down" | "unknown", observed = "2026-10-30T12:00:00Z", source = "kubernetes") =>
    ({ ...state("ok").entities[0]!, id, name: id, status, observedAt: observed, source });
  const with_ = (...entities: ReturnType<typeof e>[]) => ({ ...state("ok"), sources: [{ id: "kubernetes", periodMs: 10000, ok: true }], entities });
  const lab = (st: Store) => st.snapshot().servers.lab;
  it("never connected: unknown, not connected yet", () => {
    expect(lab(new Store())).toMatchObject({ status: "unknown", statusReason: "not connected yet", reachable: false });
  });
  it("unreachable: unknown with the time it went silent", () => {
    const st = new Store(() => at("10")); st.apply("lab", with_(e("a", "ok"))); st.markUnreachable("lab", at("05"));
    expect(lab(st)).toMatchObject({ status: "unknown", statusReason: "agent unreachable since 12:00 UTC", reachable: false });
  });
  it("reachable with no entities: unknown, no data yet", () => {
    const st = new Store(() => at("00")); st.apply("lab", with_());
    expect(lab(st)).toMatchObject({ status: "unknown", statusReason: "no data yet", reachable: true });
  });
  it("worst of the known statuses; an agent-reported unknown does not drag it down", () => {
    const st = new Store(() => at("00"));
    st.apply("lab", with_(e("a", "ok"), e("b", "unknown"))); expect(lab(st)).toEqual(expect.objectContaining({ status: "ok" }));
    expect(lab(st).statusReason).toBeUndefined();
    st.apply("lab", with_(e("a", "ok"), e("b", "attention"), e("c", "down"))); expect(lab(st).status).toBe("down");
  });
  it("stale readings among ok ones lift the server to attention", () => {
    let now = at("00"); const st = new Store(() => now);
    st.apply("lab", { ...with_(e("a", "ok"), e("b", "ok", "2026-10-30T11:59:00Z"), e("c", "ok", "2026-10-30T11:59:00Z")) });
    now = at("01"); expect(lab(st)).toMatchObject({ status: "attention", statusReason: "2 readings stale" });
  });
  it("a known attention or down outranks stale readings", () => {
    let now = at("00"); const st = new Store(() => now);
    st.apply("lab", with_(e("a", "down"), e("b", "ok", "2026-10-30T11:59:00Z")));
    now = at("01"); expect(lab(st).status).toBe("down");
  });
  it("all readings stale: attention", () => {
    let now = at("00"); const st = new Store(() => now); st.apply("lab", with_(e("a", "ok")));
    now = at("45"); expect(lab(st)).toMatchObject({ status: "attention", statusReason: "1 reading stale" });
  });
  it("a failing source lifts a reachable server to attention, with or without entities", () => {
    const st = new Store(() => at("00")); const bad = { id: "kubernetes", periodMs: 10000, ok: false, error: "forbidden" };
    st.apply("lab", { ...with_(), sources: [bad] });
    expect(lab(st)).toMatchObject({ status: "attention", statusReason: "1 source failing", failingSources: [{ id: "kubernetes", error: "forbidden" }] });
    st.apply("lab", { ...with_(e("a", "ok")), sources: [bad] }); expect(lab(st)).toMatchObject({ status: "attention", statusReason: "1 source failing" });
    st.apply("lab", { ...with_(e("a", "down")), sources: [bad] }); expect(lab(st).status).toBe("down");
  });
  it("reachable with no data and no failing source stays unknown", () => {
    const st = new Store(() => at("00")); st.apply("lab", with_()); expect(lab(st)).toMatchObject({ status: "unknown", statusReason: "no data yet" });
  });
  it("a source that has not run yet is pending, not failing", () => {
    const st = new Store(() => at("00")); const pend = { id: "kubernetes", periodMs: 10000, ok: false };
    st.apply("lab", { ...with_(), sources: [pend] }); expect(lab(st)).toMatchObject({ status: "unknown", statusReason: "starting" }); expect(lab(st).failingSources).toBeUndefined();
    st.apply("lab", { ...with_(e("a", "ok")), sources: [pend, { id: "argo", periodMs: 1, ok: true }] }); expect(lab(st)).toMatchObject({ status: "ok" });
    st.apply("lab", { ...with_(e("a", "ok")), sources: [{ ...pend, error: "boom" }] }); expect(lab(st)).toMatchObject({ status: "attention", statusReason: "1 source failing" });
  });
  it("reports configured and the last error only while unreachable", () => {
    const st = new Store(() => at("00"), ["lab"]); st.setError("lab", "connect ECONNREFUSED");
    expect(st.snapshot().servers).toMatchObject({ lab: { configured: true, lastError: "connect ECONNREFUSED", statusReason: "its agent has not answered yet" },
      staging: { configured: false, statusReason: "not connected yet" } });
    expect(st.snapshot().servers.staging.lastError).toBeUndefined();
    st.apply("lab", state("ok")); expect(st.snapshot().servers.lab.lastError).toBeUndefined();
  });
});

describe("store series", () => {
  const ser = { id: "ops/logs/default", server: "lab" as const, label: "log lines", unit: "lines/min", stepMs: 60000, points: [[1, 2]] as [number, number][],
    observedAt: "2026-10-30T12:00:00Z", source: "kubernetes" };
  const withSeries = () => ({ ...state("ok"), series: [ser] });
  it("has series [] with no agents and for agents without series", () => {
    expect(new Store(() => at("00")).snapshot().series).toEqual([]);
    const st = new Store(() => at("00")); st.apply("lab", state("ok")); expect(st.snapshot().series).toEqual([]);
  });
  it("merges series and drops them when aged past 3 periods", () => {
    let now = at("00"); const st = new Store(() => now); st.apply("lab", withSeries());
    expect(st.snapshot().series).toEqual([ser]);
    now = new Date("2026-10-30T12:00:31Z"); expect(st.snapshot().series).toEqual([]);
  });
  it("drops series of an unreachable agent", () => {
    const st = new Store(() => at("00")); st.apply("lab", withSeries()); st.markUnreachable("lab", at("05"));
    expect(st.snapshot().series).toEqual([]);
  });
});

describe("store series ageing edges", () => {
  const base = { id: "a", server: "lab" as const, label: "l", unit: "n", stepMs: 1000, points: [] as [number, number][], observedAt: "2026-10-30T12:00:00Z" };
  it("sourceless series ages by the slowest period; exactly 3x is kept, beyond is dropped", () => {
    let now = at("00"); const st = new Store(() => now);
    st.apply("lab", { ...state("ok"), sources: [{ id: "k", periodMs: 10000, ok: true }, { id: "argo", periodMs: 60000, ok: true }], series: [base] });
    now = new Date("2026-10-30T12:03:00Z"); expect(st.snapshot().series).toHaveLength(1);
    now = new Date("2026-10-30T12:03:00.001Z"); expect(st.snapshot().series).toHaveLength(0);
  });
});

describe("store many series", () => {
  it("more than 64 series across two agents is still a valid CenterState", () => {
    const st = new Store(() => at("00"));
    const mk = (server: "lab" | "ops") => ({ ...state("ok"), server, series: Array.from({ length: 64 }, (_, i) => ({ id: `${server}/s${i}`, server, label: "l", unit: "n", stepMs: 1000, points: [] as [number, number][], observedAt: "2026-10-30T12:00:00Z", source: "kubernetes" })),
      entities: [] });
    st.apply("lab", mk("lab")); st.apply("ops", mk("ops"));
    const snap = st.snapshot(); expect(snap.series).toHaveLength(128); CenterStateSchema.parse(snap);
  });
});
