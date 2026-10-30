import { z } from "zod"; import { EntitySchema, ServerIdSchema, StatusSchema, type ServerId } from "./entity.js"; import { EventSchema } from "./event.js";
export const ServerViewSchema = z.object({ status: StatusSchema, statusReason: z.string().optional(), reachable: z.boolean(),
  since: z.string().datetime(), agentVersion: z.string().optional(),
  failingSources: z.array(z.object({ id: z.string(), error: z.string().optional() })).optional() });
// one required key per server id (never-connected ones show as unknown); a z.record would make every key optional
const serverKeys = Object.fromEntries(ServerIdSchema.options.map(s => [s, ServerViewSchema])) as Record<ServerId, typeof ServerViewSchema>;
export const CenterStateSchema = z.object({ generatedAt: z.string().datetime(), servers: z.object(serverKeys).strict(), entities: z.array(EntitySchema) });
export const CenterMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), state: CenterStateSchema }),
  z.object({ type: z.literal("event"), event: EventSchema }) ]);
export type ServerView = z.infer<typeof ServerViewSchema>; export type CenterState = z.infer<typeof CenterStateSchema>;
export type CenterMessage = z.infer<typeof CenterMessageSchema>;
