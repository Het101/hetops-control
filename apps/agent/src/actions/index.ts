import { zodToJsonSchema } from "zod-to-json-schema";
import { ActionPreviewSchema, ActionRequestSchema, ActionResultSchema, ParamsJsonSchema, type Action, type ActionDescriptor } from "@hetops-control/contracts";
import type { Registry } from "../registry.js";
import { realEs } from "../sources/elasticsearch.js";
import { realEsOperator, snapshotNow } from "./snapshot.js";

/** The descriptor published in /v1/state: the zod params become JSON Schema, refused if outside the shared subset. */
export const describeAction = (a: Action<any>): ActionDescriptor => ({
  id: a.id, label: a.label, description: a.description, targets: a.targets, risk: a.risk, preview: !!a.preview,
  params: ParamsJsonSchema.parse(zodToJsonSchema(a.params, { target: "jsonSchema7", $refStrategy: "none" })),
});

type Maker = (env: NodeJS.ProcessEnv) => Action<any>;
/** Every verb this agent can offer; Tasks 3-6 add theirs. Which ones run is the deployment's choice (ACTIONS). */
const origin = (v: string) => new URL(v).origin;
export const MAKERS: Record<string, Maker> = {
  "snapshot.now": env => snapshotNow(realEs(origin(need(env, "ES_URL", "snapshot.now")), env.ES_AUTH_DIR ?? "/secrets/es"),
    realEsOperator(origin(need(env, "ES_URL", "snapshot.now")), need(env, "ES_OPERATOR_DIR", "snapshot.now"))),
};
/** Reads a setting an action needs; a missing one stops the agent at start, never at the owner's click. */
export const need = (env: NodeJS.ProcessEnv, key: string, id: string) => { const v = env[key]; if (!v) throw new Error(`${id} needs ${key}`); return v; };

/** The allow-list: ACTIONS names the verbs (comma-separated). Unknown names are an error, not a silent skip. */
export function buildActions(env: NodeJS.ProcessEnv = process.env, make: Record<string, Maker> = MAKERS): Action<any>[] {
  const ids = (env.ACTIONS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return [...new Set(ids)].map(id => {
    const m = make[id];
    if (!m) throw new Error(`unknown action ${id} in ACTIONS`);
    return m(env);
  });
}

export type Runner = (id: string, body: unknown, mode: "preview" | "run") => Promise<{ code: number; body: unknown }>;
const LIMIT_MS = 55_000;   // under the center's 60 s, so the agent's own answer arrives first

/** Validates a request against the live state (the target must exist and offer the action), then previews or runs it. */
export function actionRunner(reg: Registry, actions: Action<any>[], opts: { limitMs?: number } = {}): Runner {
  const limitMs = opts.limitMs ?? LIMIT_MS;
  const busy = new Set<string>();   // targets with a run in flight; released when the run settles, even after a timeout
  return async (id, raw, mode) => {
    const a = actions.find(x => x.id === id);
    if (!a) return { code: 404, body: { error: `no action ${id} on this agent` } };
    const req = ActionRequestSchema.safeParse(raw);
    if (!req.success) return { code: 400, body: { error: "bad request" } };
    const target = reg.state().entities.find(e => e.id === req.data.target);
    if (!target?.actions.some(r => r.id === id)) return { code: 422, body: { error: `${id} is not offered for ${req.data.target}` } };
    const p = a.params.safeParse(req.data.params);
    if (!p.success) return { code: 422, body: { error: `params: ${p.error.issues.map(i => `${i.path.join(".") || "(root)"} ${i.code}`).join("; ")}` } };
    if (mode === "run" && busy.has(target.id)) return { code: 409, body: { error: `an action on ${target.name} is still running` } };
    const ac = new AbortController();
    const ctx = { server: target.server, now: () => new Date(), actor: req.data.actor, requestId: req.data.requestId, signal: ac.signal };
    const work: Promise<unknown> = mode === "preview"
      ? (a.preview ? a.preview(target, p.data, ctx) : Promise.resolve(a.description)).then(text => ActionPreviewSchema.parse({ text }))
      : a.run(target, p.data, ctx).then(r => ActionResultSchema.parse(r));
    if (mode === "run") { busy.add(target.id); void work.then(() => busy.delete(target.id), () => busy.delete(target.id)); }
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new Error(`timed out after ${limitMs / 1000} s; the result is unknown`)); }, limitMs); });
      return { code: 200, body: await Promise.race([work, timeout]) };
    } catch (e) {
      // the message only (the http helper never puts a body or a header in it); a failed run is a result, a failed preview an error
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      return mode === "run" ? { code: 200, body: { ok: false, summary: msg } } : { code: 502, body: { error: msg } };
    } finally { clearTimeout(timer); }
  };
}
