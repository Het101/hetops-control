import type { Entity, Status } from "@hetops-control/contracts";
import type { Source } from "../registry.js";
import type { KubeReader } from "./kubernetes.js";

const MIN = 60_000;

export function argoSource(api: KubeReader): Source {
  const unhealthySince = new Map<string, number>();   // app -> first seen not Synced+Healthy (10-min attention rule)
  const brokenSince = new Map<string, number>();      // app -> first seen health Missing/Degraded (30-min down rule)
  return {
    id: "argo", periodMs: 15_000,
    async collect({ server, now }) {
      const t = now().getTime(), observedAt = now().toISOString(), seen = new Set<string>();
      const entities = (await api.listArgoApps()).map((a): Entity => {
        const name: string = a.metadata.name; seen.add(name);
        const sync: string = a.status?.sync?.status ?? "Unknown", health: string = a.status?.health?.status ?? "Unknown";
        const rev: string = a.status?.sync?.revision ?? a.status?.sync?.revisions?.[0] ?? "";   // multi-source apps only have revisions[]
        let status: Status = "ok", statusReason: string | undefined;
        if (health === "Suspended" || (sync === "Synced" && health === "Healthy")) {
          unhealthySince.delete(name); brokenSince.delete(name);
          if (health === "Suspended") statusReason = "suspended";   // intentional, not a fault
        } else {
          if (!unhealthySince.has(name)) unhealthySince.set(name, t);
          if (health !== "Missing" && health !== "Degraded") brokenSince.delete(name);
          else if (!brokenSince.has(name)) brokenSince.set(name, t);
          const mins = Math.floor((t - unhealthySince.get(name)!) / MIN);
          const what = [sync !== "Synced" ? sync : "", health !== "Healthy" ? health : ""].filter(Boolean).join(", ");
          // short OutOfSync/Progressing spells are a normal sync; only a lasting one needs you
          if (brokenSince.has(name) && t - brokenSince.get(name)! > 30 * MIN) status = "down";
          else if (t - unhealthySince.get(name)! > 10 * MIN) status = "attention";
          if (mins >= 1) statusReason = `${what} for ${mins} min`;
        }
        return { id: `${server}/argo-app/${name}`, kind: "argo-app", server, name, parent: `${server}/cluster`, status,
          ...(statusReason ? { statusReason } : {}),
          facts: { sync: { value: sync }, health: { value: health }, revision: { value: /^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, 7) : rev } },
          links: [], actions: [], observedAt };
      });
      for (const m of [unhealthySince, brokenSince]) for (const n of m.keys()) if (!seen.has(n)) m.delete(n);
      return { entities };
    },
  };
}
