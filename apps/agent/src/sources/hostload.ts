import type { Entity } from "@hetops-control/contracts";
import type { Source } from "../registry.js";
import type { KubeReader } from "./kubernetes.js";

const SUFFIX: Record<string, number> = { "": 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, m: 1e-3 };
// Kubernetes quantity ("4", "4000m", "24548180Ki") -> number
export function quantity(q: string): number {
  const m = /^([\d.]+)([a-zA-Z]*)$/.exec(q);
  if (!m || !(m[2]! in SUFFIX)) throw new Error(`unsupported quantity ${q}`);
  return Number(m[1]) * SUFFIX[m[2]!]!;
}

const pct = (used: number, total: number) => Math.min(100, Math.round(used / total * 1000) / 10);

export function hostloadSource(api: KubeReader): Source {
  return {
    id: "hostload", periodMs: 15_000,
    async collect({ server, now }) {
      const observedAt = now().toISOString();
      const entities = await Promise.all((await api.listNodes()).map(async (n): Promise<Entity> => {
        const name: string = n.metadata.name, cap = n.status.capacity, s = (await api.nodeSummary(name)).node;
        const load = {
          cpu: pct(s.cpu.usageNanoCores, quantity(cap.cpu) * 1e9),
          memory: pct(s.memory.workingSetBytes, quantity(cap.memory)),
          disk: pct(s.fs.usedBytes, s.fs.capacityBytes),
        };
        const high = Object.entries(load).filter(([, v]) => v > 85).map(([k]) => k);
        return { id: `${server}/node/${name}`, kind: "node", server, name, parent: `${server}/cluster`,
          status: high.length ? "attention" : "ok", ...(high.length ? { statusReason: `${high.join(", ")} above 85%` } : {}),
          facts: Object.fromEntries(Object.entries(load).map(([k, v]) => [k, { value: v, unit: "%", max: 100 }])),
          links: [], actions: [], observedAt };
      }));
      return { entities };
    },
  };
}
