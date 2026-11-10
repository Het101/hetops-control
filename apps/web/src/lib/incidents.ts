import type { Event, Status } from "@hetops-control/contracts";
import { needsYou } from "./pages.js";

/** One incident: a thing that fell (attention or down), everything that happened to it meanwhile, and when it came back */
export type Thread = { kind: "thread"; key: string; server: Event["server"]; entity: string; events: Event[]; opened: string;
  closed?: string; lasted?: number; worst: Status; actions: number };
export type Item = Thread | { kind: "event"; e: Event };

const RANK: Partial<Record<Status, number>> = { down: 2, attention: 1 };

/** Fold events (newest first, as the center serves them) into incidents and plain events, newest activity first.
 An incident opens on a move to attention or down, takes the restarts, actions and status changes of the same entity on the
 same server, and closes when that entity moves back to ok. Anything with nothing open stays a plain event. */
export function threads(events: Event[]): Item[] {
  const open = new Map<string, Thread>(), out: { item: Item; last: string }[] = [];
  for (const e of [...events].reverse()) {
    const key = e.entity ? `${e.server}|${e.entity}` : "", t = key ? open.get(key) : undefined;
    if (t) {
      t.events.push(e);
      if (e.kind === "action") t.actions++;
      if (needsYou(e.level) && (RANK[e.level!] ?? 0) > (RANK[t.worst] ?? 0)) t.worst = e.level!;
      if (e.level && !needsYou(e.level)) { t.closed = e.at; t.lasted = Date.parse(e.at) - Date.parse(t.opened); open.delete(key); }
      continue;
    }
    if (key && needsYou(e.level)) {
      const n: Thread = { kind: "thread", key: `${key}|${e.at}`, server: e.server, entity: e.entity!, events: [e], opened: e.at, worst: e.level!, actions: 0 };
      open.set(key, n); out.push({ item: n, last: e.at });
      continue;
    }
    out.push({ item: { kind: "event", e }, last: e.at });
  }
  // an incident sorts by its latest step, so a recovery brings it back to the top
  for (const o of out) if (o.item.kind === "thread") o.last = o.item.events.at(-1)!.at;
  return out.sort((a, b) => b.last.localeCompare(a.last)).map(o => o.item);
}
