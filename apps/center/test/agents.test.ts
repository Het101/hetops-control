import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from "vitest"; import { createServer, type IncomingMessage, type ServerResponse } from "node:http"; import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs"; import { execFileSync } from "node:child_process"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { Registry } from "../../agent/src/registry.js"; import { buildServer } from "../../agent/src/server.js";
import { AgentLink, backoffMs } from "../src/agents.js"; import { Store } from "../src/store.js"; import { EventsDb } from "../src/events-db.js";

const fake = { id: "fake", periodMs: 10_000, async collect() {
  return { entities: [{ id: "lab/app/x", kind: "app" as const, server: "lab" as const, name: "x", status: "ok" as const, facts: {}, links: [], actions: [], observedAt: new Date().toISOString() }] }; } };
const restarts = { id: "restarts", periodMs: 10_000, async collect() {
  return { entities: [], events: [{ at: new Date().toISOString(), server: "lab" as const, source: "restarts", kind: "restart" as const, summary: "x restarted" }] }; } };

let cleanup = async () => {};
let errs: MockInstance<typeof console.error>; const logged = () => errs.mock.calls.map(c => c.join(" "));
beforeEach(() => { errs = vi.spyOn(console, "error").mockImplementation(() => {}); }); // expected failures are asserted, not printed
afterEach(async () => { vi.useRealTimers(); await cleanup(); cleanup = async () => {}; vi.restoreAllMocks(); });
async function setup(token = "s3cret") {
  const reg = new Registry("lab", [fake, restarts]); await reg.runOnce("fake");
  const app = buildServer(reg, "s3cret"); app.log.level = "silent";
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), "center-")); const db = new EventsDb(join(dir, "events.db"));
  const store = new Store(); const link = new AgentLink("lab", `http://127.0.0.1:${port}`, token);
  cleanup = async () => { link.stop(); app.server.closeAllConnections(); /* the faked setTimeout can leave an aborted fetch's socket open */ await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); };
  link.start(store, db);
  return { reg, app, store, db };
}

describe("agent link", () => {
  it("fills the store from a real agent, then marks it unreachable when the agent closes", async () => {
    const { app, store, db } = await setup();
    await vi.waitFor(() => expect(store.snapshot().entities.map(e => e.id)).toEqual(["lab/app/x"]), { timeout: 2000 });
    expect(store.snapshot().servers.lab).toMatchObject({ reachable: true, status: "ok" });
    expect(store.snapshot().entities[0]!.source).toBe("fake");
    await app.close(); // ends the open stream (preClose)
    await vi.waitFor(() => expect(store.snapshot().servers.lab.reachable).toBe(false), { timeout: 25_000 });
    expect(db.recent(5)[0]!.summary).toMatch(/^lab unreachable \(agent silent since \d\d:\d\d:\d\d UTC\)$/);
  }, 30_000);
  it("records events streamed by the agent", async () => {
    const { reg, store, db } = await setup();
    await vi.waitFor(() => expect(store.snapshot().servers.lab.reachable).toBe(true), { timeout: 2000 });
    await reg.runOnce("restarts");
    await vi.waitFor(() => expect(db.recent(5).map(e => e.summary)).toContain("x restarted"), { timeout: 2000 });
  });
  it("marks the server unreachable after 20 s of silence", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // the agent's 15 s ping is a setInterval and stays real, so the stream is silent
    const { store } = await setup();
    await vi.waitFor(() => expect(store.snapshot().servers.lab.reachable).toBe(true), { timeout: 2000 });
    // the silence timer may be (re)armed late by the stream's first bytes under load, so step until it fires instead of assuming when
    await vi.advanceTimersByTimeAsync(19_000); expect(store.snapshot().servers.lab.reachable).toBe(true);
    for (let i = 0; i < 40 && store.snapshot().servers.lab.reachable; i++) await vi.advanceTimersByTimeAsync(1_000);
    expect(store.snapshot().servers.lab.reachable).toBe(false);
    expect(logged()).toContain("agent lab: silent for 20 s");
  });
  it("never fills the store with a wrong token", async () => {
    const { store } = await setup("wrong");
    await new Promise(r => setTimeout(r, 300));
    expect(store.snapshot().entities).toEqual([]); expect(store.snapshot().servers.lab.reachable).toBe(false);
    expect(logged()).toContain("agent lab: /v1/state: HTTP 401");
  });
});

