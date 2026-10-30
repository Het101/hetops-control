import Fastify from "fastify";
import type { Registry } from "./registry.js";
import { bearerOk } from "./auth.js";

export function buildServer(reg: Registry, token: string, opts: { https?: { cert: string; key: string } } = {}) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization"] }, ...(opts.https ? { https: opts.https } : {}) });
  app.get("/healthz", async () => ({ ok: true }));
  app.addHook("onRequest", async (req, rep) => {
    if (req.url !== "/healthz" && !bearerOk(req.headers.authorization, token)) return rep.code(401).send({ error: "unauthorized" });
  });
  app.get("/v1/state", async () => reg.state());
  const streams = new Set<() => void>();
  app.addHook("onClose", async () => { for (const end of [...streams]) end(); }); // lets app.close() finish
  app.get("/v1/stream", (req, rep) => {
    rep.hijack(); // we own the raw response from here
    rep.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const send = (m: unknown) => rep.raw.write(`data: ${JSON.stringify(m)}\n\n`);
    send({ type: "state", state: reg.state() });
    const off = reg.on(send);
    const ping = setInterval(() => rep.raw.write(": ping\n\n"), 15_000);
    const done = () => { off(); clearInterval(ping); streams.delete(end); };
    const end = () => { done(); rep.raw.end(); };
    streams.add(end);
    req.raw.on("close", done);
  });
  return app;
}
