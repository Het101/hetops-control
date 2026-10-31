import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import type { ActionDescriptor, ActionRun, AgentState, Entity, Event, ServerId } from "@hetops-control/contracts";
import { Store } from "../src/store.js"; import { EventsDb } from "../src/events-db.js";
import { Actions, ActionError, centerState, type AgentCall } from "../src/actions.js"; import { gatusAck } from "../src/ack.js";

const OWNER = "het@hetops.dev";
const empty = { type: "object" as const, properties: {}, additionalProperties: false as const };
const D = (id: string, risk: "safe" | "disruptive" = "safe", params: ActionDescriptor["params"] = empty): ActionDescriptor =>
  ({ id, label: id.split(".")[1]!, description: "d", targets: ["argo-app", "alert"], risk, preview: true, params });
const silence = D("alert.silence", "safe", { type: "object", additionalProperties: false, properties: { hours: { type: "string", enum: ["1", "4"], default: "4" } } });
const cleanups: (() => void)[] = []; afterEach(() => { cleanups.splice(0).forEach(f => f()); });

function setup(o: { call?: AgentCall; timeoutMs?: number; actors?: string[]; limits?: ConstructorParameters<typeof Actions>[0]["limits"] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "center-act-")); const db = new EventsDb(join(dir, "e.db"));
  const now = new Date(); const at = now.toISOString();
  const store = new Store(() => now, ["lab", "ops"]);
  const ent = (id: string, kind: Entity["kind"], name: string, refs: string[], source: string, status: Entity["status"] = "ok"): Entity => ({ id, kind, server: id.split("/")[0] as ServerId,
    name, status, facts: {}, links: [], observedAt: at, source, actions: refs.map(r => ({ id: r, label: r.split(".")[1]!, risk: r === "test.wipe" ? "disruptive" : "safe" })) });
  const state = (server: ServerId, entities: Entity[], actions: ActionDescriptor[]): AgentState => ({ server, version: "t", generatedAt: at, entities, actions,
    sources: [...new Set(entities.map(e => e.source!))].map(id => ({ id, periodMs: 30_000, ok: true, lastRunAt: at })) });
  store.apply("lab", state("lab", [ent("lab/argo-app/clinic", "argo-app", "clinic", ["argo.sync", "test.wipe"], "argo"),
    ent("lab/argo-app/web", "argo-app", "web", ["argo.sync"], "argo"), ent("lab/alert/abc", "alert", "KubeQuota", ["alert.silence"], "alertmanager")],
    [D("argo.sync"), D("test.wipe", "disruptive"), silence]));
  store.apply("ops", state("ops", [ent("ops/site/blog", "site", "blog", [], "gatus", "down")], []));
  const calls: { server: string; path: string; body: any }[] = [];
  const call: AgentCall = o.call ?? (async (server, path, body) => { calls.push({ server, path, body });
    return path.endsWith("/preview") ? { status: 200, body: { text: "will sync clinic" } } : { status: 200, body: { ok: true, summary: "sync of clinic started" } }; });
  const published: { run?: ActionRun; event?: Event }[] = [];
  const local = [gatusAck(db)];
  const actions = new Actions({ state: () => centerState(store, db, local, now.getTime()), db, local, call, actors: o.actors ?? [OWNER],
    publish: m => published.push(m), now: () => now, ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}), ...(o.limits ? { limits: o.limits } : {}) });
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { actions, db, calls, published, store, local, now };
}
const key = () => crypto.randomUUID();
const settle = () => new Promise(r => setTimeout(r, 10));
const code = (f: () => unknown) => { try { f(); } catch (e) { return e instanceof ActionError ? e.code : -1; } return 0; };
const sync = { action: "argo.sync", target: "lab/argo-app/clinic", params: {} };

