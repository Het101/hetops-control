import type { Entity, Fact, Series } from "@hetops-control/contracts";
import type { Source } from "../registry.js";
import type { KubeReader } from "./kubernetes.js";

const SUFFIX: Record<string, number> = { "": 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, m: 1e-3 };
// Kubernetes quantity ("4", "3500m", "24548180Ki") -> number; NaN when it can't be read
export function quantity(q: unknown): number {
  const m = typeof q === "string" ? /^([\d.]+)([a-zA-Z]*)$/.exec(q) : null;
  return m && m[2]! in SUFFIX ? Number(m[1]) * SUFFIX[m[2]!]! : NaN;
}

const pct = (used: unknown, total: number) => {
  const v = Math.min(100, Math.round(Number(used) / total * 1000) / 10);
  return typeof used === "number" && Number.isFinite(v) && total > 0 ? v : undefined;
};

const STEP = 600_000, KEEP = 24 * 3_600_000;
const mean = (b: { sum: number; n: number }) => Math.round(b.sum / b.n * 10) / 10;

export function hostloadSource(api: KubeReader): Source {
  // the last 24 h of the busiest node's cpu and memory, as 10-minute means. In memory only, so it starts over when the agent
  // restarts (the page says since when); the same on every server, and nothing to install.
  // ponytail: in-process history; read it from Prometheus instead if every server ever runs one
  const hist = { cpu: new Map<number, { sum: number; n: number }>(), memory: new Map<number, { sum: number; n: number }>() };
  const record = (k: keyof typeof hist, t: number, v: number | undefined) => {
    if (v === undefined) return;
    const at = Math.floor(t / STEP) * STEP, b = hist[k].get(at) ?? { sum: 0, n: 0 };
    hist[k].set(at, { sum: b.sum + v, n: b.n + 1 });
    for (const old of hist[k].keys()) if (old <= t - KEEP) hist[k].delete(old);
  };
  const series = (server: string, k: keyof typeof hist, label: string, observedAt: string): Series => ({
    id: `${server}/host/${k}`, server: server as Series["server"], label, unit: "%", stepMs: STEP, observedAt,
    points: [...hist[k].entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => [t, mean(b)]) });
  return {
    id: "hostload", periodMs: 15_000,
    async collect({ server, now }) {
      const observedAt = now().toISOString();
      // one node's failure is that node's unknown, never the whole source's
      const entities = await Promise.all((await api.listNodes()).map(async (n): Promise<Entity> => {
        const name: string = n.metadata.name, cap = n.status?.capacity ?? {};
        const base = { id: `${server}/node/${name}`, kind: "node" as const, server, name, parent: `${server}/cluster`, links: [], actions: [], observedAt };
        let s: any;
        try { s = (await api.nodeSummary(name))?.node; } catch (err) {
          return { ...base, status: "unknown", statusReason: `summary failed: ${err instanceof Error ? err.message : String(err)}`, facts: {} };
        }
        const load = {
          cpu: pct(s?.cpu?.usageNanoCores, quantity(cap.cpu) * 1e9),
          memory: pct(s?.memory?.workingSetBytes, quantity(cap.memory)),
          disk: pct(s?.fs?.usedBytes, Number(s?.fs?.capacityBytes)),
        };
        const facts: Record<string, Fact> = {}, missing: string[] = [], high: string[] = [];
        for (const [k, v] of Object.entries(load)) {
          if (v === undefined) { missing.push(k); continue; }
          facts[k] = { value: v, unit: "%", max: 100 };
          if (v > 85) high.push(k);
        }
        if (high.length) return { ...base, status: "attention", statusReason: `${high.join(", ")} above 85%`, facts };
        if (missing.length) return { ...base, status: "unknown", statusReason: `no ${missing.join(", ")} reading`, facts };
        return { ...base, status: "ok", facts };
      }));
      const t = now().getTime(), most = (k: "cpu" | "memory") => {
        const v = entities.map(e => e.facts[k]?.value).filter((x): x is number => typeof x === "number");
        return v.length ? Math.max(...v) : undefined;
      };
      record("cpu", t, most("cpu")); record("memory", t, most("memory"));
      return { entities, series: [series(server, "cpu", "CPU of the busiest node, 10-minute mean", observedAt),
        series(server, "memory", "Memory of the busiest node, 10-minute mean", observedAt)] };
    },
  };
}
