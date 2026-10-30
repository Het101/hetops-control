import { z } from "zod"; import { ServerIdSchema } from "./entity.js";
/** A time series a source reports: points are [epoch ms, value]; capped so a state message stays small. */
export const SeriesSchema = z.object({
  id: z.string().min(1), // e.g. "ops/logs/default"
  server: ServerIdSchema, label: z.string(), unit: z.string(), stepMs: z.number().int().positive(),
  points: z.array(z.tuple([z.number(), z.number()])).max(2000),
  observedAt: z.string().datetime(),
  source: z.string().optional(), // id of the agent source; the center ages by its period
});
export type Series = z.infer<typeof SeriesSchema>;
