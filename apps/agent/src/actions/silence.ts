import { z } from "zod";
import type { Action, Entity } from "@hetops-control/contracts";
import { json } from "../sources/http.js";

// Alertmanager's API v2 (kps-kube-prometheus-stack-alertmanager.monitoring:9093). It has no auth of its own; the NetworkPolicy-free
// monitoring namespace already lets the agent in for the alerts source. Every call takes the run's signal (the 55 s limit).
export interface Silences { alerts(signal?: AbortSignal): Promise<any[]>; list(signal?: AbortSignal): Promise<any[]>; create(s: object, signal?: AbortSignal): Promise<any> }
export const realSilences = (base: string): Silences => ({
  alerts: signal => json(`${base}/api/v2/alerts?active=true`, signal && { signal }),   // silenced ones too: the alert may already be muted
  list: signal => json(`${base}/api/v2/silences`, signal && { signal }),
  create: (s, signal) => json(`${base}/api/v2/silences`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s), ...(signal ? { signal } : {}) }),
});

const Params = z.object({
  hours: z.enum(["1", "4", "12", "24", "72"]).default("4").describe("For how long, in hours"),
  note: z.string().max(200).optional().describe("Why (kept with the silence in Alertmanager)"),
}).strict();
const HOUR = 3_600_000;
const tag = (key: string) => `[hetops-control ${key}]`;
const hhmm = (at: Date | string) => `${new Date(at).toISOString().slice(11, 16)} UTC`;
const matchers = (labels: Record<string, unknown>) => Object.keys(labels).sort().map(name => ({ name, value: String(labels[name]), isRegex: false, isEqual: true }));

export function alertSilence(api: Silences): Action<z.infer<typeof Params>> {
  const firing = async (e: Entity, signal: AbortSignal) => {
    const fp = e.id.slice(e.id.lastIndexOf("/") + 1);
    const a = (await api.alerts(signal)).find(x => x?.fingerprint === fp);
    if (!a?.labels || typeof a.labels !== "object") throw new Error(`${e.name} is no longer firing`);
    return a.labels as Record<string, unknown>;
  };
  return {
    id: "alert.silence", label: "Silence", targets: ["alert"], risk: "safe",
    description: "Silences exactly this alert in Alertmanager for a set time: it keeps being evaluated, and notifications stop until the silence ends.",
    params: Params, applies: e => e.source === "alertmanager",
    async preview(t, p, ctx) {
      const m = matchers(await firing(t, ctx.signal)).map(x => `${x.name}="${x.value}"`).join(", ");
      const end = new Date(ctx.now().getTime() + Number(p.hours) * HOUR);
      return `Creates a silence in the ${t.server} Alertmanager for ${p.hours} h, until ${hhmm(end)}, matching exactly {${m}}. `
        + "Only this alert is muted; an alert with any other label still notifies.";
    },
    async run(t, p, ctx) {
      const mine = (await api.list(ctx.signal)).find(s => s?.status?.state === "active" && String(s.comment ?? "").includes(tag(ctx.requestId)));
      if (mine) return { ok: true, already: true, ref: String(mine.id), summary: `already silenced until ${hhmm(mine.endsAt)}` };
      const labels = await firing(t, ctx.signal), start = ctx.now(), end = new Date(start.getTime() + Number(p.hours) * HOUR);
      const r = await api.create({ matchers: matchers(labels), startsAt: start.toISOString(), endsAt: end.toISOString(), createdBy: ctx.actor,
        comment: `${p.note?.trim() || "Silenced from HetOps Control"} ${tag(ctx.requestId)}` }, ctx.signal);
      if (typeof r?.silenceID !== "string") throw new Error("Alertmanager did not return a silence id");
      return { ok: true, ref: r.silenceID, summary: `${t.name} silenced for ${p.hours} h, until ${hhmm(end)}` };
    },
  };
}
