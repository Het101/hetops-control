import type { Entity, ServerId } from "@hetops-control/contracts";
import { hash, rng } from "./seed.js";
import type { Burn, Reading } from "./burn.js";

/**
 * The Fire line map: compartments (one per server), groves (one per namespace) and trees (one per workload), as geometry.
 * Everything is seeded from ids, so a tree keeps its shape, place and leaves across reloads, and a new workload only adds a tree.
 */
export type Box = { x: number; y: number; w: number; h: number };
export type Leaf = { x: number; y: number; rot: number; s: number; tone: 0 | 1 | 2 };
/** One drawn tree in its own 100 x 130 box (ground at y 104), placed by x, y (its foot) and w (its width on the map). */
export type Tree = { id: string; name: string; server: ServerId; x: number; y: number; w: number; reading: Reading;
  trunk: string; branches: string; roots: string; leaves: Leaf[]; entity: Entity };
/** caption: the members that are not calm, listed under the clump so their words never collide on the map */
export type Grove = { id: string; name: string; box: Box; trees: Tree[]; label: { x: number; y: number }; caption: { x: number; y: number; trees: Tree[] } };
export type Compartment = { server: ServerId; name: string; outline: string; label: { x: number; y: number }; box: Box; groves: Grove[] };

export const VIEW = { w: 960, h: 520 };
const NAME: Record<ServerId, string> = { lab: "Lab", staging: "Staging", ops: "Ops" };
// the estate, as on the board: lab the large west block, staging a small one north of the river, ops the east block
const ESTATE: Record<ServerId, { outline: string; label: { x: number; y: number }; box: Box }> = {
  lab: { outline: "M30 60 L300 34 L420 90 L460 250 L420 460 L180 488 L40 440 Z", label: { x: 56, y: 88 }, box: { x: 50, y: 100, w: 390, h: 366 } },
  staging: { outline: "M520 70 L700 50 L730 170 L570 200 L530 160 Z", label: { x: 548, y: 92 }, box: { x: 552, y: 100, w: 160, h: 84 } },
  ops: { outline: "M560 250 L880 220 L930 330 L900 480 L620 496 L570 420 Z", label: { x: 590, y: 276 }, box: { x: 588, y: 286, w: 316, h: 196 } },
};
// one server zoomed in fills the frame
const ZOOM = { outline: "M24 44 L900 22 L940 250 L912 500 L64 504 L20 290 Z", label: { x: 48, y: 72 }, box: { x: 44, y: 84, w: 872, h: 412 } };
export const CONTOURS = Array.from({ length: 9 }, (_, i) => { const y = 470 - i * 50; return `M-10 ${y} C ${120 + i * 10} ${y - 40}, ${240 + i * 10} ${y + 30}, ${380 + i * 10} ${y - 20} S ${640 + i * 10} ${y - 70}, 970 ${y - 20}`; });
export const RIVER = "M492 0 C 512 110 476 210 528 300 S 548 430 506 520";

const r1 = (n: number) => Math.round(n * 10) / 10;
const TIPS = 7, LEAVES = 16;   // seven branches and the crown, each a cluster of leaves

/** A tree's trunk, branches, roots and leaves, from its seed. keep is the share of leaves still on it (a burning tree loses some). */
export function grow(seed: string, keep = 1): Pick<Tree, "trunk" | "branches" | "roots" | "leaves"> {
  const R = rng(hash(seed));
  const lean = (R() - .5) * 4, top = 56 + R() * 8;
  const trunk = `M${r1(45 + R())} 105 Q${r1(47 + lean / 2)} 84 ${r1(48.6 + lean)} ${r1(top)} L${r1(51.4 + lean)} ${r1(top)} Q${r1(53 + lean / 2)} 84 ${r1(55 + R())} 105 Z`;
  const tips: { x: number; y: number }[] = [];
  let branches = "";
  for (let i = 0; i < TIPS; i++) {
    const a = (-160 + (140 * (i + .5)) / TIPS + (R() - .5) * 14) * Math.PI / 180, len = 24 + R() * 18;
    const sx = 50 + lean * .7, sy = top + 6 + R() * 22, ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len * .9;
    branches += `M${r1(sx)} ${r1(sy)} Q${r1(sx + Math.cos(a) * len * .4 + (R() - .5) * 6)} ${r1(sy + Math.sin(a) * len * .2)} ${r1(ex)} ${r1(ey)} `;
    tips.push({ x: ex, y: ey });
  }
  tips.push({ x: 50 + lean, y: top - 20 - R() * 6 });   // the crown
  let roots = "";
  for (let i = 0; i < 5; i++) { const dx = (i - 2) * 9 + (R() - .5) * 6; roots += `M${r1(50 + dx * .15)} 104 Q${r1(50 + dx * .6)} ${r1(109 + R() * 3)} ${r1(50 + dx * 1.4)} ${r1(114 + R() * 8)} `; }
  const leaves: Leaf[] = [];
  for (const t of tips) for (let n = 0; n < LEAVES; n++) {
    const a = R() * Math.PI * 2, d = R() * 13, x = t.x + Math.cos(a) * d * 1.2, y = t.y + Math.sin(a) * d * .9;
    const rot = Math.floor(R() * 180), s = 1 + R() * .55, gone = R() > keep;
    if (gone) continue;
    leaves.push({ x: r1(x), y: r1(y), rot, s: Math.round(s * 100) / 100, tone: y < t.y - 3 && x > t.x - 2 ? 2 : y > t.y + 4 ? 0 : 1 });
  }
  return { trunk, branches: branches.trim(), roots: roots.trim(), leaves };
}

