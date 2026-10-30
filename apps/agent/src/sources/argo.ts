import type { Entity, Status } from "@hetops-control/contracts";
import type { Source } from "../registry.js";
import type { KubeReader } from "./kubernetes.js";

const MIN = 60_000;

export function argoSource(api: KubeReader): Source {
  const since = new Map<string, number>();   // app name -> when it was first seen not Synced+Healthy
  return {
    id: "argo", periodMs: 15_000,
    async collect({ server, now }) {
      const t = now().getTime(), observedAt = now().toISOString(), seen = new Set<string>();
      const entities = (await api.listArgoApps()).map((a): Entity => {
        const name: string = a.metadata.name; seen.add(name);
        const sync: string = a.status?.sync?.status ?? "Unknown", health: string = a.status?.health?.status ?? "Unknown";
        let status: Status = "ok", statusReason: string | undefined;
        if (sync === "Synced" && health === "Healthy") since.delete(name);
        else {
          if (!since.has(name)) since.set(name, t);
          const mins = Math.floor((t - since.get(name)!) / MIN);
          statusReason = `${sync}, ${health} for ${mins} min`;
          // short OutOfSync/Progressing spells are a normal sync; only a lasting one needs you
          if ((health === "Missing" || health === "Degraded") && t - since.get(name)! > 30 * MIN) status = "down";
          else if (t - since.get(name)! > 10 * MIN) status = "attention";
        }
        return { id: `${server}/argo-app/${name}`, kind: "argo-app", server, name, parent: `${server}/cluster`, status,
          ...(statusReason ? { statusReason } : {}),
          facts: { sync: { value: sync }, health: { value: health }, revision: { value: a.status?.sync?.revision ?? "" } },
          links: [], actions: [], observedAt };
      });
      for (const n of since.keys()) if (!seen.has(n)) since.delete(n);
      return { entities };
    },
  };
}
