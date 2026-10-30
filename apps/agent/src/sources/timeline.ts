import type { Event } from "@hetops-control/contracts";
import type { Source } from "../registry.js";
import { json } from "./http.js";

// The Change Timeline's owner feed (port 8081, every event including private ones), shaped as recorded
// (test/fixtures/timeline-owner.json): newest first, each with a stable id.
export interface TimelineReader { list(): Promise<any[]> }
export const realTimeline = (base: string): TimelineReader => ({ list: () => json(`${base}/owner/timeline?since=1h`) });

const KIND: Record<string, Event["kind"]> = { rollout: "deploy", sync: "sync", restart: "restart" };
const LEVEL: Record<string, Event["level"]> = { warn: "attention", crit: "down" };
const PERIOD = 30_000;

/**
 * Passes on each timeline event once. The center stores every event it gets, so ids already sent are remembered (only those still
 * in the feed's window, so the set stays bounded). After a restart the memory is empty: only the last two periods are sent again.
 */
export function timelineSource(api: TimelineReader): Source {
  let sent: Set<string> | undefined;
  return {
    id: "timeline", periodMs: PERIOD,
    async collect({ server, now }) {
      const rows = await api.list();
      if (!Array.isArray(rows)) throw new Error("timeline is not a list");
      const floor = sent ? -Infinity : now().getTime() - 2 * PERIOD;
      const seen = new Set<string>(), events: Event[] = [];
      for (const r of rows) {
        const id = typeof r?.id === "string" ? r.id : "", at = Date.parse(r?.at);
        if (!id || Number.isNaN(at) || typeof r.summary !== "string") continue;
        seen.add(id);
        if (sent?.has(id) || at < floor) continue;
        const level = LEVEL[r.severity];
        events.push({ at: new Date(at).toISOString(), server, source: "timeline", kind: KIND[r.kind] ?? "info", summary: r.summary.slice(0, 300),
          ...(typeof r.actor === "string" ? { actor: r.actor } : {}), ...(level ? { level } : {}) });
      }
      sent = seen;
      return { entities: [], events: events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) };
    },
  };
}
