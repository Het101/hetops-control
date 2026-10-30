import { z } from "zod"; import { ActionRefSchema, EntitySchema, ServerIdSchema, StatusSchema, type ServerId } from "./entity.js"; import { EventSchema } from "./event.js"; import { SeriesSchema } from "./series.js";
export const ServerViewSchema = z.object({ status: StatusSchema, statusReason: z.string().optional(), reachable: z.boolean(), configured: z.boolean(), lastError: z.string().optional(),
  since: z.string().datetime(), agentVersion: z.string().optional(),
  failingSources: z.array(z.object({ id: z.string(), error: z.string().optional() })).optional() });
// one required key per server id (never-connected ones show as unknown); a z.record would make every key optional
const serverKeys = Object.fromEntries(ServerIdSchema.options.map(s => [s, ServerViewSchema])) as Record<ServerId, typeof ServerViewSchema>;
export const CenterStateSchema = z.object({ generatedAt: z.string().datetime(), servers: z.object(serverKeys).strict(), entities: z.array(EntitySchema), series: z.array(SeriesSchema) });
export const CenterMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), state: CenterStateSchema }),
  z.object({ type: z.literal("event"), event: EventSchema }) ]);
export type ServerView = z.infer<typeof ServerViewSchema>; export type CenterState = z.infer<typeof CenterStateSchema>;
export type CenterMessage = z.infer<typeof CenterMessageSchema>;
// the one-sentence summary the Home page leads with; /api/state and stream states carry it next to the CenterState
export const NeedSchema = z.object({ entity: z.string(), server: ServerIdSchema, text: z.string(), detail: z.string(), action: ActionRefSchema.optional() });
export const HeadlineSchema = z.object({ title: z.string(), emphasis: z.string().optional(), detail: z.string(), needs: z.array(NeedSchema) });
export type Need = z.infer<typeof NeedSchema>; export type Headline = z.infer<typeof HeadlineSchema>;
