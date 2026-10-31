import Fastify from "fastify";
import type { Registry } from "./registry.js";
import { bearerOk } from "./auth.js";
import type { Runner } from "./actions/index.js";

export function buildServer(reg: Registry, token: string, opts: { https?: { cert: string; key: string }; run?: Runner } = {}) {
  if (!token) throw new Error("agent token must not be empty");
  const app = Fastify({ forceCloseConnections: true, logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization"] }, ...(opts.https ? { https: opts.https } : {}) });
  app.get("/healthz", async () => ({ ok: true }));
  app.addHook("onRequest", async (req, rep) => {
    if (req.url !== "/healthz" && !bearerOk(req.headers.authorization, token)) return rep.code(401).send({ error: "unauthorized" });
  });
  app.get("/v1/state", async () => reg.state());
  // the allow-listed verbs; bodies are small (a target, a few params)
  const act = (mode: "preview" | "run") => async (req: { params: unknown; body: unknown; log: { info(o: object, m: string): void } }, rep: { code(n: number): { send(b: unknown): unknown } }) => {
    const id = (req.params as { id: string }).id;
    if (!opts.run) return rep.code(404).send({ error: "this agent offers no actions" });
    const out = await opts.run(id, req.body, mode);
    const b = req.body as { target?: unknown; actor?: unknown } | undefined;
    if (mode === "run") req.log.info({ action: id, target: b?.target, actor: b?.actor, code: out.code, ok: (out.body as { ok?: unknown })?.ok }, "action");
    return rep.code(out.code).send(out.body);
  };
  app.post("/v1/actions/:id", { bodyLimit: 16_384 }, act("run"));
  app.post("/v1/actions/:id/preview", { bodyLimit: 16_384 }, act("preview"));
  const streams = new Set<() => void>();
  // preClose runs before the HTTP server waits for open connections; onClose would run only after they had gone
  app.addHook("preClose", async () => { for (const end of [...streams]) end(); });
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
    req.raw.on("close", done); rep.raw.on("close", done);
  });
  return app;
}
