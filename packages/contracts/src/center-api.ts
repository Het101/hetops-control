import { z } from "zod"; import { EntitySchema, StatusSchema } from "./entity.js"; import { EventSchema } from "./event.js";
export const ServerViewSchema = z.object({ status: StatusSchema, reachable: z.boolean(), since: z.string().datetime(), agentVersion: z.string().optional() });
// every server is always present (never-connected ones as unknown), so keys are explicit rather than a partial record
export const CenterStateSchema = z.object({ generatedAt: z.string().datetime(),
  servers: z.object({ lab: ServerViewSchema, staging: ServerViewSchema, ops: ServerViewSchema }), entities: z.array(EntitySchema) });
export const CenterMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), state: CenterStateSchema }),
  z.object({ type: z.literal("event"), event: EventSchema }) ]);
export type ServerView = z.infer<typeof ServerViewSchema>; export type CenterState = z.infer<typeof CenterStateSchema>;
export type CenterMessage = z.infer<typeof CenterMessageSchema>;
