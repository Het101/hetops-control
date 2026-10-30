import type { Entity, Fact } from "@hetops-control/contracts";
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

export function hostloadSource(api: KubeReader): Source {
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
      return { entities };
    },
  };
}
