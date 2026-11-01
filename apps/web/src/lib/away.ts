import type { Event } from "@hetops-control/contracts";
import { heat } from "./pages.js";

/** How long an absence has to be before Home says what happened during it. */
export const AWAY_MS = 2 * 3600_000;
export type Away = { since: number; events: number; recovered: number; waiting: number };

/** What happened while you were away: every event since you left, the incidents that recovered on their own, and the ones
 * still waiting. Undefined for a short absence. events: newest first, as the center serves them. */
export function away(events: Event[], since: number, now: number): Away | undefined {
  if (now - since < AWAY_MS) return undefined;
  const h = heat(events), during = events.filter(e => Date.parse(e.at) > since);
  return { since, events: during.length, recovered: during.filter(e => h.recovered(e)).length, waiting: during.filter(e => h.hot(e)).length };
}

// when you were last here: per browser, kept only as a convenience; blocked storage simply means no "while you were away"
const KEY = "hetops-control.seen";
export const lastSeen = (): number | undefined => { try { const v = Number(localStorage.getItem(KEY)); return v > 0 ? v : undefined; } catch { return undefined; } };
export const markSeen = (t = Date.now()) => { try { localStorage.setItem(KEY, String(t)); } catch { /* not kept */ } };
