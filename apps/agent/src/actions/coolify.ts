import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Action, Entity } from "@hetops-control/contracts";
import type { CoolifyReader } from "../sources/coolify.js";
import { json } from "../sources/http.js";

/** The deploy-only token (Coolify Keys & Tokens, ability "deploy"): it can queue a deploy and cannot read anything. */
export interface CoolifyDeployer { deploy(uuid: string, signal?: AbortSignal): Promise<any> }
export const realCoolifyDeployer = (base: string, tokenFile: string): CoolifyDeployer => ({
  deploy: (uuid, signal) => json(`${base}/api/v1/deploy?uuid=${encodeURIComponent(uuid)}&force=false`,
    { method: "POST", headers: { accept: "application/json", authorization: `Bearer ${readFileSync(tokenFile, "utf8").trim()}` }, ...(signal ? { signal } : {}) }),
});

const Params = z.object({}).strict();
const uuidOf = (e: Entity) => { const u = e.id.slice(e.id.lastIndexOf("/") + 1); if (!/^[a-z0-9]{8,64}$/.test(u)) throw new Error("not a Coolify application id"); return u; };
const ACTIVE = new Set(["queued", "in_progress"]);

export function coolifyRedeploy(reader: CoolifyReader, deployer: CoolifyDeployer): Action<z.infer<typeof Params>> {
  const active = async (uuid: string, signal: AbortSignal) => {
    const [d] = (await reader.deployments(uuid, 1, signal)) ?? [];
    return d && ACTIVE.has(String(d.status)) ? d : undefined;
  };
  return {
    id: "coolify.redeploy", label: "Redeploy", targets: ["app"], risk: "safe",
    description: "Asks Coolify to build and deploy the application again from its branch, as its Redeploy button does (the build cache is kept).",
    params: Params, applies: e => e.source === "coolify",
    async preview(t, _p, ctx) {
      const busy = await active(uuidOf(t), ctx.signal), f = t.facts;
      const from = f.repository?.value ? `${f.repository.value}${f.branch?.value ? ` (${f.branch.value})` : ""}` : "its source";
      return `Builds ${t.name} from ${from} and replaces the running container when the build finishes, about ${f.lastDeployDuration?.value ?? "?"} s like the last deploy.`
        + (f.undeployedCommit?.value ? ` That includes ${String(f.undeployedCommit.value).slice(0, 7)}, which is waiting.` : "")
        + (busy ? ` A deploy is already ${busy.status === "queued" ? "queued" : "running"}, so this returns it instead of starting another.` : "");
    },
    async run(t, _p, ctx) {
      const uuid = uuidOf(t), busy = await active(uuid, ctx.signal);
      if (busy) return { ok: true, already: true, ref: String(busy.deployment_uuid), summary: `a deploy of ${t.name} is already ${busy.status === "queued" ? "queued" : "running"}` };
      const r = await deployer.deploy(uuid, ctx.signal), d = r?.deployments?.[0];
      if (typeof d?.deployment_uuid !== "string") throw new Error(`Coolify did not queue a deployment: ${String(d?.message ?? r?.message ?? "no answer").slice(0, 160)}`);
      return { ok: true, ref: d.deployment_uuid, summary: `deploy of ${t.name} queued; the Apps page shows it when it finishes` };
    },
  };
}
