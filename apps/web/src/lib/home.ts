import { ServerIdSchema, type Entity, type Event, type Series } from "@hetops-control/contracts";
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
 * The deploy river: every rollout and Argo sync on one time axis, a lane per server. The axis runs from the oldest event held
 * (the log may start there) or 14 days back, whichever is later, to now, so a short history is drawn at its true length instead
 * of as hollow days; `short` says so.
 */
export function deployRiver(events: Event[], now: number, days = 14) {
  const oldest = events.reduce<number | undefined>((m, e) => { const t = Date.parse(e.at); return m === undefined || t < m ? t : m; }, undefined);
  const start = oldest === undefined ? now : Math.max(oldest, now - days * DAY);
  const deps = events.filter(e => isDeploy(e) && Date.parse(e.at) >= start).sort((a, b) => a.at.localeCompare(b.at));
  const lanes = ServerIdSchema.options.map(server => ({ server, deps: deps.filter(e => e.server === server) })).filter(l => l.deps.length);
  return { start, end: now, short: start > now - days * DAY, lanes, total: deps.length };
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

