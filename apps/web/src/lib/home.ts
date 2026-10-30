import type { Entity, Event, Series } from "@hetops-control/contracts";
import type { State } from "./api.js";
import { DAY, sourceState, str } from "./pages.js";

/** Data shaping for the Home modules; pure, so it is unit-tested. */

/**
 * What a module may show for its source: "hidden" when the source has never reported and there is nothing to draw (no mock data
 * in production), "failing" when it reports an error (the module says "can't read", never stale numbers), "empty" when it reports
 * nothing to show, else "ok".
 */
export function moduleState(state: State | undefined, source: string, has: boolean) {
  const s = sourceState(state, source), fail = s.failing[0];
  const mode = fail ? "failing" : has ? "ok" : s.reporting.length ? "empty" : "hidden";
  return { mode, fail } as { mode: "hidden" | "failing" | "empty" | "ok"; fail?: { server: string; error: string } };
}

/** a rollout or an Argo sync is a deploy */
export const isDeploy = (e: Event) => e.kind === "deploy" || e.kind === "sync";

/**
 * Deploys per UTC day for the last `days` days, oldest first. A day before the oldest event held is not known (the log may have
 * been cut there), so it is drawn hollow rather than as a quiet day.
 */
export function deployDays(events: Event[], now: number, days = 14): { day: string; n: number; known: boolean }[] {
  const oldest = events.reduce<string | undefined>((m, e) => (m === undefined || e.at < m ? e.at : m), undefined)?.slice(0, 10);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(now - (days - 1 - i) * DAY).toISOString().slice(0, 10);
    return { day, n: events.filter(e => isDeploy(e) && e.at.startsWith(day)).length, known: oldest !== undefined && day >= oldest };
  });
}

/** apps with a newer commit than the deployed one: the deploys that wait on the owner (the center raises them to attention) */
export const waitingDeploys = (entities: Entity[]) =>
  entities.flatMap(e => { const commit = e.kind === "app" ? str(e, "undeployedCommit") : undefined; return commit ? [{ e, commit: commit.slice(0, 7) }] : []; })
    .sort((a, b) => a.e.name.localeCompare(b.e.name));

/** the latest bucket of a series as a per-minute rate, e.g. "1.3k" */
export function perMinute(s: Series | undefined): string | undefined {
  const last = s?.points.at(-1); if (!s || !last) return undefined;
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(last[1] / (s.stepMs / 60_000)).toLowerCase();
}

/** an uptime strip cell: 90 to 100 % maps to an empty to full bar, as on the Apps page */
export const uptimeFill = (pct: number | undefined) => (pct === undefined ? 0 : Math.min(1, Math.max(0, (pct - 90) / 10)));
