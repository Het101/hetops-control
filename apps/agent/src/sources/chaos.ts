import type { Entity, Status } from "@hetops-control/contracts";
import type { Source } from "../registry.js";
import { json } from "./http.js";

// chaos-api's GET /chaos/status, shaped as recorded (test/fixtures/chaos-status.json). slo is null when chaos-api cannot read Prometheus.
export interface ChaosReader { status(): Promise<any> }
export const realChaos = (base: string): ChaosReader => ({ status: () => json(`${base}/chaos/status`) });

// the lab SLO (hetops-k8s-lab platform/monitoring/extras/slo-rules.yaml): 99% of synthetic visits good over 7 days
const OBJECTIVE = 99, WINDOW_DAYS = 7;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function sloSource(api: ChaosReader): Source {
  return {
    id: "slo", periodMs: 30_000,
    async collect({ server, now }) {
      const s = await api.status();
      if (!s || typeof s !== "object" || !("slo" in s)) throw new Error("status: no slo field");
      const facts: Entity["facts"] = { objective: { value: OBJECTIVE, unit: "%", max: 100 }, windowDays: { value: WINDOW_DAYS, unit: "d" },
        chaosEnabled: { value: s.enabled === true } };
      let status: Status = "ok", statusReason: string | undefined;
      const budget = num(s.slo?.budget);
      if (s.slo === null) { status = "unknown"; statusReason = "chaos-api has no reading from Prometheus"; }
      else if (budget === undefined) throw new Error("status: slo.budget is not a number");
      else {
        // budget is 1 untouched, 0 spent, below 0 when the SLO is broken; the center raises an slo at <= 0 (rules.ts)
        facts.budgetLeft = { value: round(budget * 100, 1), unit: "%", max: 100 };
        const sli = num(s.slo.sli7d), b5 = num(s.slo.burn5m), b1 = num(s.slo.burn1h);
        if (sli !== undefined) facts.current = { value: round(sli * 100, 3), unit: "%", max: 100 };
        if (b5 !== undefined) facts.burn5m = { value: round(b5, 2), unit: "x" };
        if (b1 !== undefined) facts.burn1h = { value: round(b1, 2), unit: "x" };
        facts.frozen = { value: s.slo.frozen === true };
        if (s.slo.frozen === true) { status = "attention"; statusReason = "visitor chaos is frozen until the error budget recovers"; }
      }
      return { entities: [{ id: `${server}/slo/lab-visits`, kind: "slo", server, name: "Lab visits", status,
        ...(statusReason ? { statusReason } : {}), facts, links: [], actions: [], observedAt: now().toISOString() }] };
    },
  };
}
