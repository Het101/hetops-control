import { z } from "zod";
import { EntityKindSchema, LinkSchema, ServerIdSchema, StatusSchema, type Entity, type EntityKind, type ServerId } from "./entity.js";

export const RiskSchema = z.enum(["safe", "disruptive"]);
export type Risk = z.infer<typeof RiskSchema>;

/**
 * The JSON Schema subset an action's params may use: a flat object of enums, bounded strings, bounded integers and booleans,
 * as zod-to-json-schema emits them. The web renders a form from it and the center validates with checkParams; the agent's
 * test refuses any action whose zod schema emits more, so the three never disagree.
 */
const help = { description: z.string().max(200).optional() };
const ParamPropSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), enum: z.array(z.string().max(64)).min(1).max(16).optional(), minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().max(500).optional(), default: z.string().optional(), ...help }).strict(),
  z.object({ type: z.literal("integer"), minimum: z.number().int(), maximum: z.number().int(), default: z.number().int().optional(), ...help }).strict(),
  z.object({ type: z.literal("boolean"), default: z.boolean().optional(), ...help }).strict(),
]);
export const ParamsJsonSchema = z.object({
  $schema: z.string().optional(), type: z.literal("object"),
  properties: z.record(z.string().regex(/^[a-z][A-Za-z0-9]{0,31}$/), ParamPropSchema),
  required: z.array(z.string()).optional(), additionalProperties: z.literal(false),
}).strict().superRefine((s, ctx) => {
  if (Object.keys(s.properties).length > 8) ctx.addIssue({ code: "custom", path: ["properties"], message: "at most 8 params" });
  for (const [k, p] of Object.entries(s.properties))
    if (p.type === "string" && !p.enum && p.maxLength === undefined) ctx.addIssue({ code: "custom", path: ["properties", k], message: "a free string needs maxLength" });
  for (const r of s.required ?? []) if (!Object.hasOwn(s.properties, r)) ctx.addIssue({ code: "custom", path: ["required"], message: `${r} is not a property` });
});
export type ParamsJson = z.infer<typeof ParamsJsonSchema>;
export type ParamValue = string | number | boolean;
export type Params = Record<string, ParamValue>;

/** Validates input against an advertised params schema: defaults filled, unknown keys refused. */
export function checkParams(schema: ParamsJson, input: unknown): { ok: true; params: Params } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "params must be an object" };
  const given = input as Record<string, unknown>, out: Params = {};
  for (const k of Object.keys(given)) if (!Object.hasOwn(schema.properties, k)) return { ok: false, error: `unknown param ${k}` };
  for (const [k, p] of Object.entries(schema.properties)) {
    const v = given[k] ?? p.default;
    if (v === undefined) { if (schema.required?.includes(k)) return { ok: false, error: `${k} is required` }; continue; }
    if (p.type === "string") {
      if (typeof v !== "string") return { ok: false, error: `${k} must be text` };
      if (p.enum && !p.enum.includes(v)) return { ok: false, error: `${k} must be one of ${p.enum.join(", ")}` };
      if (p.maxLength !== undefined && v.length > p.maxLength) return { ok: false, error: `${k} is longer than ${p.maxLength}` };
      if (p.minLength !== undefined && v.length < p.minLength) return { ok: false, error: `${k} is shorter than ${p.minLength}` };
    } else if (p.type === "integer") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < p.minimum || v > p.maximum) return { ok: false, error: `${k} must be a whole number from ${p.minimum} to ${p.maximum}` };
    } else if (typeof v !== "boolean") return { ok: false, error: `${k} must be yes or no` };
    out[k] = v as ParamValue;
  }
  return { ok: true, params: out };
}

// an Access email, or CONTROL_DEV's "dev@local" (zod's email() wants a dotted domain)
const ActorSchema = z.string().max(254).regex(/^[^@\s]+@[^@\s]+$/);
const ParamValuesSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

export const ActionDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z]+\.[a-z][a-z-]*$/), label: z.string().min(1).max(40), description: z.string().max(300),
  targets: z.array(EntityKindSchema).min(1), risk: RiskSchema, preview: z.boolean(), params: ParamsJsonSchema });
export type ActionDescriptor = z.infer<typeof ActionDescriptorSchema>;

/** The center → agent body of POST /v1/actions/<id> and /v1/actions/<id>/preview. */
export const ActionRequestSchema = z.object({ target: z.string().min(1).max(256), params: z.record(z.unknown()), actor: ActorSchema, requestId: z.string().uuid() }).strict();
export type ActionRequest = z.infer<typeof ActionRequestSchema>;
/** The browser → center body of POST /api/actions and /api/actions/preview. `confirm` is the typed target name (disruptive only). */
export const ActionCallSchema = z.object({ action: z.string().min(1).max(64), target: z.string().min(1).max(256),
  params: z.record(z.unknown()).default({}), confirm: z.string().max(256).optional() }).strict();
export type ActionCall = z.infer<typeof ActionCallSchema>;
export const ActionPreviewSchema = z.object({ text: z.string().min(1).max(1000) });
export const ActionResultSchema = z.object({ ok: z.boolean(), summary: z.string().min(1).max(300), ref: z.string().max(200).optional(),
  already: z.boolean().optional(), links: z.array(LinkSchema).max(4).optional() });
export type ActionResult = z.infer<typeof ActionResultSchema>;

/** One request, as audited and streamed: running, then succeeded or failed. */
export const ActionRunSchema = z.object({
  id: z.string().uuid(), action: z.string(), label: z.string(), server: ServerIdSchema, target: z.string(), targetName: z.string(),
  actor: ActorSchema, params: ParamValuesSchema, state: z.enum(["running", "succeeded", "failed"]),
  at: z.string().datetime(), finishedAt: z.string().datetime().optional(), result: ActionResultSchema.optional(), error: z.string().max(300).optional() });
export type ActionRun = z.infer<typeof ActionRunSchema>;

/** A center-side acknowledgement (gatus.ack): holds while the entity keeps `status` and until `until`. */
export const AckSchema = z.object({ entity: z.string(), server: ServerIdSchema, status: StatusSchema, actor: ActorSchema,
  at: z.string().datetime(), until: z.string().datetime(), note: z.string().max(200).optional() });
export type Ack = z.infer<typeof AckSchema>;

export type ActionContext = { server: ServerId; now: () => Date; actor: string; requestId: string; signal: AbortSignal };
/** An agent-side verb. Its zod params are published as JSON Schema; `applies` picks the entities that offer it. */
export interface Action<P extends Params = Params> {
  id: string; label: string; description: string; targets: EntityKind[]; risk: Risk;
  params: z.ZodType<P, z.ZodTypeDef, unknown>;
  applies(e: Entity): boolean;
  preview?(target: Entity, params: P, ctx: ActionContext): Promise<string>;
  run(target: Entity, params: P, ctx: ActionContext): Promise<ActionResult>;
}
