import { describe, it, expect } from "vitest";
import { z } from "zod";
import { AgentStateSchema, type Action } from "@hetops-control/contracts";
import { Registry } from "../src/registry.js"; import { buildServer } from "../src/server.js";
import { actionRunner, buildActions, describeAction } from "../src/actions/index.js";

const t0 = new Date("2026-10-31T10:00:00Z");
const ent = (name: string) => ({ id: `lab/app/${name}`, kind: "app" as const, server: "lab" as const, name, status: "ok" as const, facts: {}, links: [], actions: [], observedAt: t0.toISOString() });
const src = { id: "fake", periodMs: 10_000, async collect() { return { entities: [ent("x"), ent("y")] }; } };
const ran: unknown[] = [];
const poke: Action<{ times: number }> = {
  id: "test.poke", label: "Poke", description: "Pokes x.", targets: ["app"], risk: "safe",
  params: z.object({ times: z.number().int().min(1).max(3).default(1).describe("How often") }).strict(),
  applies: e => e.name === "x",
  async preview(t, p) { return `Pokes ${t.name} ${p.times} time(s).`; },
  async run(t, p, ctx) { ran.push([t.id, p, ctx.actor, ctx.requestId]); return { ok: true, summary: `poked ${t.name}` }; },
};
const hang: Action<Record<string, never>> = { ...poke, id: "test.hang", params: z.object({}).strict(), run: () => new Promise(() => {}) } as never;
const body = (over: object = {}) => ({ target: "lab/app/x", params: {}, actor: "het@hetops.dev", requestId: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", ...over });

async function setup(limitMs?: number) {
  const reg = new Registry("lab", [src], () => t0, [poke, hang]); await reg.runOnce("fake");
  const app = buildServer(reg, "s3cret", { run: actionRunner(reg, [poke, hang], limitMs ? { limitMs } : {}) });
  const post = (url: string, payload: unknown, auth = "Bearer s3cret") => app.inject({ method: "POST", url, payload: payload as object, headers: { authorization: auth } });
  return { reg, app, post };
}

describe("agent actions", () => {
  it("offers an action only on the entities it applies to, and publishes its descriptor", async () => {
    const { reg } = await setup();
    const s = AgentStateSchema.parse(reg.state());
    expect(s.entities.find(e => e.name === "x")!.actions).toEqual([{ id: "test.poke", label: "Poke", risk: "safe" }, { id: "test.hang", label: "Poke", risk: "safe" }]);
    expect(s.entities.find(e => e.name === "y")!.actions).toEqual([]);
    expect(s.actions!.find(a => a.id === "test.poke")!.params.properties.times).toEqual({ type: "integer", minimum: 1, maximum: 3, default: 1, description: "How often" });
  });
  it("needs the bearer token", async () => {
    const { post } = await setup();
    expect((await post("/v1/actions/test.poke", body(), "Bearer nope")).statusCode).toBe(401);
  });
  it("previews and runs with the actor and request id, after validating everything", async () => {
    const { post } = await setup(); ran.length = 0;
    expect((await post("/v1/actions/test.poke/preview", body({ params: { times: 2 } }))).json()).toEqual({ text: "Pokes x 2 time(s)." });
    const r = await post("/v1/actions/test.poke", body());
    expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ ok: true, summary: "poked x" });
    expect(ran).toEqual([["lab/app/x", { times: 1 }, "het@hetops.dev", "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10"]]);
    expect((await post("/v1/actions/test.nope", body())).statusCode).toBe(404);
    expect((await post("/v1/actions/test.poke", body({ target: "lab/app/y" }))).statusCode).toBe(422);   // not offered on y
    expect((await post("/v1/actions/test.poke", body({ target: "lab/app/zz" }))).statusCode).toBe(422);
    expect((await post("/v1/actions/test.poke", body({ params: { times: 9 } }))).statusCode).toBe(422);
    expect((await post("/v1/actions/test.poke", body({ actor: "nobody" }))).statusCode).toBe(400);
    expect(ran).toHaveLength(1);
  });
  it("one run per target at a time, and a hung action fails at the limit instead of hanging", async () => {
    const { post } = await setup(50);
    const first = post("/v1/actions/test.hang", body());
    await new Promise(r => setTimeout(r, 10));   // let the first request reach its handler and take the lock
    expect((await post("/v1/actions/test.poke", body())).statusCode).toBe(409);
    expect((await first).json()).toEqual({ ok: false, summary: "timed out after 0.05 s; the result is unknown" });
  });
  it("buildActions: only what ACTIONS names, each with its settings", () => {
    const make = { "test.poke": () => poke };
    expect(buildActions({}, make)).toEqual([]);
    expect(buildActions({ ACTIONS: " test.poke " }, make)).toEqual([poke]);
    expect(() => buildActions({ ACTIONS: "test.nope" }, make)).toThrow("unknown action test.nope in ACTIONS");
  });
  it("snapshot.now needs ES_URL and ES_OPERATOR_DIR", () => {
    expect(() => buildActions({ ACTIONS: "snapshot.now" })).toThrow("snapshot.now needs ES_URL");
    expect(() => buildActions({ ACTIONS: "snapshot.now", ES_URL: "https://es:9200" })).toThrow("needs ES_OPERATOR_DIR");
    expect(buildActions({ ACTIONS: "snapshot.now", ES_URL: "https://es:9200", ES_OPERATOR_DIR: "/x" })[0]!.id).toBe("snapshot.now");
  });
  it("every params schema stays inside the subset the web and center understand", () => {
    expect(describeAction(poke).params.additionalProperties).toBe(false);
    const wild = { ...poke, params: z.object({ x: z.string().regex(/a/) }) };
    expect(() => describeAction(wild as never)).toThrow();
  });
});
