import { ServerIdSchema, type Entity } from "@hetops-control/contracts";
import { offer, pageOf, type Descriptor } from "./actions.js";

/** One thing the palette can do: go somewhere, or open an action's dialog */
export type Command = { id: string; group: "Pages" | "Servers" | "Actions" | "Apps and sites"; label: string; hint: string;
  go?: string; act?: { entity: Entity; action: string } };

const NAME = { lab: "Lab", staging: "Staging", ops: "Ops" } as const;
const KIND: Record<string, string> = { app: "app", "argo-app": "Argo app", site: "site", backup: "backup", check: "check", alert: "alert", node: "node" };

/** Everything reachable from the keyboard: the pages, each server, every action an entity offers, every app and site */
export function commands(pages: Record<string, string>, entities: Entity[], catalog: Descriptor[]): Command[] {
  const out: Command[] = Object.entries(pages).map(([go, label]) => ({ id: `page:${go}`, group: "Pages", label, hint: "page", go }));
  for (const id of ServerIdSchema.options) out.push({ id: `server:${id}`, group: "Servers", label: NAME[id], hint: "server page", go: `/servers/${id}` });
  for (const e of entities) for (const a of e.actions) {
    if (!offer(e, a.id, catalog)) continue;
    out.push({ id: `act:${e.id}:${a.id}`, group: "Actions", label: `${a.label} ${e.name}`, hint: `${e.server} · ${a.risk}`, act: { entity: e, action: a.id } });
  }
  for (const e of entities) if (KIND[e.kind]) {
    const p = pageOf(e.id);
    out.push({ id: `ent:${e.id}`, group: "Apps and sites", label: e.name, hint: `${KIND[e.kind]} · ${e.server} · ${p.label}`, go: p.href });
  }
  return out;
}

/** Every word typed must appear in the label or hint; a label that starts with the query ranks first, then a word start */
export function search(list: Command[], q: string, limit = 40): Command[] {
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return list.filter(c => c.group === "Pages" || c.group === "Servers").slice(0, limit);
  const score = (c: Command) => {
    const l = c.label.toLowerCase(), all = `${l} ${c.hint.toLowerCase()}`;
    if (!words.every(w => all.includes(w))) return -1;
    return (l.startsWith(words[0]!) ? 3 : l.split(/[\s./-]+/).some(p => p.startsWith(words[0]!)) ? 2 : 1) + (c.group === "Actions" && words.length > 1 ? 1 : 0);
  };
  return list.map(c => ({ c, s: score(c) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s || a.c.label.length - b.c.label.length).slice(0, limit).map(x => x.c);
}
