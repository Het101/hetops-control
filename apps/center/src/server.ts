import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import Fastify, { type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import type { Store } from "./store.js";
import type { EventsDb } from "./events-db.js";
import { ActionError, centerState, type Actions, type LocalAction } from "./actions.js";

const DEBOUNCE_MS = 250, PING_MS = 15_000, SERIES_PER_REQUEST = 16;
const cookieJwt = (c?: string) => c?.split(";").map(p => p.trim()).find(p => p.startsWith("CF_Authorization="))?.slice("CF_Authorization=".length);

export function buildCenter(o: { store: Store; db: Pick<EventsDb, "recent" | "acks">; access: (jwt: string | undefined) => Promise<{ email: string }>; webRoot: string;
  version?: string; logger?: false; actions?: Pick<Actions, "start" | "preview">; origin?: string; local?: LocalAction[] }) {
  const { store, db } = o;
  const app = Fastify({ forceCloseConnections: true, logger: o.logger === false ? false : { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["cf-access-jwt-assertion"]'] } });
  const state = () => centerState(store, db, o.local ?? []);

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

  // one or more series by id (?id=a&id=b), from the same aged snapshot as /api/state; ids absent or stale are listed as missing
  app.get("/api/series", async (req, rep) => {
    const q = (req.query as { id?: string | string[] }).id;
    const ids = [...new Set(Array.isArray(q) ? q : q ? [q] : [])];
    if (!ids.length || ids.length > SERIES_PER_REQUEST || ids.some(i => i.length > 128)) return rep.code(400).send({ error: `give 1-${SERIES_PER_REQUEST} ids of at most 128 characters` });
    const s = store.snapshot(); const found = s.series.filter(x => ids.includes(x.id));
    return { generatedAt: s.generatedAt, series: found, missing: ids.filter(i => !found.some(x => x.id === i)) };
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
      if (m.type !== "state") send(m); // events and action runs go out at once
      else if (!debounce) debounce = setTimeout(() => { debounce = undefined; sendState(); }, DEBOUNCE_MS);
    });
    // the ping also re-sends the state: readings age into "unknown" with no store change to announce it
    const ping = setInterval(() => { rep.raw.write(": ping\n\n"); sendState(); }, PING_MS);
    const done = () => { off(); clearInterval(ping); clearTimeout(debounce); streams.delete(end); };
    const end = () => { done(); rep.raw.end(); };
    streams.add(end);
    req.raw.on("close", done); rep.raw.on("close", done);
  });

  // CSRF: the Access cookie is ambient, so a POST must prove it comes from our own page. The Origin must be exactly ours (a sibling
  // *.hetops.dev site is same-site, so SameSite would not stop it); the custom header cannot be sent cross-origin without a
  // preflight, which we never answer; Sec-Fetch-Site, when the browser sends it, must agree. Bodies are JSON only (else 415).
  const fromOurPage = (h: Record<string, string | string[] | undefined>) => !!o.origin && h.origin === o.origin && h["x-hetops-action"] === "1"
    && (h["sec-fetch-site"] === undefined || h["sec-fetch-site"] === "same-origin");
  const failed = (rep: FastifyReply, e: unknown) => {
    if (e instanceof ActionError) { if (e.retryAfter) rep.header("retry-after", String(e.retryAfter)); return rep.code(e.code).send({ error: e.message }); }
    app.log.error({ err: e instanceof Error ? e.message : String(e) }, "action failed"); return rep.code(500).send({ error: "internal error" });
  };
  app.post("/api/actions/preview", { bodyLimit: 16_384 }, async (req, rep) => {
    if (!o.actions || !fromOurPage(req.headers)) return rep.code(403).send({ error: "forbidden" });
    try { return await o.actions.preview(req.body, who.get(req)!); } catch (e) { return failed(rep, e); }
  });
  app.post("/api/actions", { bodyLimit: 16_384 }, async (req, rep) => {
    if (!o.actions || !fromOurPage(req.headers)) return rep.code(403).send({ error: "forbidden" });
    const k = req.headers["idempotency-key"];
    try { const { run, replay } = o.actions.start(req.body, who.get(req)!, typeof k === "string" ? k : undefined); return rep.code(replay ? 200 : 202).send({ run }); }
    catch (e) { return failed(rep, e); }
  });

  const spa = (req: { method: string; url: string }) => (req.method === "GET" || req.method === "HEAD") && req.url !== "/api" && !req.url.startsWith("/api/") && !req.url.startsWith("/api?");
  if (existsSync(join(o.webRoot, "index.html"))) {
    // Vite names everything under assets/ by content hash, so it can be cached for good; index.html (also the SPA fallback)
    // names the current hashes, so the browser must check it on every load
    const forever = (path: string) => relative(o.webRoot, path).split(sep)[0] === "assets";
    void app.register(fastifyStatic, { root: o.webRoot, cacheControl: false,
      setHeaders: (res, path) => res.setHeader("cache-control", forever(path) ? "public, max-age=31536000, immutable" : "no-cache") });
    app.setNotFoundHandler((req, rep) => spa(req) ? rep.sendFile("index.html") : rep.code(404).send({ error: "not found" }));
  } else {
    app.setNotFoundHandler((req, rep) => spa(req) ? rep.code(503).type("text/plain").send("web build missing") : rep.code(404).send({ error: "not found" }));
  }
  return app;
}
