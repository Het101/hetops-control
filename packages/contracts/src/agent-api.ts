import { z } from "zod"; import { EntitySchema, ServerIdSchema } from "./entity.js"; import { EventSchema } from "./event.js";
export const SourceReportSchema = z.object({ id: z.string(), periodMs: z.number().int().positive(), ok: z.boolean(),
  lastRunAt: z.string().datetime().optional(), error: z.string().optional() });
export const AgentStateSchema = z.object({ server: ServerIdSchema, version: z.string(), generatedAt: z.string().datetime(),
  entities: z.array(EntitySchema), sources: z.array(SourceReportSchema) });
export const StreamMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), state: AgentStateSchema }),
  z.object({ type: z.literal("event"), event: EventSchema }) ]);
export type SourceReport = z.infer<typeof SourceReportSchema>; export type AgentState = z.infer<typeof AgentStateSchema>;
export type StreamMessage = z.infer<typeof StreamMessageSchema>;