describe("center actions", () => {
  it("only the identities in ACTORS may act, and nobody when it is empty", () => {
    expect(code(() => setup({ actors: ["someone@else.dev"] }).actions.start(sync, OWNER, key()))).toBe(403);
    expect(code(() => setup({ actors: [] }).actions.start(sync, OWNER, key()))).toBe(403);
  });
  it("runs an offered action: one agent call with actor and key, an audit row, two action events, streamed runs", async () => {
    const { actions, calls, db, published } = setup(); const k = key();
    const { run, replay } = actions.start(sync, OWNER, k);
    expect(replay).toBe(false); expect(run).toMatchObject({ id: k, state: "running", actor: OWNER, targetName: "clinic", server: "lab" });
    await settle();
    expect(calls).toEqual([{ server: "lab", path: "/v1/actions/argo.sync", body: { target: "lab/argo-app/clinic", params: {}, actor: OWNER, requestId: k } }]);
    expect(db.run(k)).toMatchObject({ state: "succeeded", result: { ok: true, summary: "sync of clinic started" } });
    const evs = published.flatMap(p => (p.event ? [p.event] : []));
    expect(evs.map(e => [e.kind, e.actor, e.entity, e.source])).toEqual([["action", OWNER, "lab/argo-app/clinic", "control"], ["action", OWNER, "lab/argo-app/clinic", "control"]]);
    expect(evs[0]!.summary).toBe(`${OWNER} asked: sync clinic (lab)`); expect(evs[1]!.summary).toBe("sync clinic (lab): sync of clinic started");
    expect(published.flatMap(p => (p.run ? [p.run.state] : []))).toEqual(["running", "succeeded"]);
    expect(db.recent(5).filter(e => e.kind === "action")).toHaveLength(2);
  });
  it("checks target, offer, params and reachability before asking anyone", async () => {
    const { actions, calls } = setup();
    expect(code(() => actions.start({ ...sync, target: "lab/argo-app/nope" }, OWNER, key()))).toBe(404);
    expect(code(() => actions.start({ ...sync, action: "alert.silence" }, OWNER, key()))).toBe(422);        // not offered on clinic
    expect(code(() => actions.start({ action: "alert.silence", target: "lab/alert/abc", params: { hours: "9" } }, OWNER, key()))).toBe(422);
    expect(code(() => actions.start({ ...sync, extra: 1 }, OWNER, key()))).toBe(400);
    expect(code(() => actions.start(sync, OWNER, "not-a-uuid"))).toBe(400);
    expect(code(() => actions.start(sync, OWNER, undefined))).toBe(400);
    await settle(); expect(calls).toEqual([]);
  });
  it("refuses to act on a server it cannot see", () => {
    const { actions, store } = setup(); store.markUnreachable("lab", new Date());
    expect(code(() => actions.start(sync, OWNER, key()))).toBe(409);
  });
  it("replays a repeated Idempotency-Key without acting again, and refuses it for another request", async () => {
    const { actions, calls } = setup(); const k = key();
    actions.start(sync, OWNER, k); await settle();
    expect(actions.start(sync, OWNER, k)).toMatchObject({ replay: true, run: { id: k, state: "succeeded" } });
    expect(code(() => actions.start({ ...sync, target: "lab/argo-app/web" }, OWNER, k))).toBe(409);
    expect(calls).toHaveLength(1);
  });
  it("a retry is answered from the audit first: never a 404, 409 or 403 for a run that was started", async () => {
    const { actions, calls, store, db, local, now } = setup(); const k = key();
    const first = actions.start(sync, OWNER, k).run; await settle();
    const recorded = db.run(k);
    store.apply("lab", { server: "lab", version: "t", generatedAt: now.toISOString(), entities: [], sources: [] });   // clinic is gone
    expect(actions.start(sync, OWNER, k)).toEqual({ replay: true, run: recorded });
    store.markUnreachable("lab", now);                                                                         // lab went dark
    expect(actions.start(sync, OWNER, k)).toEqual({ replay: true, run: recorded });
    const later = new Actions({ state: () => centerState(store, db, local, now.getTime()), db, local, actors: [], publish: () => {},
      call: async () => { throw new Error("must not be called"); }, now: () => now });                         // the owner left ACTORS
    expect(later.start(sync, OWNER, k)).toEqual({ replay: true, run: recorded });
    expect(first.id).toBe(k); expect(calls).toHaveLength(1);
    // the replay is still the same caller's: another identity, or a different request under the key, is refused
    expect(code(() => actions.start(sync, "someone@else.dev", k))).toBe(409);
    expect(code(() => actions.start({ ...sync, action: "test.wipe" }, OWNER, k))).toBe(409);
    expect(code(() => actions.start({ nonsense: 1 }, OWNER, k))).toBe(400);
  });
  it("a disruptive action needs the target's name typed", async () => {
    const { actions } = setup(); const wipe = { action: "test.wipe", target: "lab/argo-app/clinic", params: {} };
    expect(code(() => actions.start(wipe, OWNER, key()))).toBe(422);
    expect(code(() => actions.start({ ...wipe, confirm: "Clinic" }, OWNER, key()))).toBe(422);
    expect(actions.start({ ...wipe, confirm: "clinic" }, OWNER, key()).run.state).toBe("running");
  });
  it("one run in flight per target; rate limits per action and target, and per action", async () => {
    let release!: () => void; const gate = new Promise<void>(r => (release = r));
    const slow: AgentCall = async () => { await gate; return { status: 200, body: { ok: true, summary: "ok" } }; };
    const { actions } = setup({ call: slow, limits: { target: { max: 2, ms: 600_000 }, action: { max: 3, ms: 600_000 }, preview: { max: 60, ms: 60_000 } } });
    actions.start(sync, OWNER, key());
    expect(code(() => actions.start(sync, OWNER, key()))).toBe(409);                  // clinic is busy
    release(); await settle();
    actions.start(sync, OWNER, key()); await settle();                                  // 2nd on clinic
    let err: unknown; try { actions.start(sync, OWNER, key()); } catch (e) { err = e; }  // 3rd on clinic: limited
    expect(err).toMatchObject({ code: 429 }); expect((err as ActionError).retryAfter).toBeGreaterThan(0);
    actions.start({ ...sync, target: "lab/argo-app/web" }, OWNER, key()); await settle();   // 3rd sync overall
    expect(code(() => actions.start({ action: "argo.sync", target: "lab/argo-app/web", params: {} }, OWNER, key()))).toBe(429);   // per-action cap
  });
  it("gives the agent timeoutMs, then fails the run as unknown", async () => {
    const { actions, db } = setup({ call: (_s, _p, _b, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(signal.reason))), timeoutMs: 30 });
    const k = key(); actions.start(sync, OWNER, k); await new Promise(r => setTimeout(r, 80));
    expect(db.run(k)).toMatchObject({ state: "failed", error: "no answer in 0.03 s; the result is unknown, check clinic" });
  });
  it("an agent refusal is a failed run carrying the agent's message", async () => {
    const { actions, db } = setup({ call: async () => ({ status: 409, body: { error: "an action on clinic is still running" } }) });
    const k = key(); actions.start(sync, OWNER, k); await settle();
    expect(db.run(k)).toMatchObject({ state: "failed", error: "an action on clinic is still running" });
  });
  it("previews through the agent, rate limited", async () => {
    const { actions, calls } = setup({ limits: { target: { max: 3, ms: 1 }, action: { max: 12, ms: 1 }, preview: { max: 1, ms: 60_000 } } });
    expect(await actions.preview(sync, OWNER)).toEqual({ text: "will sync clinic" });
    expect(calls[0]!.path).toBe("/v1/actions/argo.sync/preview");
    await expect(actions.preview(sync, OWNER)).rejects.toMatchObject({ code: 429 });
  });
});

