import { ActionPreviewSchema, ActionRunSchema, type ActionDescriptor, type ActionRun, type Entity, type Params, type ParamsJson, type ServerId } from "@hetops-control/contracts";

export type Descriptor = ActionDescriptor & { server: ServerId };
export type Offer = { ref: Entity["actions"][number]; descriptor: Descriptor };
/** An action is pressable when the entity offers it and its own server describes it (an older agent may offer neither). */
export function offer(e: Entity, id: string | undefined, list: Descriptor[]): Offer | undefined {
  const ref = id ? e.actions.find(r => r.id === id) : e.actions[0];
  const descriptor = ref && list.find(d => d.server === e.server && d.id === ref.id);
  return ref && descriptor ? { ref, descriptor } : undefined;
}

export type Field = { key: string; label: string; help?: string } & ({ kind: "choice"; options: string[] } | { kind: "text"; max: number } | { kind: "number"; min: number; max: number } | { kind: "toggle" });
const words = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, c => c.toUpperCase());
export const fields = (s: ParamsJson): Field[] => Object.entries(s.properties).map(([key, p]) => {
  const base = { key, label: words(key), ...(p.description ? { help: p.description } : {}) };
  if (p.type === "boolean") return { ...base, kind: "toggle" as const };
  if (p.type === "integer") return { ...base, kind: "number" as const, min: p.minimum, max: p.maximum };
  return p.enum ? { ...base, kind: "choice" as const, options: p.enum } : { ...base, kind: "text" as const, max: p.maxLength ?? 200 };
});
export const defaults = (s: ParamsJson): Params => Object.fromEntries(Object.entries(s.properties).flatMap(([k, p]) => (p.default === undefined ? [] : [[k, p.default]])));

// the center wants the page's own Origin (the browser sets it) and this header, which no other site can send without a preflight
async function post(path: string, body: unknown, key?: string): Promise<unknown> {
  const r = await fetch(path, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", accept: "application/json", "x-hetops-action": "1", ...(key ? { "idempotency-key": key } : {}) } });
  const j = await r.json().catch(() => ({})) as { error?: unknown };
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : `HTTP ${r.status}`);
  return j;
}
export const preview = async (e: Entity, action: string, params: Params) => ActionPreviewSchema.parse(await post("/api/actions/preview", { action, target: e.id, params })).text;
export async function start(e: Entity, action: string, params: Params, key: string, confirm?: string): Promise<ActionRun> {
  const j = await post("/api/actions", { action, target: e.id, params, ...(confirm ? { confirm } : {}) }, key) as { run?: unknown };
  return ActionRunSchema.parse(j.run);
}

/** The runs behind the toasts: a new run goes on top, a streamed update replaces its run where it stands (so a toast changes
 *  in place), and a late POST answer (still "running") never undoes a result the stream already brought. */
export function merge(list: ActionRun[], r: ActionRun, keep = 8): ActionRun[] {
  const i = list.findIndex(x => x.id === r.id);
  if (i < 0) return [r, ...list].slice(0, keep);
  if (list[i]!.state !== "running" && r.state === "running") return list;
  return list.map((x, j) => (j === i ? r : x));
}

/** Keeps the head (a snapshot name reads from its start) and the last 6, so `max` characters never wrap. */
export function middle(s: string, max = 34): string {
  if (s.length <= max) return s;
  const tail = Math.min(6, Math.floor((max - 1) / 2));
  return `${s.slice(0, max - 1 - tail)}…${s.slice(-tail)}`;
}

export type Tone = "running" | "done" | "failed";
export type Toast = { tone: Tone; title: string; line: string; detail?: string; ref?: string; refName: string; next?: { href: string; label: string } };
// where a target's kind lives (its id is server/kind/...), and what each action's ref is called
const HOME: Partial<Record<string, { href: string; label: string }>> = { backup: { href: "/backups", label: "Backups" },
  app: { href: "/apps", label: "Apps" }, "argo-app": { href: "/apps", label: "Apps" }, deploy: { href: "/apps", label: "Apps" },
  alert: { href: "/alerts", label: "Alerts" }, site: { href: "/alerts", label: "Alerts" }, check: { href: "/alerts", label: "Alerts" } };
const REF: Partial<Record<string, string>> = { "snapshot.now": "snapshot name", "coolify.redeploy": "deploy id", "alert.silence": "silence id" };
const hhmm = (at: string) => `${new Date(at).toISOString().slice(11, 16)} UTC`;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a run's toast says: the outcome as its title, where and when in one plain line, the id apart. */
export function toastOf(r: ActionRun): Toast {
  const tone: Tone = r.state === "running" ? "running" : r.state === "succeeded" ? "done" : "failed";
  const why = r.error ?? r.result?.summary;
  const next = HOME[r.target.split("/")[1] ?? ""];
  return {
    tone, line: `${r.targetName} on ${r.server} · ${hhmm(r.finishedAt ?? r.at)}`, refName: REF[r.action] ?? "reference",
    // "the result is unknown" (the center's words for a timeout or a restart) is not a failure: say only what is known
    title: tone === "running" ? `${r.label}…` : tone === "done" ? r.result?.summary ?? `${r.label} done`
      : /result is unknown/.test(why ?? "") ? `No answer from ${r.server}` : `${r.label} failed`,
    ...(tone === "failed" && why ? { detail: sentence(why) } : {}), ...(r.result?.ref ? { ref: r.result.ref } : {}), ...(next ? { next } : {}),
  };
}

/** A pausable countdown (a success toast's time on screen): pause holds the time left, resume carries on from it. */
export function countdown(ms: number, done: () => void) {
  let left = ms, since = 0, t: ReturnType<typeof setTimeout> | undefined;
  const resume = () => { if (t !== undefined || left <= 0) return; since = Date.now(); t = setTimeout(() => { left = 0; t = undefined; done(); }, left); };
  const pause = () => { if (t === undefined) return; clearTimeout(t); t = undefined; left -= Date.now() - since; };
  resume();
  return { pause, resume, stop: () => { clearTimeout(t); t = undefined; left = 0; } };
}
