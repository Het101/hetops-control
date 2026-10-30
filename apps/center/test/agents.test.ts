import { describe, it, expect, vi, afterEach } from "vitest"; import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs"; import { execFileSync } from "node:child_process"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { Registry } from "../../agent/src/registry.js"; import { buildServer } from "../../agent/src/server.js";
import { AgentLink } from "../src/agents.js"; import { Store } from "../src/store.js"; import { EventsDb } from "../src/events-db.js";

const fake = { id: "fake", periodMs: 10_000, async collect() {
  return { entities: [{ id: "lab/app/x", kind: "app" as const, server: "lab" as const, name: "x", status: "ok" as const, facts: {}, links: [], actions: [], observedAt: new Date().toISOString() }] }; } };
const restarts = { id: "restarts", periodMs: 10_000, async collect() {
  return { entities: [], events: [{ at: new Date().toISOString(), server: "lab" as const, source: "restarts", kind: "restart" as const, summary: "x restarted" }] }; } };

let cleanup = async () => {};
afterEach(async () => { vi.useRealTimers(); await cleanup(); cleanup = async () => {}; });
async function setup(token = "s3cret") {
  const reg = new Registry("lab", [fake, restarts]); await reg.runOnce("fake");
  const app = buildServer(reg, "s3cret"); app.log.level = "silent";
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), "center-")); const db = new EventsDb(join(dir, "events.db"));
  const store = new Store(); const link = new AgentLink("lab", `http://127.0.0.1:${port}`, token);
  cleanup = async () => { link.stop(); await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); };
  link.start(store, db);
  return { reg, app, store, db };
}

describe("agent link", () => {
  it("fills the store from a real agent, then marks it unreachable when the agent closes", async () => {
    const { app, store, db } = await setup();
    await vi.waitFor(() => expect(store.snapshot().entities.map(e => e.id)).toEqual(["lab/app/x"]), { timeout: 2000 });
    expect(store.snapshot().servers.lab).toMatchObject({ reachable: true, status: "ok" });
    expect(store.snapshot().entities[0]!.source).toBe("fake");
    // the agent's close() waits for live SSE clients (its onClose hook runs too late), so drop them as a dying process would
    const closing = app.close(); app.server.closeAllConnections(); await closing;
    await vi.waitFor(() => expect(store.snapshot().servers.lab.reachable).toBe(false), { timeout: 25_000 });
    expect(db.recent(5)[0]!.summary).toMatch(/^lab unreachable \(agent silent since \d\d:\d\d:\d\d\)$/);
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
    await vi.advanceTimersByTimeAsync(19_000); expect(store.snapshot().servers.lab.reachable).toBe(true);
    await vi.advanceTimersByTimeAsync(1_500); expect(store.snapshot().servers.lab.reachable).toBe(false);
  });
  it("never fills the store with a wrong token", async () => {
    const { store } = await setup("wrong");
    await new Promise(r => setTimeout(r, 300));
    expect(store.snapshot().entities).toEqual([]); expect(store.snapshot().servers.lab.reachable).toBe(false);
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
    cleanup = async () => { good.stop(); bad.stop(); const c = app.close(); app.server.closeAllConnections(); await c; db.close(); rmSync(dir, { recursive: true, force: true }); };
    good.start(trusted, db); bad.start(untrusted, db);
    await vi.waitFor(() => expect(trusted.snapshot().servers.lab.reachable).toBe(true), { timeout: 5000 });
    expect(untrusted.snapshot().entities).toEqual([]);
  }, 15_000);
});
