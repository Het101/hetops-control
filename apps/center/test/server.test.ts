import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Store } from "../src/store.js";
import { buildCenter } from "../src/server.js";
import { accessConfig } from "../src/config.js";

const ok = async () => ({ email: "t@x.dev" }); const no = async () => { throw new Error("nope"); };
const mk = (access: (jwt?: string) => Promise<{ email: string }>, webRoot = "/does/not/exist", recent = vi.fn(() => [])) => {
  const store = new Store(); const app = buildCenter({ store, db: { recent } as never, access, webRoot, logger: false }); return { app, store, recent };
};
const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); });

describe("center http", () => {
  it("rejects without Access, healthz stays open", async () => {
    const { app } = mk(no); apps.push(app);
    const r = await app.inject("/api/state"); expect(r.statusCode).toBe(403); expect(r.json()).toEqual({ error: "forbidden" });
    expect((await app.inject("/healthz")).statusCode).toBe(200);
  });
  it("serves state with a headline, reads the cookie too", async () => {
    const seen: (string | undefined)[] = []; const { app } = mk(async (j?: string) => { seen.push(j); return { email: "a@b.c" }; }); apps.push(app);
    const r = await app.inject({ url: "/api/state", headers: { cookie: "x=1; CF_Authorization=tok" } });
    expect(r.statusCode).toBe(200); expect(r.json().headline.title).toBeTypeOf("string"); expect(seen).toEqual(["tok"]);
    await app.inject({ url: "/api/state", headers: { "cf-access-jwt-assertion": "hdr" } }); expect(seen[1]).toBe("hdr");
  });
  it("/api/me returns the Access email and the build", async () => {
    const store = new Store(); const app = buildCenter({ store, db: { recent: () => [] } as never, access: async () => ({ email: "het@x.dev" }), webRoot: "/nope", version: "abc123", logger: false }); apps.push(app);
    expect((await app.inject("/api/me")).json()).toEqual({ email: "het@x.dev", version: "abc123" });
    const { app: b } = mk(ok); apps.push(b); expect((await b.inject("/api/me")).json()).toEqual({ email: "t@x.dev", version: "dev" });
    const { app: c } = mk(no); apps.push(c); expect((await c.inject("/api/me")).statusCode).toBe(403);
  });
  it("caps events limit at 500", async () => {
    const { app, recent } = mk(ok); apps.push(app);
    await app.inject("/api/events?limit=9999"); expect(recent).toHaveBeenLastCalledWith(500);
    await app.inject("/api/events?limit=-3"); expect(recent).toHaveBeenLastCalledWith(1);
    await app.inject("/api/events"); expect(recent).toHaveBeenLastCalledWith(50);
    await app.inject("/api/events?limit=abc"); expect(recent).toHaveBeenLastCalledWith(50);
  });
  it("/api/series returns series by id, lists missing ones, and caps the request", async () => {
    const { app, store } = mk(ok); apps.push(app); const now = new Date().toISOString();
    const series = (id: string) => ({ id, server: "lab" as const, label: id, unit: "docs", stepMs: 600_000, points: [[1, 2], [2, 3]] as [number, number][], observedAt: now, source: "s" });
    store.apply("lab", { server: "lab", version: "1", generatedAt: now, sources: [{ id: "s", periodMs: 60_000, ok: true, lastRunAt: now }], entities: [], series: [series("lab/a"), series("lab/b")] });
    const r = (await app.inject("/api/series?id=lab/a&id=lab/x&id=lab/a")).json();
    expect(r.series.map((x: { id: string }) => x.id)).toEqual(["lab/a"]); expect(r.missing).toEqual(["lab/x"]); expect(r.series[0].points).toEqual([[1, 2], [2, 3]]);
    expect((await app.inject("/api/series")).statusCode).toBe(400);
    expect((await app.inject(`/api/series?${Array.from({ length: 17 }, (_, i) => `id=${i}`).join("&")}`)).statusCode).toBe(400);
    expect((await app.inject(`/api/series?id=${"x".repeat(129)}`)).statusCode).toBe(400);
    store.markUnreachable("lab", new Date()); expect((await app.inject("/api/series?id=lab/a")).json().missing).toEqual(["lab/a"]);
  });
  it("503 when the web build is missing, static + index fallback when present", async () => {
    const a = mk(ok); apps.push(a.app); expect((await a.app.inject("/")).statusCode).toBe(503);
    const dir = mkdtempSync(join(tmpdir(), "web-")); writeFileSync(join(dir, "index.html"), "<p>hi</p>"); writeFileSync(join(dir, "a.js"), "1");
    const b = mk(ok, dir); apps.push(b.app);
    expect((await b.app.inject("/a.js")).body).toBe("1"); expect((await b.app.inject("/deep/route")).body).toBe("<p>hi</p>");
    expect((await b.app.inject("/api/nothing")).statusCode).toBe(404);
    const api = await b.app.inject("/api"); expect(api.statusCode).toBe(404); expect(api.json()).toEqual({ error: "not found" });
    expect((await b.app.inject({ method: "HEAD", url: "/deep/route" })).statusCode).toBe(200);
  });
  it("hashed assets are cached for a year, index.html is revalidated on every load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "web-")); writeFileSync(join(dir, "index.html"), "<p>hi</p>");
    mkdirSync(join(dir, "assets")); writeFileSync(join(dir, "assets", "fraunces-latin-opsz-normal-DihXLNYH.woff2"), "w");
    const b = mk(ok, dir); apps.push(b.app);
    const font = await b.app.inject("/assets/fraunces-latin-opsz-normal-DihXLNYH.woff2");
    expect(font.statusCode).toBe(200); expect(font.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    for (const u of ["/", "/index.html", "/deep/route"]) expect((await b.app.inject(u)).headers["cache-control"], u).toBe("no-cache");
  });
  it("streams state on connect and events, and closes cleanly", async () => {
    const { app, store } = mk(ok); await app.listen({ port: 0, host: "127.0.0.1" });
    const res = await fetch(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/stream`);
    const rd = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
    const until = async (s: string) => { while (!buf.includes(s)) { const { value, done } = await rd.read(); if (done) throw new Error("ended"); buf += dec.decode(value); } };
    await until('"type":"state"');
    store.record({ at: "2026-10-30T00:00:00.000Z", server: "lab", source: "k", kind: "restart", summary: "job pod restarted" });
    await until('"type":"event"');
    store.markUnreachable("lab", new Date()); store.apply("lab", { server: "lab", version: "1", generatedAt: new Date().toISOString(), sources: [], entities: [] });
    await app.close(); // preClose must end the stream or this hangs
  });
});

describe("dev mode", () => {
  it("is refused unless HOST is 127.0.0.1", () => {
    expect(() => accessConfig({ CONTROL_DEV: "1", HOST: "0.0.0.0" })).toThrow(/CONTROL_DEV/);
    expect(() => accessConfig({ CONTROL_DEV: "1" })).toThrow(/CONTROL_DEV/);
    expect(accessConfig({ CONTROL_DEV: "1", HOST: "127.0.0.1" })).toEqual({ dev: true });
    expect(accessConfig({ ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "a" })).toEqual({ dev: false, teamDomain: "t.cloudflareaccess.com", aud: "a" });
    expect(() => accessConfig({})).toThrow(/ACCESS_/);
  });
});