const pods = (e: Entity) => { const d = e.facts.podsDesired?.value, p = e.facts.pods?.value; return Math.max(typeof d === "number" ? d : 0, typeof p === "number" ? p : 0, 1); };
const readyShare = (e: Entity) => { const d = e.facts.podsDesired?.value, p = e.facts.pods?.value; return typeof d === "number" && d > 0 && typeof p === "number" ? p / d : 1; };
/** the grove a workload grows in: its namespace, or its platform when it has none (Coolify apps) */
export const groveOf = (e: Entity) => { const ns = e.facts.namespace?.value; return typeof ns === "string" ? ns : e.source ?? "apps"; };

/** Splits a box into n cells, as square as the box allows. */
function cells(box: Box, n: number): Box[] {
  if (!n) return [];
  const cols = Math.max(1, Math.round(Math.sqrt(n * box.w / box.h))), rows = Math.ceil(n / cols);
  const w = box.w / cols, h = box.h / rows;
  return Array.from({ length: n }, (_, i) => ({ x: box.x + (i % cols) * w, y: box.y + Math.floor(i / cols) * h, w, h }));
}

const LABEL = 16, CAPTION = 14;   // the grove's name above its clump; one caption line per member that is not calm

/**
 * Lays out the estate (or one server, zoomed): each server's apps in groves by namespace, biggest grove first. A grove is one
 * clump: trees on a staggered grid whose canopies overlap like a stand of forest, scaled down only as far as its plot needs,
 * drawn back to front. A burning tree keeps only the leaves of its ready pods.
 */
export function plant(apps: Entity[], readings: Map<string, Reading>, only?: ServerId): Compartment[] {
  const servers: ServerId[] = only ? [only] : ["lab", "staging", "ops"];
  return servers.map(server => {
    const shape = only ? ZOOM : ESTATE[server];
    const mine = apps.filter(a => a.server === server);
    const byGrove = new Map<string, Entity[]>();
    for (const a of mine) { const g = groveOf(a); byGrove.set(g, [...(byGrove.get(g) ?? []), a]); }
    const names = [...byGrove.keys()].sort((a, b) => byGrove.get(b)!.length - byGrove.get(a)!.length || a.localeCompare(b));
    const base = only ? 84 : 52;   // a one-pod tree's width
    const groves = cells(shape.box, names.length).map((cell, gi): Grove => {
      const name = names[gi]!, members = [...byGrove.get(name)!].sort((a, b) => a.id.localeCompare(b.id));
      const read = (e: Entity) => readings.get(e.id) ?? { burn: "calm" as Burn, hot: false };
      const loud = members.filter(e => read(e).burn !== "calm");
      const room = { w: cell.w - 12, h: cell.h - LABEL - 8 - loud.length * CAPTION };
      const widths = members.map(e => base * (1 + .28 * (Math.sqrt(Math.min(pods(e), 12)) - 1)));
      const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
      // canopies overlap: a column every .62 of a tree, a row every .42 (the back row shows above the front one)
      const fit = (k: number) => { const s = avg * k * .62, cols = Math.max(1, Math.min(members.length, Math.floor((room.w - avg * k * .4) / s) + 1)), rows = Math.ceil(members.length / cols);
        return { k, s, cols, rows, h: avg * k * 1.3 + (rows - 1) * avg * k * .42, w: (cols - 1) * s + avg * k + (rows > 1 ? s / 2 : 0) }; };
      let f = fit(1);
      while ((f.h > room.h || f.w > room.w) && f.k > .35) f = fit(f.k * .92);
      const top = cell.y + LABEL + 6 + Math.max(0, (room.h - f.h) / 2), left = cell.x + 6 + Math.max(0, (room.w - f.w) / 2);
      const trees = members.map((e, i): Tree => {
        const R = rng(hash(`${e.id}|spot`)), reading = read(e), row = Math.floor(i / f.cols), col = i % f.cols;
        const w = widths[i]! * f.k, keep = reading.burn === "fire" || reading.burn === "rain" ? Math.max(.35, Math.min(.72, readyShare(e))) : 1;
        const x = left + avg * f.k / 2 + col * f.s + (row % 2 ? f.s / 2 : 0) + (R() - .5) * f.s * .25;
        const y = top + avg * f.k * 1.3 * (104 / 130) + row * avg * f.k * .42 + (R() - .5) * avg * f.k * .08;
        return { id: e.id, name: e.name, server, entity: e, reading, x: r1(x), y: r1(y), w: r1(w), ...grow(e.id, keep) };
      }).sort((a, b) => a.y - b.y);
      const foot = Math.max(...trees.map(t => t.y)) + 10;
      return { id: `${server}/${name}`, name, box: cell, trees, label: { x: r1(left), y: r1(top - 4) },
        caption: { x: r1(cell.x + 8), y: r1(foot + 12), trees: trees.filter(t => t.reading.burn !== "calm").sort((a, b) => a.name.localeCompare(b.name)) } };
    });
    return { server, name: NAME[server], outline: shape.outline, label: shape.label, box: shape.box, groves };
  });
}
