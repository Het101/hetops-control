import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { Store } from "./store.js";
import type { EventsDb } from "./events-db.js";
import { headline } from "./headline.js";

const DEBOUNCE_MS = 250, PING_MS = 15_000;
const cookieJwt = (c?: string) => c?.split(";").map(p => p.trim()).find(p => p.startsWith("CF_Authorization="))?.slice("CF_Authorization=".length);

export function buildCenter(o: { store: Store; db: Pick<EventsDb, "recent">; access: (jwt: string | undefined) => Promise<{ email: string }>; webRoot: string; version?: string; logger?: false }) {
  const { store, db } = o;
  const app = Fastify({ forceCloseConnections: true, logger: o.logger === false ? false : { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["cf-access-jwt-assertion"]'] } });
  const state = () => { const s = store.snapshot(); return { ...s, headline: headline(s) }; };

  const who = new WeakMap<object, string>(); // the Access email, per request
  app.get("/healthz", async () => ({ ok: true }));
  app.addHook("onRequest", async (req, rep) => {
    if (req.url === "/healthz") return;
    const h = req.headers["cf-access-jwt-assertion"];
    try { who.set(req, (await o.access(typeof h === "string" ? h : cookieJwt(req.headers.cookie))).email); }
    catch (e) { req.log.warn({ failure: e instanceof Error ? e.name : "unknown" }, "access denied"); return rep.code(403).send({ error: "forbidden" }); }
  });

  app.get("/api/state", async () => state());
  app.get("/api/me", async req => ({ email: who.get(req) ?? "", version: o.version ?? "dev" }));
  app.get("/api/events", async req => {
    const n = Number((req.query as { limit?: string }).limit ?? 50);
    return db.recent(Number.isFinite(n) ? Math.min(500, Math.max(1, Math.trunc(n))) : 50);
  });

  const streams = new Set<() => void>();
  // preClose runs before the HTTP server waits for open connections; onClose would run only after they had gone
  app.addHook("preClose", async () => { for (const end of [...streams]) end(); });
  app.get("/api/stream", (req, rep) => {
    rep.hijack();
    rep.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    const send = (m: unknown) => { rep.raw.write(`data: ${JSON.stringify(m)}\n\n`); };
    const sendState = () => send({ type: "state", state: state() });
    let debounce: NodeJS.Timeout | undefined;
    sendState();
    const off = store.on(m => {
      if (m.type === "event") send(m);
      else if (!debounce) debounce = setTimeout(() => { debounce = undefined; sendState(); }, DEBOUNCE_MS);
    });
    // the ping also re-sends the state: readings age into "unknown" with no store change to announce it
    const ping = setInterval(() => { rep.raw.write(": ping\n\n"); sendState(); }, PING_MS);
    const done = () => { off(); clearInterval(ping); clearTimeout(debounce); streams.delete(end); };
    const end = () => { done(); rep.raw.end(); };
    streams.add(end);
    req.raw.on("close", done); rep.raw.on("close", done);
  });

  const spa = (req: { method: string; url: string }) => (req.method === "GET" || req.method === "HEAD") && req.url !== "/api" && !req.url.startsWith("/api/") && !req.url.startsWith("/api?");
  if (existsSync(join(o.webRoot, "index.html"))) {
    void app.register(fastifyStatic, { root: o.webRoot });
    app.setNotFoundHandler((req, rep) => spa(req) ? rep.sendFile("index.html") : rep.code(404).send({ error: "not found" }));
  } else {
    app.setNotFoundHandler((req, rep) => spa(req) ? rep.code(503).type("text/plain").send("web build missing") : rep.code(404).send({ error: "not found" }));
  }
  return app;
}
