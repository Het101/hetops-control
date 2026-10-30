import { describe, it, expect } from "vitest";
import { Registry } from "../src/registry.js"; import { buildServer } from "../src/server.js";
import { AgentStateSchema } from "@hetops-control/contracts";

const t0 = new Date("2026-10-30T11:00:00Z");
const fake = (status: "ok" | "down" = "ok") => ({ id: "fake", periodMs: 10_000, async collect() {
  return { entities: [{ id: "lab/app/x", kind: "app" as const, server: "lab" as const, name: "x", status, facts: {}, links: [], actions: [], observedAt: t0.toISOString() }] }; } });
const broken = { id: "broken", periodMs: 10_000, async collect(): Promise<never> { throw new Error("forbidden"); } };

describe("agent", () => {
  it("requires the bearer token on /v1/state but not on /healthz", async () => {
    const reg = new Registry("lab", [fake()], () => t0); await reg.runOnce("fake");
    const app = buildServer(reg, "s3cret");
    expect((await app.inject("/healthz")).statusCode).toBe(200);
    expect((await app.inject("/v1/state")).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/state", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    const ok = await app.inject({ url: "/v1/state", headers: { authorization: "Bearer s3cret" } });
    expect(ok.statusCode).toBe(200);
    const st = AgentStateSchema.parse(ok.json()); expect(st.entities).toHaveLength(1);
  });
  it("reports a failing source without losing the others", async () => {
    const reg = new Registry("lab", [fake(), broken], () => t0);
    await reg.runOnce("fake"); await reg.runOnce("broken");
    const s = reg.state();
    expect(s.sources.find(x => x.id === "broken")).toMatchObject({ ok: false, error: "forbidden" });
    expect(s.entities.map(e => e.id)).toEqual(["lab/app/x"]);
  });
  it("emits a state message to listeners after each run", async () => {
    const reg = new Registry("lab", [fake()], () => t0); const got: string[] = [];
    reg.on(m => got.push(m.type)); await reg.runOnce("fake"); expect(got).toContain("state");
  });
  it("times out a hung source", async () => {
    const hung = { id: "hung", periodMs: 20, collect: () => new Promise<never>(() => {}) };
    const reg = new Registry("lab", [hung], () => t0); await reg.runOnce("hung");
    expect(reg.state().sources[0]).toMatchObject({ ok: false, error: "timed out after 20ms" });
  });
  it("streams state over SSE and closes cleanly", async () => {
    const reg = new Registry("lab", [fake()], () => t0); await reg.runOnce("fake");
    const app = buildServer(reg, "s3cret");
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/v1/stream`, { headers: { authorization: "Bearer s3cret" }, signal: ac.signal });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const { value } = await res.body!.getReader().read();
    const msg = JSON.parse(new TextDecoder().decode(value).replace(/^data: /, ""));
    expect(msg.type).toBe("state"); expect(msg.state.entities).toHaveLength(1);
    ac.abort(); await app.close();
  });
});
