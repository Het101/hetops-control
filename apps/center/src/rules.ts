import type { Entity, Status } from "@hetops-control/contracts";

/** a backup with no success for this long has failed, whatever its own status says */
export const BACKUP_MAX_AGE_MS = 26 * 3_600_000;

const hhmm = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
const rank: Record<Status, number> = { ok: 0, unknown: 1, attention: 2, down: 3 };

/** The center's own reading of a fresh entity; returns the status it deserves and why, or nothing when the rule is quiet. */
function rule(e: Entity, agentNow: number): { status: Status; reason: string } | undefined {
  const f = e.facts;
  switch (e.kind) {
    case "alert": { // firing is 1 for an active Alertmanager alert; only warning and critical need the owner
      const sev = f.severity?.value; if (Number(f.firing?.value ?? 1) <= 0 || (sev !== "critical" && sev !== "warning")) return;
      const since = typeof f.since?.value === "string" && !Number.isNaN(Date.parse(f.since.value)) ? ` since ${hhmm(Date.parse(f.since.value))}` : "";
      return { status: sev === "critical" ? "down" : "attention", reason: `is firing (${sev})${since}` };
    }
    case "backup": { // lastOk is on the agent's clock, so it is compared with the agent's now
      const ok = typeof f.lastOk?.value === "string" ? Date.parse(f.lastOk.value) : NaN;
      if (Number.isNaN(ok)) return { status: "attention", reason: "has no successful backup on record" };
      const h = Math.floor((agentNow - ok) / 3_600_000);
      return agentNow - ok > BACKUP_MAX_AGE_MS ? { status: "attention", reason: `has had no successful backup for ${h} h (last at ${hhmm(ok)})` } : undefined;
    }
    case "slo": {
      const left = f.budgetLeft?.value;
      return typeof left === "number" && left <= 0 ? { status: "attention", reason: `has spent its error budget (${left}% left)` } : undefined;
    }
    case "app": {
      const c = f.undeployedCommit?.value;
      return typeof c === "string" && c ? { status: "attention", reason: `has commit ${c.slice(0, 7)} waiting for a deploy` } : undefined;
    }
    case "check":
      return f.drift?.value === true ? { status: "attention", reason: "has drifted from its Bedrock state" } : undefined;
  }
  return undefined;
}

/** Raises (never lowers) a fresh entity's status by the rules above; `agentNow` is the center's now minus the agent's clock skew. */
export function judge(e: Entity, agentNow: number): Entity {
  const r = rule(e, agentNow);
  return r && rank[r.status] > rank[e.status] ? { ...e, status: r.status, statusReason: r.reason } : e;
}
