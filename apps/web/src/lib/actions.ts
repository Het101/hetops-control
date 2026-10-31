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
