import * as k8s from "@kubernetes/client-node";
import { ObjectSerializer } from "@kubernetes/client-node/dist/serializer.js";   // not re-exported by the package root; version pinned exactly
import type { Entity, Event, Status } from "@hetops-control/contracts";
import type { Source } from "../registry.js";

// Raw kube objects, shaped like `kubectl get -o json` items. Sources take this interface so tests run on recorded fixtures.
export interface KubeReader {
  listNodes(): Promise<any[]>; listPods(): Promise<any[]>; listWorkloads(): Promise<any[]>; listArgoApps(): Promise<any[]>;
  nodeSummary(node: string): Promise<any>; version(): Promise<string>;
  onChange?(fn: () => void): void;   // pods, workloads or nodes changed
}

// The parts of a client-node informer that watched() uses, so tests can drive a fake one.
export interface InformerLike {
  on(verb: "add" | "update" | "delete", cb: (obj: any) => void): void;
  on(verb: "error", cb: (err?: any) => void): void;
  start(): Promise<void>; list(): readonly any[];
}

/**
 * One LIST, then WATCH, into a local cache (client-node's informer; it relists by itself on 410 Gone).
 * The returned reader serves the cache, or throws while it can't be trusted: before the first sync, and once the
 * watch has been failing for longer than graceMs (one period of the source reading it), so the source goes blind, never stale-green.
 * Any other watch error stops the informer; it is restarted with backoff, 1 s doubling to 30 s.
 * ponytail: no client-side watch timeout; a half-open connection is caught by client-node's 30 s TCP keepalive and the API server
 * ending every watch within 30-60 min (meanwhile /version and the kubelet summary, still plain GETs, fail). Add a periodic rewatch if that bites.
 */
