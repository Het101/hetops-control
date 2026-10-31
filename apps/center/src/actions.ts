import { ActionCallSchema, ActionPreviewSchema, ActionResultSchema, checkParams, ServerIdSchema,
  type Ack, type ActionDescriptor, type ActionResult, type ActionRun, type CenterState, type Entity, type Event, type Params, type ServerId } from "@hetops-control/contracts";
import type { EventsDb } from "./events-db.js";
import type { Store } from "./store.js";
import { headline, type Headline } from "./headline.js";

export class ActionError extends Error { constructor(public code: number, message: string, public retryAfter?: number) { super(message); } }
export type AgentCall = (server: ServerId, path: string, body: unknown, signal: AbortSignal) => Promise<{ status: number; body: unknown }>;
/** An action the center runs itself (only gatus.ack): it changes the center's own records, never a server. */
export type LocalAction = { descriptor: ActionDescriptor; applies(e: Entity): boolean;
  preview(t: Entity, p: Params, now: Date): string; run(t: Entity, p: Params, ctx: { actor: string; now: Date }): ActionResult };

export const TIMEOUT_MS = 60_000;
export const LIMITS = { target: { max: 3, ms: 600_000 }, action: { max: 12, ms: 600_000 }, preview: { max: 60, ms: 60_000 } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Adds the center's own offers and the live acks to a snapshot; an ack lapses at `until` or when its entity's status moves. */
export function decorate(s: CenterState, acks: Ack[], local: LocalAction[], now: number): CenterState {
  const live = acks.filter(a => Date.parse(a.until) > now && s.entities.some(e => e.id === a.entity && e.status === a.status));
  const acked = new Set(live.map(a => a.entity));
  const entities = s.entities.map(e => {
    const refs = acked.has(e.id) ? [] : local.filter(l => l.descriptor.targets.includes(e.kind) && l.applies(e))
      .map(l => ({ id: l.descriptor.id, label: l.descriptor.label, risk: l.descriptor.risk }));
    return refs.length ? { ...e, actions: [...e.actions, ...refs] } : e;
  });
  const mine = ServerIdSchema.options.flatMap(server => local.map(l => ({ ...l.descriptor, server })));
  return { ...s, entities, acks: live, actions: [...(s.actions ?? []), ...mine] };
}
export const centerState = (store: Store, db: Pick<EventsDb, "acks">, local: LocalAction[], now = Date.now()): CenterState & { headline: Headline } => {
  const s = decorate(store.snapshot(), db.acks(new Date(now).toISOString()), local, now);
  return { ...s, headline: headline(s) };
};

/** Sliding windows in memory: a restart forgets them, which only ever loosens a limit for one window. */
class Windows {
  private hits = new Map<string, number[]>();
  wait(key: string, max: number, ms: number, now: number): number {
    const h = (this.hits.get(key) ?? []).filter(t => now - t < ms); this.hits.set(key, h);
    return h.length < max ? 0 : Math.max(1, Math.ceil((h[0]! + ms - now) / 1000));
  }
  hit(key: string, now: number) { this.hits.get(key)!.push(now); }
}
const errorOf = (r: { status: number; body: unknown }) => {
  const e = (r.body as { error?: unknown } | undefined)?.error;
  return typeof e === "string" ? e.slice(0, 300) : `the agent answered HTTP ${r.status}`;
};
const said = (p: Params) => { const kv = Object.entries(p).filter(([, v]) => v !== "").map(([k, v]) => `${k} ${typeof v === "string" ? JSON.stringify(v) : v}`); return kv.length ? ` with ${kv.join(", ")}`.slice(0, 120) : ""; };

type Deps = { state: () => CenterState; db: Pick<EventsDb, "add" | "addRun" | "finishRun" | "run">; call: AgentCall; local: LocalAction[];
  publish: (m: { run?: ActionRun; event?: Event }) => void; actors: string[]; now?: () => Date; timeoutMs?: number; limits?: typeof LIMITS };

export class Actions {
  private inflight = new Set<string>(); private windows = new Windows();
  private now: () => Date; private timeoutMs: number; private limits: typeof LIMITS; private actors: Set<string>;
  constructor(private o: Deps) {
    this.now = o.now ?? (() => new Date()); this.timeoutMs = o.timeoutMs ?? TIMEOUT_MS; this.limits = o.limits ?? LIMITS;
    this.actors = new Set(o.actors.map(a => a.trim().toLowerCase()).filter(Boolean));
  }

  /** Everything checked before any agent is asked: identity, body, target, reachability, the offer, the params. */
  private resolve(raw: unknown, actor: string) {
    if (!this.actors.has(actor.toLowerCase())) throw new ActionError(403, "this identity may not act");
    const c = ActionCallSchema.safeParse(raw);
    if (!c.success) throw new ActionError(400, "bad request");
    const s = this.o.state();
    const target = s.entities.find(e => e.id === c.data.target);
    if (!target) throw new ActionError(404, "no such target");
    if (!s.servers[target.server].reachable) throw new ActionError(409, `${target.server} is not reachable; nothing was asked`);
    const ref = target.actions.find(r => r.id === c.data.action);
    if (!ref) throw new ActionError(422, `${c.data.action} is not offered for ${target.name}`);
    const local = this.o.local.find(l => l.descriptor.id === ref.id);
    const d = local?.descriptor ?? s.actions?.find(a => a.server === target.server && a.id === ref.id);
    if (!d) throw new ActionError(422, `${target.server}'s agent does not describe ${ref.id}`);
    const p = checkParams(d.params, c.data.params);
    if (!p.ok) throw new ActionError(422, p.error);
    return { call: c.data, target, d, params: p.params, local };
  }

  async preview(raw: unknown, actor: string): Promise<{ text: string }> {
    const r = this.resolve(raw, actor), now = this.now().getTime(), L = this.limits.preview;
    const retry = this.windows.wait("preview", L.max, L.ms, now);
    if (retry) throw new ActionError(429, `too many previews; try again in ${retry} s`, retry);
    this.windows.hit("preview", now);
    if (r.local) return { text: r.local.preview(r.target, r.params, this.now()) };
    const res = await this.o.call(r.target.server, `/v1/actions/${encodeURIComponent(r.d.id)}/preview`,
      { target: r.target.id, params: r.params, actor, requestId: crypto.randomUUID() }, AbortSignal.timeout(this.timeoutMs));
    const body = ActionPreviewSchema.safeParse(res.body);
    if (res.status !== 200 || !body.success) throw new ActionError(502, errorOf(res));
    return body.data;
  }

  /** Validates, audits and starts; the result follows on the stream. A repeated key returns the recorded run. */
  start(raw: unknown, actor: string, key: string | undefined): { run: ActionRun; replay: boolean } {
    if (!key || !UUID.test(key)) throw new ActionError(400, "an Idempotency-Key (a UUID) is required");
    // a retry is answered from the audit before anything else, so a network retry never turns into a misleading 404, 409 or 403
    // because the target, its server or ACTORS changed since; it acts on nothing, and it must be the same caller's same request
    const earlier = this.o.db.run(key.toLowerCase());
    if (earlier) {
      const c = ActionCallSchema.safeParse(raw);
      if (!c.success) throw new ActionError(400, "bad request");
      if (earlier.actor.toLowerCase() !== actor.toLowerCase() || earlier.action !== c.data.action || earlier.target !== c.data.target)
        throw new ActionError(409, "that Idempotency-Key belongs to another request");
      return { run: earlier, replay: true };
    }
    const r = this.resolve(raw, actor);
    if (r.d.risk === "disruptive" && r.call.confirm !== r.target.name) throw new ActionError(422, `type ${r.target.name} to confirm`);
    if (this.inflight.has(r.target.id)) throw new ActionError(409, `an action on ${r.target.name} is still running`);
    const now = this.now().getTime(), kT = `${r.d.id}|${r.target.id}`, kA = r.d.id;
    const retry = Math.max(this.windows.wait(kT, this.limits.target.max, this.limits.target.ms, now), this.windows.wait(kA, this.limits.action.max, this.limits.action.ms, now));
    if (retry) throw new ActionError(429, `rate limited; try again in ${retry} s`, retry);
    this.windows.hit(kT, now); this.windows.hit(kA, now);
    const run: ActionRun = { id: key.toLowerCase(), action: r.d.id, label: r.d.label, server: r.target.server, target: r.target.id, targetName: r.target.name,
      actor, params: r.params, state: "running", at: new Date(now).toISOString() };
    if (!this.o.db.addRun(run)) return { run: this.o.db.run(run.id)!, replay: true };   // the same key raced in
    this.say(run, `${actor} asked: ${run.label.toLowerCase()} ${run.targetName} (${run.server})${said(run.params)}`);
    this.inflight.add(run.target);
    void this.execute(run, r.local).finally(() => this.inflight.delete(run.target));
    return { run, replay: false };
  }

  private async execute(run: ActionRun, local: LocalAction | undefined) {
    let result: ActionResult | undefined, error: string | undefined;
    try {
      if (local) {
        const target = this.o.state().entities.find(e => e.id === run.target);
        if (!target) throw new Error(`${run.targetName} is gone`);
        result = local.run(target, run.params, { actor: run.actor, now: this.now() });
      } else {
        const res = await this.o.call(run.server, `/v1/actions/${encodeURIComponent(run.action)}`,
          { target: run.target, params: run.params, actor: run.actor, requestId: run.id }, AbortSignal.timeout(this.timeoutMs));
        const body = ActionResultSchema.safeParse(res.body);
        if (res.status === 200 && body.success) result = body.data; else error = errorOf(res);
      }
    } catch (e) {
      error = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
        ? `no answer in ${this.timeoutMs / 1000} s; the result is unknown, check ${run.targetName}` : (e instanceof Error ? e.message : String(e)).slice(0, 300);
    }
    const ok = !!result?.ok;
    const done: ActionRun = { ...run, state: ok ? "succeeded" : "failed", finishedAt: this.now().toISOString(),
      ...(result ? { result } : {}), ...(error ? { error } : !ok && result ? { error: result.summary } : {}) };
    try { this.o.db.finishRun(done); } catch (e) { console.error(`audit: ${e instanceof Error ? e.message : String(e)}`); }
    this.say(done, `${run.label.toLowerCase()} ${run.targetName} (${run.server}): ${result?.summary ?? error}`, ok ? undefined : "attention");
  }

  private say(run: ActionRun, summary: string, level?: "attention") {
    const event: Event = { at: this.now().toISOString(), server: run.server, source: "control", kind: "action", actor: run.actor, entity: run.target,
      summary: summary.slice(0, 300), ...(level ? { level } : {}) };
    try { this.o.db.add(event); } catch (e) { console.error(`events db: ${e instanceof Error ? e.message : String(e)}`); }
    this.o.publish({ run, event });
  }
}
