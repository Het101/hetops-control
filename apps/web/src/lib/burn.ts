import type { ActionRun, Entity, Event, ServerId, ServerView } from "@hetops-control/contracts";

/**
 * The five states of Fire line (docs/specs/2026-11-10-fire-line.md). Every mark on the map and every register entry is in
 * exactly one, and each is read from a signal the center already sends; nothing here is decoration.
 */
export type Burn = "fire" | "rain" | "steam" | "fog" | "calm";
/** why an entity is in its state, in a few words, for the tree's title and the register */
export type Reading = { burn: Burn; hot: boolean; why?: string };

/** steam lasts as long as a restart counts as recent on the agent (kubernetes.ts RECENT) */
export const STEAM_MS = 30 * 60_000;
/** ready pods that just climbed keep their rain this long: the agent reports every 15 to 30 s */
export const RISE_MS = 2 * 60_000;

/** ready pods per app at the last reading, and when they last climbed; held across states by the caller */
export type Rising = Map<string, { ready: number; rose?: number }>;

const ready = (e: Entity) => (typeof e.facts.pods?.value === "number" ? e.facts.pods.value : undefined);

/** Records each app's ready pods and returns the ids whose count climbed within RISE_MS. */
export function climb(memory: Rising, entities: Entity[], now: number): Set<string> {
  const out = new Set<string>();
  for (const e of entities) {
    if (e.kind !== "app") continue;
    const r = ready(e); if (r === undefined) continue;
    const was = memory.get(e.id), rose = was && r > was.ready ? now : was?.rose;
    memory.set(e.id, { ready: r, ...(rose !== undefined ? { rose } : {}) });
    if (rose !== undefined && now - rose < RISE_MS) out.add(e.id);
  }
  return out;
}

/** The Argo app that deploys a grove: this lab names each Argo app after its namespace (a name match, not a link the agent sends). */
const argoFor = (e: Entity, all: Entity[]) => {
  const ns = e.facts.namespace?.value;
  return typeof ns === "string" ? all.find(a => a.kind === "argo-app" && a.server === e.server && a.name === ns) : undefined;
};
const syncing = (a?: Entity) => !!a && a.facts.sync?.value !== "Synced" && a.facts.health?.value === "Progressing";

export type BurnInput = {
  entities: Entity[]; servers: Record<ServerId, ServerView>; runs: ActionRun[]; events: Event[]; now: number;
  /** app ids whose ready pods just climbed (climb()) */
  rising?: Set<string>;
};

/** Each entity's state. The order of the checks is the order of truth: can't see, being put out, burning, just out, calm. */
export function burn(e: Entity, i: BurnInput): Reading {
  const view = i.servers[e.server];
  if (!view?.reachable) return { burn: "fog", hot: false, why: view?.configured ? "server unreachable" : "agent not connected" };
  if (e.status === "unknown") return { burn: "fog", hot: false, why: e.statusReason ?? "no reading" };

  const run = i.runs.find(r => r.target === e.id && r.state === "running");
  if (run) return { burn: "rain", hot: false, why: `${run.label} running` };
  const failed = i.runs.find(r => r.target === e.id && r.state === "failed" && e.status !== "ok");

  if (e.status === "attention" || e.status === "down") {
    if (e.kind === "app" && syncing(argoFor(e, i.entities))) return { burn: "rain", hot: false, why: "Argo is syncing" };
    if (i.rising?.has(e.id)) return { burn: "rain", hot: false, why: "pods coming back" };
    return { burn: "fire", hot: e.status === "down", why: failed ? `${failed.label} did not take: ${failed.error ?? "failed"}` : e.statusReason };
  }

  const back = i.events.find(v => v.entity === e.id && v.kind === "status" && v.level === "ok" && i.now - Date.parse(v.at) < STEAM_MS);
  if (back) return { burn: "steam", hot: false, why: `back at ${back.at.slice(11, 16)}` };
  return { burn: "calm", hot: false };
}

/** The states of many entities at once, by id. */
export const burnAll = (i: BurnInput, of: Entity[] = i.entities) => new Map(of.map(e => [e.id, burn(e, i)]));

/** How a whole server or grove reads: the most urgent state among its members (fire, rain, steam, calm); fog only if all are fog. */
export function overall(rs: Reading[]): Burn {
  if (!rs.length) return "fog";
  for (const b of ["fire", "rain", "steam", "calm"] as const) if (rs.some(r => r.burn === b)) return b;
  return "fog";
}
