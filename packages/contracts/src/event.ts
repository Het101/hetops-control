import { z } from "zod"; import { ServerIdSchema } from "./entity.js";
export const EventSchema = z.object({ at: z.string().datetime(), server: ServerIdSchema, source: z.string(),
  kind: z.enum(["status", "restart", "deploy", "sync", "action", "info"]), summary: z.string(),
  entity: z.string().optional(), actor: z.string().optional() });
export type Event = z.infer<typeof EventSchema>;