describe("gatus.ack (center-side)", () => {
  it("is offered on a failing Gatus check, takes it off Needs you, and lapses when its status changes", async () => {
    const { actions, store, db, local, now } = setup();
    const s0 = centerState(store, db, local, now.getTime());
    expect(s0.entities.find(e => e.id === "ops/site/blog")!.actions.map(a => a.id)).toEqual(["gatus.ack"]);
    expect(s0.headline.needs.some(n => n.entity === "ops/site/blog")).toBe(true);
    expect(await actions.preview({ action: "gatus.ack", target: "ops/site/blog", params: { hours: 2 } }, OWNER)).toMatchObject({ text: expect.stringContaining("Gatus keeps checking") });
    actions.start({ action: "gatus.ack", target: "ops/site/blog", params: { hours: 2, note: "DNS move" } }, OWNER, key()); await settle();
    const s1 = centerState(store, db, local, now.getTime());
    expect(s1.acks).toMatchObject([{ entity: "ops/site/blog", status: "down", actor: OWNER, note: "DNS move" }]);
    expect(s1.headline.needs.some(n => n.entity === "ops/site/blog")).toBe(false);
    expect(s1.entities.find(e => e.id === "ops/site/blog")!.actions).toEqual([]);   // nothing to press twice
    const at = now.toISOString();
    store.apply("ops", { server: "ops", version: "t", generatedAt: at, sources: [{ id: "gatus", periodMs: 30_000, ok: true, lastRunAt: at }],
      entities: [{ id: "ops/site/blog", kind: "site", server: "ops", name: "blog", status: "attention", facts: {}, links: [], actions: [], observedAt: at, source: "gatus" }] });
    const s2 = centerState(store, db, local, now.getTime());
    expect(s2.acks).toEqual([]); expect(s2.headline.needs.some(n => n.entity === "ops/site/blog")).toBe(true);
  });
});
