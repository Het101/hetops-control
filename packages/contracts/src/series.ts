import { z } from "zod"; import { ServerIdSchema } from "./entity.js";
/** A time series a source reports: points are [epoch ms, value]; capped so a state message stays small. */
export const SeriesSchema = z.object({
  id: z.string().min(1), // e.g. "ops/logs/default"
  server: ServerIdSchema, label: z.string(), unit: z.string(), stepMs: z.number().int().positive(),
  points: z.array(z.tuple([z.number().finite(), z.number().finite()])).max(2000)
    .refine(p => p.every((x, i) => i === 0 || x[0] > p[i - 1]![0]), "timestamps must be strictly increasing"),
  observedAt: z.string().datetime(),
  source: z.string().optional(), // id of the agent source; the center ages by its period
});
/** most series one agent (or the center) may carry; each can be 2000 points and the state is re-sent on every run */
export const MAX_SERIES = 64;
export type Series = z.infer<typeof SeriesSchema>;
