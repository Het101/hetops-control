import { describe, it, expect, vi } from "vitest";
import type { ActionRun, Entity } from "@hetops-control/contracts";
import { countdown, defaults, fields, merge, middle, offer, toastOf, type Descriptor } from "../src/lib/actions.js";

const silence: Descriptor = { server: "lab", id: "alert.silence", label: "Silence", description: "d", targets: ["alert"], risk: "safe", preview: true,
  params: { type: "object", additionalProperties: false, properties: {
    hours: { type: "string", enum: ["1", "4"], default: "4", description: "For how long, in hours" }, note: { type: "string", maxLength: 200 },
    times: { type: "integer", minimum: 1, maximum: 3 }, hardRefresh: { type: "boolean", default: false } } } };
const alert: Entity = { id: "lab/alert/abc", kind: "alert", server: "lab", name: "KubeQuota", status: "attention", facts: {}, links: [],
  actions: [{ id: "alert.silence", label: "Silence", risk: "safe" }], observedAt: "2026-10-31T10:00:00Z" };

describe("action forms", () => {
  it("turns the params schema into fields", () => {
    expect(fields(silence.params)).toEqual([
      { key: "hours", label: "Hours", help: "For how long, in hours", kind: "choice", options: ["1", "4"] },
      { key: "note", label: "Note", kind: "text", max: 200 },
      { key: "times", label: "Times", kind: "number", min: 1, max: 3 },
      { key: "hardRefresh", label: "Hard refresh", kind: "toggle" }]);
    expect(defaults(silence.params)).toEqual({ hours: "4", hardRefresh: false });
  });
  it("offers an action only when the entity carries it and its own server describes it", () => {
    expect(offer(alert, "alert.silence", [silence])).toEqual({ ref: alert.actions[0], descriptor: silence });
    expect(offer(alert, undefined, [silence])?.ref.id).toBe("alert.silence");                // the first one
    expect(offer(alert, "alert.silence", [{ ...silence, server: "ops" }])).toBeUndefined();  // another server's descriptor
    expect(offer({ ...alert, actions: [] }, "alert.silence", [silence])).toBeUndefined();
  });
});

describe("toasts", () => {
  const run = (p: Partial<ActionRun> = {}): ActionRun => ({ id: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", action: "snapshot.now", label: "Snapshot now", server: "ops",
    target: "ops/backup/nightly-all", targetName: "nightly-all", actor: "het@hetops.dev", params: {}, state: "running", at: "2026-10-31T19:13:02.000Z", ...p });
  const name = "nightly-all-2026.10.31-sj23udz2tsmlglae5shriw";
  const done = run({ state: "succeeded", finishedAt: "2026-10-31T19:13:04.000Z", result: { ok: true, summary: "Snapshot started", ref: name } });

  it("truncates a ref in the middle, keeping its head and the last 6", () => {
    expect(middle(name)).toBe("nightly-all-2026.10.31-sj23…5shriw");
    expect(middle(name)).toHaveLength(34);
    expect(middle("a1b2c3d4")).toBe("a1b2c3d4");
    expect(middle("x".repeat(34))).toBe("x".repeat(34));
    expect(middle("abcdefghijkl", 7)).toBe("abc…jkl");
  });
  it("running, then done in place; a late running answer never undoes it", () => {
    const other = run({ id: "11111111-1111-4111-8111-111111111111", targetName: "nightly-security" });
    let list = merge([], run()); list = merge(list, other);
    expect(list.map(r => r.targetName)).toEqual(["nightly-security", "nightly-all"]);
    list = merge(list, done);
    expect(list.map(r => [r.targetName, r.state])).toEqual([["nightly-security", "running"], ["nightly-all", "succeeded"]]);
    expect(merge(list, run())).toBe(list);
    expect(merge(Array.from({ length: 8 }, (_, i) => run({ id: `${i}` })), other)).toHaveLength(8);
  });
  it("says each state in plain words, the id apart", () => {
    expect(toastOf(run())).toEqual({ tone: "running", title: "Snapshot now…", line: "nightly-all on ops · 19:13 UTC", refName: "snapshot name", next: { href: "/backups", label: "Backups" } });
    expect(toastOf(done)).toEqual({ tone: "done", title: "Snapshot started", line: "nightly-all on ops · 19:13 UTC", ref: name, refName: "snapshot name", next: { href: "/backups", label: "Backups" } });
    expect(toastOf(run({ state: "failed", finishedAt: "2026-10-31T19:14:00.000Z", error: "no SLM policy nightly-all" }))).toMatchObject(
      { tone: "failed", title: "Snapshot now failed", detail: "No SLM policy nightly-all", line: "nightly-all on ops · 19:14 UTC" });
    // no answer is not a failure: the title says what is known, the detail what to check
    expect(toastOf(run({ state: "failed", finishedAt: "2026-10-31T19:14:00.000Z", error: "no answer in 60 s; the result is unknown, check nightly-all" }))).toMatchObject(
      { tone: "failed", title: "No answer from ops", detail: "No answer in 60 s; the result is unknown, check nightly-all" });
    expect(toastOf(run({ state: "failed", finishedAt: "2026-10-31T19:14:00.000Z", error: "the center restarted before the agent answered; the result is unknown" })).title)
      .toBe("No answer from ops");
    expect(toastOf(run({ target: "ops/cluster", targetName: "cluster" })).next).toBeUndefined();
  });
  it("counts down, holds while paused, and resumes with the time left", () => {
    vi.useFakeTimers();
    try {
      let fired = 0; const c = countdown(6000, () => fired++);
      vi.advanceTimersByTime(4000); c.pause(); vi.advanceTimersByTime(60_000); expect(fired).toBe(0);
      c.resume(); vi.advanceTimersByTime(1999); expect(fired).toBe(0); vi.advanceTimersByTime(1); expect(fired).toBe(1);
      const s = countdown(100, () => fired++); s.stop(); vi.advanceTimersByTime(500); expect(fired).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});
