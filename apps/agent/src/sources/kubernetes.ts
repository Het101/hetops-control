import * as k8s from "@kubernetes/client-node";
import type { Entity, Event, Status } from "@hetops-control/contracts";
import type { Source } from "../registry.js";

// Raw kube objects, shaped like `kubectl get -o json` items. Sources take this interface so tests run on recorded fixtures.
export interface KubeReader {
  listNodes(): Promise<any[]>; listPods(): Promise<any[]>; listWorkloads(): Promise<any[]>; listArgoApps(): Promise<any[]>;
  nodeSummary(node: string): Promise<any>; version(): Promise<string>;
}

// Thin wrapper over client-node; not unit-tested (needs a cluster). In-cluster config when run as a pod, kubeconfig otherwise.
export function realKube(): KubeReader {
  const kc = new k8s.KubeConfig(); kc.loadFromDefault();
  const core = kc.makeApiClient(k8s.CoreV1Api), apps = kc.makeApiClient(k8s.AppsV1Api);
  const custom = kc.makeApiClient(k8s.CustomObjectsApi), ver = kc.makeApiClient(k8s.VersionApi);
  // list responses omit each item's kind, so set it
  const kind = (k: string) => (l: { items: object[] }) => l.items.map(i => ({ ...i, kind: k }));
  return {
    listNodes: async () => (await core.listNode()).items,
    listPods: async () => (await core.listPodForAllNamespaces()).items,
    listWorkloads: async () => (await Promise.all([
      apps.listDeploymentForAllNamespaces().then(kind("Deployment")),
      apps.listStatefulSetForAllNamespaces().then(kind("StatefulSet")),
      apps.listDaemonSetForAllNamespaces().then(kind("DaemonSet")),
    ])).flat(),
    listArgoApps: async () => (await custom.listNamespacedCustomObject({ group: "argoproj.io", version: "v1alpha1", namespace: "argocd", plural: "applications" })).items,
    nodeSummary: async (name) => {
      const r: unknown = await core.connectGetNodeProxyWithPath({ name, path: "stats/summary" });
      return typeof r === "string" ? JSON.parse(r) : r;
    },
    version: async () => (await ver.getCode()).gitVersion,
  };
}

const DAY = 24 * 3600_000;

export function kubernetesSource(api: KubeReader, opts: { namespaces?: string[] } = {}): Source {
  let baseline: Map<string, number> | undefined;     // ns/pod/container -> restartCount at the previous run
  let recent: { app: string; at: number }[] = [];    // restarts seen in the last 24 h, per app id
  return {
    id: "kubernetes", periodMs: 10_000,
    async collect({ server, now }) {
      const [version, nodes, pods, workloads] = await Promise.all([api.version(), api.listNodes(), api.listPods(), api.listWorkloads()]);
      const t = now(), observedAt = t.toISOString(), clusterId = `${server}/cluster`;
      const inScope = (ns: string) => !opts.namespaces || opts.namespaces.includes(ns);
      const appId = (ns: string, name: string) => `${server}/app/${ns}/${name}`;
      const known = new Set(workloads.map(w => `${w.kind}/${w.metadata.namespace}/${w.metadata.name}`));

      // Pod -> owning workload: ReplicaSet name minus its hash suffix is the Deployment; StatefulSet/DaemonSet directly.
      const owner = (p: any): string | undefined => {
        const ns = p.metadata.namespace;
        for (const r of p.metadata.ownerReferences ?? []) {
          const [kind, name] = r.kind === "ReplicaSet" ? ["Deployment", r.name.replace(/-[^-]+$/, "")] : [r.kind, r.name];
          if (known.has(`${kind}/${ns}/${name}`)) return appId(ns, name);
        }
      };

      const first = !baseline, next = new Map<string, number>(), events: Event[] = [];
      const last = new Map<string, string>();
      for (const p of pods) {
        const app = owner(p);
        for (const c of p.status?.containerStatuses ?? []) {
          const key = `${p.metadata.namespace}/${p.metadata.name}/${c.name}`, count = c.restartCount ?? 0;
          next.set(key, count);
          const finished: string | undefined = c.lastState?.terminated?.finishedAt;
          if (app && finished && finished > (last.get(app) ?? "")) last.set(app, finished);
          if (first) {
            // ponytail: first run only knows the last restart, so restarts24h starts as a lower bound
            if (app && count > 0 && finished && t.getTime() - Date.parse(finished) < DAY) recent.push({ app, at: Date.parse(finished) });
            continue;
          }
          const delta = count - (baseline!.get(key) ?? 0);   // a pod new since the last run counts from 0
          if (delta <= 0) continue;
          const at = finished ?? observedAt;
          if (app) for (let i = 0; i < delta; i++) recent.push({ app, at: Date.parse(at) });
          const reason = c.lastState?.terminated?.reason;
          events.push({ at, server, source: "kubernetes", kind: "restart", entity: app,
            summary: `${key} restarted${delta > 1 ? ` ${delta} times` : ""}${reason ? ` (${reason})` : ""}` });
        }
      }
      baseline = next;   // pods that disappeared drop out here
      recent = recent.filter(r => t.getTime() - r.at < DAY);

      const entity = (e: Omit<Entity, "server" | "links" | "actions" | "observedAt">): Entity => ({ ...e, server, links: [], actions: [], observedAt });
      const entities: Entity[] = [entity({ id: clusterId, kind: "cluster", name: "cluster", status: "ok", facts: {
        version: { value: version }, nodes: { value: nodes.length },
        podsRunning: { value: pods.filter(p => p.status?.phase === "Running").length }, podsTotal: { value: pods.length } } })];

      for (const w of workloads) {
        const { namespace: ns, name } = w.metadata;
        if (!inScope(ns)) continue;
        const ds = w.kind === "DaemonSet";
        const ready: number = (ds ? w.status?.numberReady : w.status?.readyReplicas) ?? 0;
        const desired: number = (ds ? w.status?.desiredNumberScheduled : w.spec?.replicas) ?? (ds ? 0 : 1);
        const id = appId(ns, name), restarts = recent.filter(r => r.app === id).length;
        const [status, statusReason]: [Status, string?] =
          desired > 0 && ready === 0 ? ["down", "no pods ready"]
          : ready < desired ? ["attention", `${ready}/${desired} pods ready`]
          : restarts > 0 ? ["attention", `${restarts} restart${restarts > 1 ? "s" : ""} in 24h`]
          : ["ok"];
        const lastRestartAt = last.get(id);
        entities.push(entity({ id, kind: "app", name, parent: clusterId, status, ...(statusReason ? { statusReason } : {}), facts: {
          namespace: { value: ns }, pods: { value: ready, max: desired }, podsDesired: { value: desired },
          restarts24h: { value: restarts }, ...(lastRestartAt ? { lastRestartAt: { value: lastRestartAt } } : {}) } }));
      }
      return { entities, events };
    },
  };
}
