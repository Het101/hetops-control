import { describe, it, expect } from "vitest";
import { ActionDescriptorSchema, ActionRunSchema, AgentStateSchema, CenterMessageSchema, CenterStateSchema, ParamsJsonSchema, checkParams, type ParamsJson } from "../src/index.js";

const schema: ParamsJson = { type: "object", additionalProperties: false, properties: {
  hours: { type: "string", enum: ["1", "4", "24"], default: "4", description: "For how long" },
  note: { type: "string", maxLength: 20 },
  times: { type: "integer", minimum: 1, maximum: 3 },
  hard: { type: "boolean", default: false } }, required: ["times"] };

describe("action params", () => {
  it("accepts what zod-to-json-schema emits for the supported shapes, with its $schema key", () => {
    expect(ParamsJsonSchema.parse({ ...schema, $schema: "http://json-schema.org/draft-07/schema#" }).properties.hours).toEqual(schema.properties.hours);
  });
  it("refuses keywords the form and checkParams do not implement, and free strings without a bound", () => {
    expect(ParamsJsonSchema.safeParse({ ...schema, properties: { x: { type: "string", maxLength: 9, pattern: "^a" } } }).success).toBe(false);
    expect(ParamsJsonSchema.safeParse({ ...schema, properties: { x: { type: "string" } }, required: [] }).success).toBe(false);
    expect(ParamsJsonSchema.safeParse({ ...schema, properties: { x: { type: "array" } }, required: [] }).success).toBe(false);
    expect(ParamsJsonSchema.safeParse({ ...schema, additionalProperties: true }).success).toBe(false);
    expect(ParamsJsonSchema.safeParse({ ...schema, required: ["nope"] }).success).toBe(false);
  });
  it("checkParams fills defaults, keeps valid values and refuses the rest", () => {
    expect(checkParams(schema, { times: 2 })).toEqual({ ok: true, params: { hours: "4", times: 2, hard: false } });
    expect(checkParams(schema, { times: 2, note: "hi", hard: true, hours: "24" })).toEqual({ ok: true, params: { hours: "24", note: "hi", times: 2, hard: true } });
    for (const bad of [{}, { times: 4 }, { times: 1.5 }, { times: 1, hours: "2" }, { times: 1, note: "x".repeat(21) }, { times: 1, hard: "yes" }, { times: 1, extra: 1 }, [], null, "x"])
      expect(checkParams(schema, bad).ok).toBe(false);
  });
});

describe("action contracts", () => {
  const d = { id: "argo.sync", label: "Sync", description: "Asks Argo CD to sync.", targets: ["argo-app"], risk: "safe", preview: true,
    params: { type: "object", properties: {}, additionalProperties: false } };
  const run = { id: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", action: "argo.sync", label: "Sync", server: "lab", target: "lab/argo-app/clinic",
    targetName: "clinic", actor: "het@hetops.dev", params: {}, state: "running", at: "2026-10-31T10:00:00.000Z" };
  it("descriptors: ids are verb.noun, targets are entity kinds, risk is safe or disruptive", () => {
    expect(ActionDescriptorSchema.parse(d)).toEqual(d);
    expect(ActionDescriptorSchema.safeParse({ ...d, id: "rm -rf" }).success).toBe(false);
    expect(ActionDescriptorSchema.safeParse({ ...d, targets: ["planet"] }).success).toBe(false);
    expect(ActionDescriptorSchema.safeParse({ ...d, risk: "spicy" }).success).toBe(false);
  });
  it("agent and center states carry descriptors optionally (old agents still validate)", () => {
    const s = { server: "lab", version: "1", generatedAt: "2026-10-31T10:00:00Z", entities: [], sources: [] };
    expect(AgentStateSchema.parse(s).actions).toBeUndefined();
    expect(AgentStateSchema.parse({ ...s, actions: [d] }).actions).toHaveLength(1);
    const v = { status: "ok", reachable: true, configured: true, since: "2026-10-31T10:00:00Z" };
    const c = { generatedAt: "2026-10-31T10:00:00Z", servers: { lab: v, staging: v, ops: v }, entities: [], series: [] };
    expect(CenterStateSchema.parse({ ...c, actions: [{ ...d, server: "lab" }], acks: [] }).actions![0]!.server).toBe("lab");
  });
  it("a run streams as an action message; its actor is an email-shaped string, its id a UUID", () => {
    expect(CenterMessageSchema.parse({ type: "action", run }).type).toBe("action");
    expect(ActionRunSchema.safeParse({ ...run, id: "1" }).success).toBe(false);
    expect(ActionRunSchema.safeParse({ ...run, actor: "nobody" }).success).toBe(false);
    expect(ActionRunSchema.parse({ ...run, actor: "dev@local" }).actor).toBe("dev@local");   // CONTROL_DEV's identity
  });
});