const T = "2026-10-30T12:00:00.000Z";
const agentState = JSON.stringify({ server: "lab", version: "t", generatedAt: T, sources: [], entities: [] });
/** A hand-written agent, for wire shapes and failures the real one never produces. */
async function rawAgent(handle: (req: IncomingMessage, res: ServerResponse) => void) {
  const srv = createServer(handle); await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), "center-")); const db = new EventsDb(join(dir, "events.db"));
  const store = new Store(); const link = new AgentLink("lab", `http://127.0.0.1:${port}`, "t");
  cleanup = async () => { link.stop(); srv.closeAllConnections(); await new Promise(r => srv.close(r)); db.close(); rmSync(dir, { recursive: true, force: true }); };
  link.start(store, db);
  return { store, db, link };
}

describe("agent link wire and retries", () => {
  it("parses a message split mid-line across chunks and a multi-line data field", async () => {
    const { db } = await rawAgent((req, res) => {
      if (req.url === "/v1/state") return void res.end(agentState);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(': ping\n\ndata: {"type":"ev');
      setTimeout(() => res.write(`ent",\ndata: "event":{"at":"${T}","server":"lab","source":"s","kind":"restart","summary":"split ok"}}\r\n\n`), 30);
    });
    await vi.waitFor(() => expect(db.recent(5).map(e => e.summary)).toContain("split ok"), { timeout: 2000 });
  });
  it("drops a stream that sends over 1 MiB without a complete message", async () => {
    const { store } = await rawAgent((req, res) => {
      if (req.url === "/v1/state") return void res.end(agentState);
      res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: " + "x".repeat((1 << 20) + 10));
    });
    await vi.waitFor(() => expect(logged()).toContain("agent lab: stream message exceeds 1 MiB"), { timeout: 3000 });
    expect(store.snapshot().servers.lab.reachable).toBe(false);
  });
  it("backoff doubles from 1 s and caps at 30 s with the jitter inside the cap", () => {
    expect([0, 1, 2, 3].map(a => backoffMs(a, () => 0.5))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(4, () => 1)).toBeCloseTo(19_200); expect(backoffMs(4, () => 0)).toBeCloseTo(12_800);
    for (let a = 0; a < 64; a++) expect(backoffMs(a, () => 1)).toBeLessThanOrEqual(30_000);
  });
  it("backs off longer after each failure and resets after a good connection", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // no jitter: 1 s, 2 s, then 1 s again
    const states: number[] = []; let streamEnd = 0;
    await rawAgent((req, res) => {
      if (req.url === "/v1/state") {
        states.push(Date.now());
        if (states.length === 3) return void res.end(agentState);
        res.statusCode = 500; return void res.end();
      }
      res.writeHead(200, { "content-type": "text/event-stream" }); res.end(); streamEnd = Date.now(); // a good connection that then closes
    });
    await vi.waitFor(() => expect(states).toHaveLength(4), { timeout: 8000, interval: 20 });
    const gaps = [states[1]! - states[0]!, states[2]! - states[1]!, states[3]! - streamEnd];
    expect(gaps[0]).toBeGreaterThanOrEqual(950); expect(gaps[0]).toBeLessThan(1600);
    expect(gaps[1]).toBeGreaterThanOrEqual(1950); expect(gaps[1]).toBeLessThan(2600);
    expect(gaps[2]).toBeGreaterThanOrEqual(950); expect(gaps[2]).toBeLessThan(1600);
    expect(logged().filter(l => l === "agent lab: /v1/state: HTTP 500")).toHaveLength(3); // tries 1, 2 and 4
  }, 10_000);
  it("stop() during the backoff ends the loop", async () => {
    let calls = 0;
    const { link } = await rawAgent((_req, res) => { calls++; res.statusCode = 500; res.end(); });
    await vi.waitFor(() => expect(calls).toBe(1), { timeout: 2000 });
    await new Promise(r => setTimeout(r, 100)); link.stop();
    await new Promise(r => setTimeout(r, 1500)); expect(calls).toBe(1);
  });
  it("a quick stop() and start() leaves one loop", async () => {
    let calls = 0;
    const { link, store, db } = await rawAgent((_req, res) => { calls++; res.statusCode = 500; res.end(); });
    await vi.waitFor(() => expect(calls).toBe(1), { timeout: 2000 });
    link.stop(); link.start(store, db);
    await vi.waitFor(() => expect(calls).toBe(2), { timeout: 2000 });
    await new Promise(r => setTimeout(r, 700)); expect(calls).toBe(2); // one loop: its next try is ~1 s later
  });
  it("a failing event log neither drops the session nor escapes the loop", async () => {
    const { store, db } = await rawAgent((req, res) => {
      if (req.url === "/v1/state") return void res.end(agentState);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: {"type":"event","event":{"at":"${T}","server":"lab","source":"s","kind":"restart","summary":"x"}}\n\n`);
    });
    vi.spyOn(db, "add").mockImplementation(() => { throw new Error("disk full"); });
    await vi.waitFor(() => expect(logged()).toContain("events db: disk full"), { timeout: 2000 });
    expect(store.snapshot().servers.lab.reachable).toBe(true);
  });
});


// a throwaway CA and a 127.0.0.1 leaf, generated per run so no key is ever committed
function tlsPair() {
  const d = mkdtempSync(join(tmpdir(), "tls-")); const o = (...a: string[]) => execFileSync("openssl", a, { cwd: d, stdio: "ignore" });
  o("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-days", "1", "-subj", "/CN=test-ca");
  o("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "srv.key", "-out", "srv.csr", "-subj", "/CN=127.0.0.1");
  writeFileSync(join(d, "ext"), "subjectAltName=IP:127.0.0.1\n");
  o("x509", "-req", "-in", "srv.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "srv.crt", "-days", "1", "-extfile", "ext");
  const r = (f: string) => readFileSync(join(d, f)); const out = { ca: r("ca.crt"), cert: r("srv.crt").toString(), key: r("srv.key").toString() };
  rmSync(d, { recursive: true, force: true }); return out;
}
const hasOpenssl = (() => { try { execFileSync("openssl", ["version"], { stdio: "ignore" }); return true; } catch { return false; } })();

describe.skipIf(!hasOpenssl)("agent link over TLS", () => {
  it("trusts the agent only through the given CA", async () => {
    const { ca, cert, key } = tlsPair();
    const reg = new Registry("lab", [fake]); await reg.runOnce("fake");
    const app = buildServer(reg, "s3cret", { https: { cert, key } }); app.log.level = "silent";
    await app.listen({ port: 0, host: "127.0.0.1" }); const port = (app.server.address() as { port: number }).port;
    const dir = mkdtempSync(join(tmpdir(), "center-")); const db = new EventsDb(join(dir, "events.db"));
    const trusted = new Store(), untrusted = new Store();
    const good = new AgentLink("lab", `https://127.0.0.1:${port}`, "s3cret", ca), bad = new AgentLink("lab", `https://127.0.0.1:${port}`, "s3cret");
    cleanup = async () => { good.stop(); bad.stop(); await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); };
    good.start(trusted, db); bad.start(untrusted, db);
    await vi.waitFor(() => expect(trusted.snapshot().servers.lab.reachable).toBe(true), { timeout: 5000 });
    // the untrusted link did try, and failed on the certificate
    await vi.waitFor(() => expect(logged().some(l => /^agent lab: fetch failed: .*certificate/.test(l))).toBe(true), { timeout: 5000 });
    expect(untrusted.snapshot().entities).toEqual([]); expect(untrusted.snapshot().servers.lab.reachable).toBe(false);
  }, 15_000);
});
