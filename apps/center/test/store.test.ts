import { describe, it, expect } from "vitest"; import { Store } from "../src/store.js";
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
    expect(down.map(e => e.summary)).toEqual(["lab unreachable (agent silent since 12:00:05)"]);
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
    expect(lab(st)).toMatchObject({ status: "unknown", statusReason: "agent unreachable since 12:00", reachable: false });
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
    now = at("45"); expect(lab(st)).toMatchObject({ status: "attention", statusReason: "1 readings stale" });
  });
});
