import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import type { Action, Entity } from "@hetops-control/contracts";

// Argo CD Applications through the Kubernetes API (the agent's Role: get, patch in argocd). RBAC cannot see inside a patch,
// so the ValidatingAdmissionPolicy in hetops-k8s-lab (control-agent-argo-actions) allows only the two shapes sent below.
export interface ArgoApps { get(name: string): Promise<any>; patch(name: string, body: object): Promise<unknown> }

export function realArgo(): ArgoApps {
  let api: k8s.CustomObjectsApi | undefined;
  const c = () => { if (!api) { const kc = new k8s.KubeConfig(); kc.loadFromDefault(); api = kc.makeApiClient(k8s.CustomObjectsApi); } return api; };
  const where = { group: "argoproj.io", version: "v1alpha1", namespace: "argocd", plural: "applications" };
  return {
    get: name => c().getNamespacedCustomObject({ ...where, name }),
    // a JSON merge patch: only the keys sent change
    patch: (name, body) => c().patchNamespacedCustomObject({ ...where, name, body, fieldManager: "hetops-control" },
      k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch)),
  };
}

const NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const nameOf = (e: Entity) => { if (!NAME.test(e.name) || e.name.length > 253) throw new Error("not an Argo CD application name"); return e.name; };
const running = (a: any) => a?.status?.operationState?.phase === "Running";
const Sync = z.object({}).strict();
const Refresh = z.object({ hard: z.boolean().default(false).describe("Also drop Argo CD's cached manifests (a hard refresh)") }).strict();

export function argoSync(api: ArgoApps): Action<z.infer<typeof Sync>> {
  return {
    id: "argo.sync", label: "Sync", targets: ["argo-app"], risk: "safe",
    description: "Asks Argo CD to sync the application to the revision in git, as its Sync button does, without pruning.",
    params: Sync, applies: e => e.source === "argo",
    async preview(t) {
      const a = await api.get(nameOf(t)); const src = a?.spec?.source ?? a?.spec?.sources?.[0] ?? {};
      return `Syncs ${t.name} on ${t.server} to ${src.targetRevision ?? "HEAD"} of ${src.repoURL ?? "its repository"}${src.path ? ` (${src.path})` : ""}. `
        + `Now: ${a?.status?.sync?.status ?? "Unknown"}, ${a?.status?.health?.status ?? "Unknown"}. `
        + "Nothing is pruned: anything removed from git stays until Argo CD's own automated sync prunes it."
        + (running(a) ? " A sync is already running, so this changes nothing." : "");
    },
    async run(t, _p, ctx) {
      const name = nameOf(t);
      if (running(await api.get(name))) return { ok: true, already: true, summary: `a sync of ${name} is already running` };
      await api.patch(name, { operation: { initiatedBy: { username: `${ctx.actor} (hetops-control)` }, sync: { syncStrategy: { hook: {} } } } });
      return { ok: true, summary: `sync of ${name} started` };
    },
  };
}

export function argoRefresh(api: ArgoApps): Action<z.infer<typeof Refresh>> {
  return {
    id: "argo.refresh", label: "Refresh", targets: ["argo-app"], risk: "safe",
    description: "Asks Argo CD to compare the application with git now instead of at its next poll. Changes nothing in the cluster.",
    params: Refresh, applies: e => e.source === "argo",
    async preview(t, p) {
      return `Refreshes ${t.name} on ${t.server}: Argo CD re-reads git${p.hard ? " without its manifest cache (hard)" : ""} and updates the sync status. Nothing in the cluster changes.`;
    },
    async run(t, p) {
      const name = nameOf(t);
      await api.patch(name, { metadata: { annotations: { "argocd.argoproj.io/refresh": p.hard ? "hard" : "normal" } } });
      return { ok: true, summary: `${p.hard ? "hard " : ""}refresh of ${name} requested` };
    },
  };
}