export function watched(inf: InformerLike, what: string, graceMs: number, onChange: () => void = () => {}, now = Date.now): () => any[] {
  let started = false, synced = false, failingSince: number | undefined, lastError = "not synced yet", errors = 0, backoff = 1000;
  let retry: NodeJS.Timeout | undefined;
  const fail = (err: unknown) => {
    errors++; failingSince ??= now();
    lastError = err instanceof Error ? err.message : String(err ?? "watch closed");
    if (retry) return;
    retry = setTimeout(() => { retry = undefined; void run(); }, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
  // client-node reports list and watch failures through "error" before start() resolves, so a clean start means LIST and WATCH are up
  const run = async () => {
    const before = errors;
    try { await inf.start(); } catch (err) { fail(err); return; }
    if (errors !== before) return;
    synced = true; failingSince = undefined; backoff = 1000; onChange();
  };
  for (const v of ["add", "update", "delete"] as const) inf.on(v, () => onChange());
  inf.on("error", fail);
  return () => {
    if (!started) { started = true; failingSince = now(); void run(); }   // lazy: outside a cluster the source reports, the agent doesn't crash
    if (!synced) throw new Error(`${what}: ${lastError}`);
    if (failingSince !== undefined && now() - failingSince > graceMs)
      throw new Error(`${what} watch failing for ${Math.round((now() - failingSince) / 1000)} s: ${lastError}`);
    return [...inf.list()];
  };
}

// Watch events carry raw JSON while the typed LIST returns client models (timestamps as Date). Deserialise each event
// into the same model so a cached object reads the same whichever way it arrived; entity output stays byte-identical.
export const typed = (type?: string) => (obj: any) => (type ? ObjectSerializer.deserialize(obj, type) : obj);
class TypedWatch extends k8s.Watch {
  constructor(kc: k8s.KubeConfig, private toModel: (o: any) => any) { super(kc); }
  override watch(path: string, query: Record<string, any>, cb: (phase: string, obj: any, raw: any) => void, done: (err: any) => void) {
    return super.watch(path, query, (phase, obj, raw) => cb(phase, phase === "ERROR" ? obj : this.toModel(obj), raw), done);
  }
}

// Thin wrapper over client-node; not unit-tested (needs a cluster). In-cluster config when run as a pod, kubeconfig otherwise.
// Pods, workloads, nodes and Argo applications come from informers; the kubelet summary and /version stay plain GETs.
export function realKube(): KubeReader {
  const listeners = new Set<() => void>(), notify = () => listeners.forEach(f => f());
  // lazy: outside a cluster the clients can't be built, and the sources should report that instead of the agent crashing
  const build = () => {
    const kc = new k8s.KubeConfig(); kc.loadFromDefault();
    const core = kc.makeApiClient(k8s.CoreV1Api), apps = kc.makeApiClient(k8s.AppsV1Api), custom = kc.makeApiClient(k8s.CustomObjectsApi);
    // graceMs = the reading source's period: kubernetes 10 s (pods, workloads, nodes), argo 15 s
    const cache = (what: string, path: string, type: string | undefined, list: () => Promise<any>, graceMs = 10_000, changed = notify) =>
      watched(new k8s.ListWatch(path, new TypedWatch(kc, typed(type)), list, false), what, graceMs, changed);
    // list responses omit each item's kind, so set it
    const kind = (k: string, read: () => any[]) => () => read().map(i => ({ ...i, kind: k }));
    const workloads = [
      kind("Deployment", cache("deployments", "/apis/apps/v1/deployments", "V1Deployment", () => apps.listDeploymentForAllNamespaces())),
      kind("StatefulSet", cache("statefulsets", "/apis/apps/v1/statefulsets", "V1StatefulSet", () => apps.listStatefulSetForAllNamespaces())),
      kind("DaemonSet", cache("daemonsets", "/apis/apps/v1/daemonsets", "V1DaemonSet", () => apps.listDaemonSetForAllNamespaces())),
    ];
    return { core, ver: kc.makeApiClient(k8s.VersionApi),
      nodes: cache("nodes", "/api/v1/nodes", "V1Node", () => core.listNode()),
      pods: cache("pods", "/api/v1/pods", "V1Pod", () => core.listPodForAllNamespaces()),
      workloads: () => workloads.flatMap(w => w()),
      argo: cache("argo applications", "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications", undefined,
        () => custom.listNamespacedCustomObject({ group: "argoproj.io", version: "v1alpha1", namespace: "argocd", plural: "applications" }), 15_000, () => {}),
    };
  };
  let cl: ReturnType<typeof build> | undefined;
  const c = () => (cl ??= build());
  return {
    listNodes: async () => c().nodes(),
    listPods: async () => c().pods(),
    listWorkloads: async () => c().workloads(),
    listArgoApps: async () => c().argo(),
    nodeSummary: async (name) => {
      const r: unknown = await c().core.connectGetNodeProxyWithPath({ name, path: "stats/summary" });
      return typeof r === "string" ? JSON.parse(r) : r;
    },
    version: async () => (await c().ver.getCode()).gitVersion,
    onChange: fn => { listeners.add(fn); },
  };
}

const DAY = 24 * 3600_000;

// client-node deserialises timestamps to Date, kubectl JSON has strings; a fact value must be a primitive, so normalise to an ISO string (undefined when unreadable)
const ts = (v: unknown): string | undefined =>
  v instanceof Date ? (Number.isNaN(v.getTime()) ? undefined : v.toISOString()) : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined;

export function kubernetesSource(api: KubeReader, opts: { namespaces?: string[] } = {}): Source {
  let baseline: Map<string, number> | undefined;     // ns/pod/container -> restartCount at the previous run
  let recent: { app: string; at: number }[] = [];    // restarts seen in the last 24 h, per app id
  return {
    id: "kubernetes", periodMs: 10_000,
    watch: changed => api.onChange?.(changed),   // a pod restart reaches the forest in about a second, not at the next period
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
        if (!inScope(p.metadata.namespace)) continue;   // out-of-scope pods: no baseline, no restart log, no events
        const app = owner(p);
        for (const c of p.status?.containerStatuses ?? []) {
          const key = `${p.metadata.namespace}/${p.metadata.name}/${c.name}`, count = c.restartCount ?? 0;
          next.set(key, count);
          // restart time: when the last container exited; else when it started; else (restarted, no lastState recorded) when the current one started
          const finished = ts(c.lastState?.terminated?.finishedAt) ?? ts(c.lastState?.terminated?.startedAt) ?? (count > 0 ? ts(c.state?.running?.startedAt) : undefined);
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
