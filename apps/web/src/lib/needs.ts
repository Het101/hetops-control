import type { Entity, Need, ServerView } from "@hetops-control/contracts";
import type { Descriptor, Offer } from "./actions.js";
import { offer, pageOf } from "./actions.js";

/** How much a need weighs at 3 a.m.: down first, then what needs a look, then what we simply can't see */
export type Severity = "down" | "attention" | "blind";
export type NeedRow = { n: Need; e?: Entity; sev: Severity; word: string; o?: Offer; page: { href: string; label: string } };
const W: Record<Severity, number> = { down: 3, attention: 2, blind: 1 };
export const WORDS: Record<Severity, string> = { down: "Down", attention: "Needs a look", blind: "Can't see" };

/** Every need, ranked: its severity from what it is about (an entity's status, else its server's), then the center's own order.
 Each row knows its one move: the action its entity offers, or the page to open when there is nothing to press. */
export function ranked(needs: Need[], entities: Entity[], servers: Record<string, ServerView>, catalog: Descriptor[]): NeedRow[] {
  return needs.map((n, i) => {
    const e = entities.find(x => x.id === n.entity), status = e?.status ?? servers[n.entity]?.status;
    const sev: Severity = status === "down" ? "down" : status === "attention" ? "attention" : e ? "attention" : "blind";
    const o = e && n.action ? offer(e, n.action.id, catalog) : undefined;
    return { row: { n, ...(e ? { e } : {}), sev, word: WORDS[sev], ...(o ? { o } : {}), page: pageOf(n.entity) }, i };
  }).sort((a, b) => W[b.row.sev] - W[a.row.sev] || a.i - b.i).map(x => x.row);
}
