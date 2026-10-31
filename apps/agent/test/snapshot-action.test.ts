import { describe, it, expect } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { snapshotNow, type EsOperator } from "../src/actions/snapshot.js";
import { describeAction } from "../src/actions/index.js";
// es-slm.json: recorded on hetops-3 (stage 1b Task 2), GET _slm/policy.
// es-slm-execute.json: NOT RECORDED YET. It is the documented response shape of POST _slm/policy/<id>/_execute
// (Elasticsearch 9.5 API reference: {"snapshot_name": ...}). Task 11 replaces it with the recording from hetops-3; this test must still pass.
import slm from "./fixtures/es-slm.json"; import executed from "./fixtures/es-slm-execute.json";

const backup = (name: string, source = "snapshots"): Entity => ({ id: `ops/backup/${name}`, kind: "backup", server: "ops", name, status: "ok", facts: {}, links: [], actions: [], observedAt: "2026-10-31T10:00:00Z", source });
const ctx = { server: "ops" as const, now: () => new Date("2026-10-31T10:00:00Z"), actor: "het@hetops.dev", requestId: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", signal: new AbortController().signal };
const setup = (policies: any = slm) => {
  const calls: string[] = [];
  const op: EsOperator = { execute: async p => { calls.push(p); return executed; } };
  return { calls, a: snapshotNow({ slm: async () => policies, health: async () => ({}), flow: async () => ({}) }, op) };
};

describe("snapshot.now (recorded)", () => {
  it("is offered on the SLM policies only, with no params", () => {
    const { a } = setup();
    expect(a.applies(backup("nightly-all"))).toBe(true);
    expect(a.applies(backup("nightly-all", "kubernetes"))).toBe(false);
    expect(describeAction(a).params.properties).toEqual({});
  });
  it("previews exactly what the policy will snapshot, where to, and that the schedule still runs", async () => {
    const text = await setup().a.preview!(backup("nightly-security"), {}, ctx);
    expect(text).toContain("logs-lab-security, .internal.alerts-security.alerts-*");
    expect(text).toContain("the r2 repository");
    expect(text).toContain("01:45 UTC");
    expect(text).not.toContain("already running");
  });
  it("runs the policy once and returns the snapshot's name", async () => {
    const { a, calls } = setup();
    expect(await a.run(backup("nightly-all"), {}, ctx)).toEqual({ ok: true, ref: executed.snapshot_name,
      summary: `${executed.snapshot_name} started; the Backups page shows it once it finishes` });
    expect(calls).toEqual(["nightly-all"]);
  });
  it("returns the snapshot in progress instead of starting a second one", async () => {
    const busy = structuredClone(slm) as any;
    busy["nightly-all"].in_progress = { name: "nightly-all-2026.10.31-running", uuid: "u", state: "STARTED", start_time_millis: 1761904800000 };
    const { a, calls } = setup(busy);
    expect(await a.run(backup("nightly-all"), {}, ctx)).toMatchObject({ ok: true, already: true, ref: "nightly-all-2026.10.31-running" });
    expect(await a.preview!(backup("nightly-all"), {}, ctx)).toContain("already running");
    expect(calls).toEqual([]);
  });
  it("hands the run's abort signal to both Elasticsearch calls, so the 55 s limit cancels them", async () => {
    const seen: unknown[] = [];
    const a = snapshotNow({ slm: async signal => { seen.push(signal); return slm; }, health: async () => ({}), flow: async () => ({}) },
      { execute: async (_p, signal) => { seen.push(signal); return executed; } });
    await a.run(backup("nightly-all"), {}, ctx);
    expect(seen).toEqual([ctx.signal, ctx.signal]);
  });
  it("refuses a policy that no longer exists, and an answer without a name", async () => {
    await expect(setup().a.run(backup("gone"), {}, ctx)).rejects.toThrow("no SLM policy gone");
    const op: EsOperator = { execute: async () => ({}) };
    const a = snapshotNow({ slm: async () => slm, health: async () => ({}), flow: async () => ({}) }, op);
    await expect(a.run(backup("nightly-all"), {}, ctx)).rejects.toThrow("did not name the snapshot");
  });
});
