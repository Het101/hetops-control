import type { Entity } from "@hetops-control/contracts";
import type { Source } from "../registry.js";
import { json } from "./http.js";

// Alertmanager's API v2, shaped as recorded (test/fixtures/alertmanager-alerts.json).
export interface AlertReader { alerts(): Promise<any[]> }

// silenced and inhibited alerts are muted on purpose (an inhibited info alert is noise its warning already covers)
export const realAlertmanager = (base: string): AlertReader =>
  ({ alerts: () => json(`${base}/api/v2/alerts?active=true&silenced=false&inhibited=false`) });

// always firing by design: Watchdog proves the pipeline works, InfoInhibitor only exists to mute info alerts
const PLUMBING = new Set(["Watchdog", "InfoInhibitor"]);
const SEVERITIES = new Set(["critical", "warning", "info"]);
const LABELS = ["namespace", "job", "service", "pod", "container"] as const;

export function alertmanagerSource(api: AlertReader): Source {
  return {
    id: "alertmanager", periodMs: 30_000,
    async collect({ server, now }) {
      const observedAt = now().toISOString();
      const alerts = await api.alerts();
      if (!Array.isArray(alerts)) throw new Error("alerts is not a list");
      const entities = alerts.filter(a => a?.status?.state === "active" && !PLUMBING.has(a.labels?.alertname)).map((a): Entity => {
        const l = a.labels ?? {}, name = String(l.alertname ?? "alert");
        const facts: Entity["facts"] = { firing: { value: 1 }, severity: { value: SEVERITIES.has(l.severity) ? l.severity : "info" } };
        const since = Date.parse(a.startsAt);
        if (!Number.isNaN(since)) facts.since = { value: new Date(since).toISOString() };
        if (a.annotations?.summary) facts.summary = { value: String(a.annotations.summary).slice(0, 300) };
        for (const k of LABELS) if (typeof l[k] === "string" && l[k]) facts[k] = { value: l[k] };
        // ok here: the center's rule raises a warning or critical alert (apps/center/src/rules.ts)
        return { id: `${server}/alert/${String(a.fingerprint).replace(/[^A-Za-z0-9_.-]+/g, "-")}`, kind: "alert", server,
          name: l.namespace ? `${name} (${l.namespace})` : name, status: "ok", facts, links: [], actions: [], observedAt };
      });
      return { entities };
    },
  };
}
