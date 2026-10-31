import { z } from "zod";
import type { Action } from "@hetops-control/contracts";
import { basicAuth, type EsReader } from "../sources/elasticsearch.js";
import { json } from "../sources/http.js";

/** The one call control-operator makes (role control_operator: cluster manage_slm). Reads stay with control-reader. */
export interface EsOperator { execute(policy: string): Promise<any> }
export const realEsOperator = (base: string, authDir: string): EsOperator => ({
  execute: policy => json(`${base}/_slm/policy/${encodeURIComponent(policy)}/_execute`, { method: "POST", headers: basicAuth(authDir) }),
});

const Params = z.object({}).strict();
const hhmm = (ms: unknown) => (typeof ms === "number" && Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(11, 16)} UTC` : "its next scheduled time");

export function snapshotNow(reader: EsReader, op: EsOperator): Action<z.infer<typeof Params>> {
  const policy = async (name: string) => {
    const all = await reader.slm();
    const p = all && typeof all === "object" ? (all as Record<string, any>)[name] : undefined;
    if (!p) throw new Error(`no SLM policy ${name}`);
    return p;
  };
  return {
    id: "snapshot.now", label: "Snapshot now", targets: ["backup"], risk: "safe",
    description: "Runs the snapshot policy once, now, exactly as its schedule would.",
    params: Params,
    applies: e => e.source === "snapshots",
    async preview(t) {
      const p = await policy(t.name);
      const indices = (p.policy?.config?.indices ?? []).join(", ") || "every index";
      const busy = p.in_progress?.name ? ` ${p.in_progress.name} is already running, so this returns it instead of starting another.` : "";
      return `Takes a snapshot of ${indices} into the ${p.policy?.repository ?? "policy's"} repository now, as policy ${t.name}. `
        + `The scheduled run at ${hhmm(p.next_execution_millis)} still happens, and retention (${p.policy?.retention?.expire_after ?? "none"}) applies to this one too.${busy}`;
    },
    async run(t) {
      const p = await policy(t.name);
      if (p.in_progress?.name) return { ok: true, already: true, ref: String(p.in_progress.name), summary: `${p.in_progress.name} is already running` };
      const r = await op.execute(t.name);
      if (typeof r?.snapshot_name !== "string") throw new Error("Elasticsearch did not name the snapshot");
      return { ok: true, ref: r.snapshot_name, summary: `${r.snapshot_name} started; the Backups page shows it once it finishes` };
    },
  };
}
