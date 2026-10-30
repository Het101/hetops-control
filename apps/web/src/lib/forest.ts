import { worst, type ServerId, type Status } from "@hetops-control/contracts";

/** x, y are offsets from the branch tip; tone in [0,1) picks the leaf grey (floor(tone·5)) and its opacity (the fractional part). */
export type Leaf = { x: number; y: number; r: number; tone: number; ember: boolean };
/** id is the app id (the render key), app its display name; tip is where the leaves hang. */
export type Branch = { id: string; app: string; d: string; width: number; tip: { x: number; y: number }; leaves: Leaf[]; restarts: number; status: Status };
export type Tree = { server: ServerId; x: number; trunk: string; roots: string[]; branches: Branch[] };
export type ForestApp = { id: string; name: string; pods: number; restarts: number; status: Status };

export const MAX_BRANCHES = 14;
const MAX_PODS = 12; // a 50-replica app should not swallow the canopy
const FAN_FROM = -160, FAN_SPAN = 140; // degrees, as in the mock

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

/**
 * One tree per server. Branches sit evenly across the fan in a stable order (rank = hash of the app id), so a new app
 * only nudges its neighbours' angles; every branch's length, bend and leaf pattern come from its own hash and never change.
 * Over 14 apps, 13 keep a branch (struggling apps always, then the best-ranked healthy ones) and the rest share "+N more".
 */
export function growTree(server: ServerId, x: number, apps: ForestApp[]): Tree {
  const R = rng(hash(server));
  const roots = Array.from({ length: 5 }, () => { const dx = (R() - .5) * 90; return `M${x} 300 q ${r1(dx / 2)} 10 ${r1(dx)} ${r1(16 + R() * 10)}`; });
  const tx = x + (R() - .5) * 6, ty = 172;
  const trunk = `M${x - 9} 300 C ${x - 6} 250, ${r1(tx - 5)} 210, ${r1(tx)} ${ty} C ${r1(tx + 5)} 210, ${x + 6} 250, ${x + 9} 300 Z`;

  const rank = (a: ForestApp) => hash(`${server}|${a.id}`);
  const ranked = [...apps].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  let shown = ranked;
  if (ranked.length > MAX_BRANCHES) {
    const sick = ranked.filter(struggling).slice(0, MAX_BRANCHES - 1);
    const keep = new Set([...sick, ...ranked.filter(a => !struggling(a)).slice(0, MAX_BRANCHES - 1 - sick.length)]);
    const rest = ranked.filter(a => !keep.has(a));
    shown = [...ranked.filter(a => keep.has(a)), { id: `${server}/app/+more`, name: `+${rest.length} more`,
      pods: rest.reduce((n, a) => n + a.pods, 0), restarts: rest.reduce((n, a) => n + a.restarts, 0), status: worst(rest.map(a => a.status)) }];
  }

  const branches = shown.map((a, i): Branch => {
    const B = rng(hash(`${server}|${a.id}`)), pods = Math.min(Math.max(a.pods, 0), MAX_PODS);
    const ang = (FAN_FROM + FAN_SPAN * (i + .5) / shown.length) * Math.PI / 180 + (B() - .5) * .15, len = 55 + B() * 45 + pods * 3;
    const sx = tx, sy = ty + 10 + B() * 18, ex = sx + Math.cos(ang) * len, ey = sy + Math.sin(ang) * len * .8;
    const cx = sx + Math.cos(ang) * len * .5 + (B() - .5) * 20, cy = sy + Math.sin(ang) * len * .3;
    const count = pods * 5, embers = struggling(a) ? Math.min(Math.max(a.restarts, 1) * 6, count) : 0;
    const leaves: Leaf[] = Array.from({ length: count }, (_, p) => ({ r: r1(6 + B() * 9), x: r1((B() - .5) * (26 + pods * 4)),
      y: r1((B() - .5) * (22 + pods * 3)), tone: B(), ember: p < embers }));
    return { id: a.id, app: a.name, d: `M${r1(sx)} ${r1(sy)} Q ${r1(cx)} ${r1(cy)} ${r1(ex)} ${r1(ey)}`, width: r1(2 + pods * .35),
      tip: { x: r1(ex), y: r1(ey) }, leaves, restarts: a.restarts, status: a.status };
  });

  return { server, x, trunk, roots, branches };
}
