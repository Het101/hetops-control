import { describe, it, expect } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { alertSilence, type Silences } from "../src/actions/silence.js";
import { describeAction } from "../src/actions/index.js";
// alertmanager-alerts.json: recorded on the lab (stage 1b Task 3).
// alertmanager-silences.json: NOT RECORDED YET (no server access in this task); `[]`, which is what GET /api/v2/silences answers
// with no silences. The idempotency test adds its own row in Alertmanager's gettableSilence shape.
// alertmanager-silence-created.json: NOT RECORDED YET. It is the documented answer of POST /api/v2/silences (Alertmanager API v2,
// postSilences: {"silenceID": ...}). Task 12 replaces both with the recordings from the lab; this test must still pass.
import alerts from "./fixtures/alertmanager-alerts.json"; import listed from "./fixtures/alertmanager-silences.json"; import created from "./fixtures/alertmanager-silence-created.json";

const first = (alerts as any[])[0];
const alert = (fp = first.fingerprint, source = "alertmanager"): Entity => ({ id: `lab/alert/${fp}`, kind: "alert", server: "lab", name: first.labels.alertname,
  status: "attention", facts: {}, links: [], actions: [], observedAt: "2026-10-31T10:00:00Z", source });
const KEY = "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10";
const ctx = { server: "lab" as const, now: () => new Date("2026-10-31T10:00:00Z"), actor: "het@hetops.dev", requestId: KEY, signal: new AbortController().signal };
const fake = (silences: any[] = listed as any[]) => { const made: any[] = []; const api: Silences = { alerts: async () => alerts as any[], list: async () => silences, create: async s => { made.push(s); return created; } }; return { api, made }; };

describe("alert.silence (recorded)", () => {
  it("is offered on Alertmanager alerts; hours are a choice, capped at 72, the note is bounded", () => {
    const a = alertSilence(fake().api);
    expect(a.applies(alert())).toBe(true); expect(a.applies(alert(first.fingerprint, "gatus"))).toBe(false);
    expect(describeAction(a).params.properties).toEqual({
      hours: { type: "string", enum: ["1", "4", "12", "24", "72"], default: "4", description: "For how long, in hours" },
      note: { type: "string", maxLength: 200, description: "Why (kept with the silence in Alertmanager)" } });
  });
  it("silences exactly this alert: every label, equal, never a regex, with the actor and the request key", async () => {
    const { api, made } = fake();
    const r = await alertSilence(api).run(alert(), { hours: "4", note: "known, fixing" }, ctx);
    expect(r).toEqual({ ok: true, ref: created.silenceID, summary: `${first.labels.alertname} silenced for 4 h, until 14:00 UTC` });
    const labels = Object.keys(first.labels).sort();
    expect(made[0].matchers.map((m: any) => m.name)).toEqual(labels);
    expect(made[0].matchers.every((m: any) => m.isEqual === true && m.isRegex === false && m.value === String(first.labels[m.name]))).toBe(true);
    expect(made[0]).toMatchObject({ startsAt: "2026-10-31T10:00:00.000Z", endsAt: "2026-10-31T14:00:00.000Z", createdBy: "het@hetops.dev",
      comment: `known, fixing [hetops-control ${KEY}]` });
  });
  it("returns the silence it already made under the same request key", async () => {
    const mine = { id: "a1", status: { state: "active" }, comment: `x [hetops-control ${KEY}]`, createdBy: "het@hetops.dev", startsAt: "2026-10-31T10:00:00Z", endsAt: "2026-10-31T14:00:00Z", matchers: [], updatedAt: "2026-10-31T10:00:00Z" };
    const { api, made } = fake([...(listed as any[]), mine]);
    expect(await alertSilence(api).run(alert(), { hours: "4" }, ctx)).toEqual({ ok: true, already: true, ref: "a1", summary: "already silenced until 14:00 UTC" });
    expect(made).toEqual([]);
  });
  it("refuses an alert that stopped firing; the preview lists the exact matchers", async () => {
    const { api } = fake();
    await expect(alertSilence(api).run(alert("0000000000000000"), { hours: "1" }, ctx)).rejects.toThrow("no longer firing");
    expect(await alertSilence(api).preview!(alert(), { hours: "1" }, ctx)).toContain(`alertname="${first.labels.alertname}"`);
  });
  it("hands the run's abort signal to every Alertmanager call, so the 55 s limit cancels them", async () => {
    const seen: unknown[] = [];
    const api: Silences = { alerts: async signal => { seen.push(signal); return alerts as any[]; }, list: async signal => { seen.push(signal); return []; },
      create: async (_s, signal) => { seen.push(signal); return created; } };
    await alertSilence(api).run(alert(), { hours: "1" }, ctx);
    expect(seen).toEqual([ctx.signal, ctx.signal, ctx.signal]);
  });
});
