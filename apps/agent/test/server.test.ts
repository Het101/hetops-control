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

import { loadConfig } from "../src/config.js";
import { writeFileSync, mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";

describe("hardening", () => {
  const tok = (() => { const f = join(mkdtempSync(join(tmpdir(), "agent-")), "t"); writeFileSync(f, "tok\n"); return f; })();
  const env = (o: Record<string, string>) => ({ SERVER: "lab", AGENT_TOKEN_FILE: tok, ...o }) as NodeJS.ProcessEnv;
  it("refuses an empty token", () => {
    expect(() => buildServer(new Registry("lab", [], () => t0), "")).toThrow(/empty/);
  });
  it("refuses partial TLS and bad ports", () => {
    expect(() => loadConfig(env({ TLS_CERT_FILE: "/x" }))).toThrow(/together/);
    for (const p of ["0", "70000", "abc", "1.5"]) expect(() => loadConfig(env({ PORT: p }))).toThrow(/PORT/);
    expect(loadConfig(env({ PORT: "17443" })).port).toBe(17443);
  });
  it("survives a throwing listener", async () => {
    const reg = new Registry("lab", [fake()], () => t0); const got: string[] = [];
    reg.on(() => { throw new Error("boom"); }); reg.on(m => got.push(m.type));
    await reg.runOnce("fake"); expect(got).toContain("state");
  });
  it("does not overlap after a timeout and discards the late result", async () => {
    let calls = 0, release!: () => void;
    const slow = { id: "slow", periodMs: 20, collect: () => { calls++; return new Promise<{ entities: never[] }>(r => { release = () => r({ entities: [] }); }); } };
    const reg = new Registry("lab", [slow], () => t0);
    await reg.runOnce("slow"); expect(reg.state().sources[0]).toMatchObject({ ok: false, error: "timed out after 20ms" });
    await reg.runOnce("slow"); expect(calls).toBe(1);
    release(); await new Promise(r => setTimeout(r, 5));
    expect(reg.state().sources[0]).toMatchObject({ ok: false });
    await reg.runOnce("slow"); expect(calls).toBe(2);
  });
  it("does not echo payload values in invalid entity errors, and rejects bad events", async () => {
    const bad = { id: "bad", periodMs: 10_000, async collect() { return { entities: [{ id: "lab/app/y", kind: "app", server: "lab", name: "SECRET-VALUE", status: "weird" }] as never }; } };
    const badEv = { id: "badev", periodMs: 10_000, async collect() { return { entities: [], events: [{ summary: "x" }] as never }; } };
    const reg = new Registry("lab", [bad, badEv], () => t0); const types: string[] = []; reg.on(m => types.push(m.type));
    await reg.runOnce("bad"); await reg.runOnce("badev");
    const [a, b] = reg.state().sources;
    expect(a!.error).toMatch(/^invalid entity lab\/app\/y: /); expect(a!.error).not.toContain("SECRET-VALUE");
    expect(b!.error).toMatch(/^invalid event 0: /); expect(types).not.toContain("event");
  });
  it("start() twice does not duplicate timers", async () => {
    let calls = 0; const s = { id: "s", periodMs: 30, async collect() { calls++; return { entities: [] }; } };
    const reg = new Registry("lab", [s], () => t0); reg.start(); reg.start();
    await new Promise(r => setTimeout(r, 100)); reg.stop();
    expect(calls).toBeLessThanOrEqual(5); // one timer: ~1 immediate + ~3 ticks (two timers would be ~8)
  });
  it("closes promptly while a stream client is connected", async () => {
    const reg = new Registry("lab", [fake()], () => t0); await reg.runOnce("fake");
    const app = buildServer(reg, "s3cret"); app.log.level = "silent"; await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/v1/stream`, { headers: { authorization: "Bearer s3cret" } });
    const reader = res.body!.getReader(); await reader.read();
    const t = Date.now(); await app.close(); expect(Date.now() - t).toBeLessThan(1000);
    expect((await reader.read()).done).toBe(true); expect(reg.listenerCount()).toBe(0);
  });
  it("cleans up SSE listeners after a client abort", async () => {
    const reg = new Registry("lab", [fake()], () => t0); await reg.runOnce("fake");
    const app = buildServer(reg, "s3cret"); await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port; const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/v1/stream`, { headers: { authorization: "Bearer s3cret" }, signal: ac.signal });
    await res.body!.getReader().read(); expect(reg.listenerCount()).toBe(1);
    ac.abort(); await new Promise(r => setTimeout(r, 100));
    expect(reg.listenerCount()).toBe(0); await app.close();
  });
});

describe("shutdown", () => {
  it("close() does not wait for a connection that never sent a request", async () => {
    const { connect } = await import("node:net");
    const app = buildServer(new Registry("lab", [], () => t0), "tok"); app.log.level = "silent";
    await app.listen({ port: 0, host: "127.0.0.1" });
    const sock = connect((app.server.address() as { port: number }).port, "127.0.0.1");
    await new Promise(r => sock.once("connect", r));
    const t = Date.now(); await app.close(); sock.destroy();
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
