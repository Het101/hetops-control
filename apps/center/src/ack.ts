import type { Entity, ParamsJson } from "@hetops-control/contracts";
import type { EventsDb } from "./events-db.js";
import type { LocalAction } from "./actions.js";

// Gatus 5.37 has no acknowledge or mute API (its only write is external-endpoint results, which would fake a check), so the
// acknowledgement is the center's own record: the check leaves Needs you until `until` or until its status changes.
const HOUR = 3_600_000;
const PARAMS: ParamsJson = { type: "object", additionalProperties: false, properties: {
  hours: { type: "integer", minimum: 1, maximum: 24, default: 4, description: "For how long, in hours" },
  note: { type: "string", maxLength: 200, description: "Why (shown beside it)" } } };
const hhmm = (d: Date) => `${d.toISOString().slice(11, 16)} UTC`;
const failing = (e: Entity) => e.status === "attention" || e.status === "down";

export function gatusAck(db: Pick<EventsDb, "addAck">): LocalAction {
  return {
    descriptor: { id: "gatus.ack", label: "Acknowledge", targets: ["site", "check"], risk: "safe", preview: true, params: PARAMS,
      description: "Takes a failing Gatus check off Needs you for a while. Gatus keeps checking and alerting; only this center stops asking." },
    applies: e => e.source === "gatus" && failing(e),
    preview: (t, p, now) => `Takes ${t.name} off Needs you for ${p.hours} h (until ${hhmm(new Date(now.getTime() + Number(p.hours) * HOUR))}) `
      + `or until it stops being ${t.status}, whichever comes first. Gatus keeps checking it and still sends its own alerts; nothing on ${t.server} changes.`,
    run: (t, p, { actor, now }) => {
      const until = new Date(now.getTime() + Number(p.hours) * HOUR);
      db.addAck({ entity: t.id, server: t.server, status: t.status, actor, at: now.toISOString(), until: until.toISOString(),
        ...(typeof p.note === "string" && p.note.trim() ? { note: p.note.trim() } : {}) });
      return { ok: true, summary: `${t.name} acknowledged until ${hhmm(until)}` };
    },
  };
}
