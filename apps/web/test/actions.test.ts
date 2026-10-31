import { describe, it, expect } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { defaults, fields, offer, type Descriptor } from "../src/lib/actions.js";

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
