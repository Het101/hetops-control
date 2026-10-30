import { worst, type ServerId, type Status } from "@hetops-control/contracts";

/** tone in [0,1): picks the leaf grey (floor(tone·5)) and its opacity (the fractional part). */
export type Leaf = { x: number; y: number; r: number; tone: number; ember: boolean };
export type Branch = { app: string; d: string; width: number; leaves: Leaf[]; restarts: number; status: Status };
export type Tree = { server: ServerId; x: number; trunk: string; roots: string[]; branches: Branch[] };
export type ForestApp = { id: string; name: string; pods: number; restarts: number; status: Status };

const MAX_BRANCHES = 14;
const MAX_PODS = 12; // a 50-replica app should not swallow the canopy

/** FNV-1a, folded into a Park-Miller seed (1..2^31-2). */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 2147483646) + 1;
}
/** The mock's generator: same sequence for the same seed. */
export function rng(seed: number): () => number {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}
const r1 = (n: number) => Math.round(n * 10) / 10;

export const struggling = (a: Pick<ForestApp, "restarts" | "status">) => a.restarts > 0 || a.status === "attention" || a.status === "down";

/** One tree per server; each branch is seeded by its own app id, so adding an app never moves the others. */
export function growTree(server: ServerId, x: number, apps: ForestApp[]): Tree {
  const R = rng(hash(server));
  const roots = Array.from({ length: 5 }, () => { const dx = (R() - .5) * 90; return `M${x} 300 q ${r1(dx / 2)} 10 ${r1(dx)} ${r1(16 + R() * 10)}`; });
  const tx = x + (R() - .5) * 6, ty = 172;
  const trunk = `M${x - 9} 300 C ${x - 6} 250, ${r1(tx - 5)} 210, ${r1(tx)} ${ty} C ${r1(tx + 5)} 210, ${x + 6} 250, ${x + 9} 300 Z`;

  // struggling apps keep their own branch first, then by id; the overflow becomes one "+N more" branch
  const sorted = [...apps].sort((a, b) => Number(struggling(b)) - Number(struggling(a)) || a.id.localeCompare(b.id));
  let shown = sorted;
  if (sorted.length > MAX_BRANCHES) {
    const rest = sorted.slice(MAX_BRANCHES - 1);
    shown = [...sorted.slice(0, MAX_BRANCHES - 1), { id: `${server}/app/+more`, name: `+${rest.length} more`,
      pods: rest.reduce((n, a) => n + a.pods, 0), restarts: rest.reduce((n, a) => n + a.restarts, 0), status: worst(rest.map(a => a.status)) }];
  }

  const branches = shown.map(a => {
    const B = rng(hash(`${server}|${a.id}`)), pods = Math.min(Math.max(a.pods, 0), MAX_PODS);
    const ang = (-160 + B() * 140) * Math.PI / 180, len = 55 + B() * 45 + pods * 3;
    const sx = tx, sy = ty + 10 + B() * 18, ex = sx + Math.cos(ang) * len, ey = sy + Math.sin(ang) * len * .8;
    const cx = sx + Math.cos(ang) * len * .5 + (B() - .5) * 20, cy = sy + Math.sin(ang) * len * .3;
    const count = pods * 5, embers = struggling(a) ? Math.min(Math.max(a.restarts, 1) * 6, count) : 0;
    const leaves: Leaf[] = Array.from({ length: count }, (_, p) => ({ r: r1(6 + B() * 9), x: r1(ex + (B() - .5) * (26 + pods * 4)),
      y: r1(ey + (B() - .5) * (22 + pods * 3)), tone: B(), ember: p < embers }));
    return { ang, b: { app: a.name, d: `M${r1(sx)} ${r1(sy)} Q ${r1(cx)} ${r1(cy)} ${r1(ex)} ${r1(ey)}`, width: r1(2 + pods * .35),
      leaves, restarts: a.restarts, status: a.status } };
  }).sort((p, q) => p.ang - q.ang).map(p => p.b);

  return { server, x, trunk, roots, branches };
}
