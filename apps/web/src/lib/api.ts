import { z } from "zod";
import { ActionRefSchema, CenterStateSchema, EventSchema, ServerIdSchema, type Event } from "@hetops-control/contracts";

// owned by the center (headline.ts); mirrored here until it moves into contracts
export const HeadlineSchema = z.object({ title: z.string(), emphasis: z.string().optional(), detail: z.string(),
  needs: z.array(z.object({ entity: z.string(), server: ServerIdSchema, text: z.string(), detail: z.string(), action: ActionRefSchema.optional() })) });
export const StateSchema = CenterStateSchema.extend({ headline: HeadlineSchema });
const MessageSchema = z.discriminatedUnion("type", [
  // a stream state may omit the headline; the last one is kept
  z.object({ type: z.literal("state"), state: CenterStateSchema.extend({ headline: HeadlineSchema.optional() }) }),
  z.object({ type: z.literal("event"), event: EventSchema }) ]);
export type Headline = z.infer<typeof HeadlineSchema>; export type State = z.infer<typeof StateSchema>;

export type Handlers = { state: (s: State) => void; event: (e: Event) => void; link: (open: boolean) => void };

async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return schema.parse(await r.json());
}
export const loadState = () => get("/api/state", StateSchema);
export const loadEvents = (limit: number) => get(`/api/events?limit=${limit}`, z.array(EventSchema));

/** Loads the state, then follows /api/stream; re-opens it (and reloads the state) whenever it drops. Returns a stop function. */
export function follow(on: Handlers): () => void {
  let es: EventSource | undefined, retry: ReturnType<typeof setTimeout> | undefined, stopped = false, last: State | undefined;
  // fetches and the stream can cross; never step back to an older snapshot
  const take = (s: State) => { if (last && s.generatedAt < last.generatedAt) return; last = s; on.state(s); };
  const open = () => {
    es = new EventSource("/api/stream");
    // every (re)connect reloads the state: what changed while the stream was down is in it
    es.onopen = () => { on.link(true); loadState().then(take, e => console.warn(e)); };
    es.onmessage = m => {
      let raw: unknown; try { raw = JSON.parse(m.data); } catch { return console.warn("stream: not JSON"); }
      const parsed = MessageSchema.safeParse(raw);
      if (!parsed.success) { console.warn("stream: unexpected message", parsed.error.issues); return; }
      const msg = parsed.data;
      if (msg.type === "event") return on.event(msg.event);
      const headline = msg.state.headline ?? last?.headline;
      if (headline) take({ ...msg.state, headline });
    };
    es.onerror = () => {
      on.link(false);
      // the browser retries a dropped stream itself; a refused one (CLOSED) is ours to re-open
      if (es?.readyState === EventSource.CLOSED && !stopped) { es.close(); retry = setTimeout(open, 3000); }
    };
  };
  loadState().then(take, e => console.warn(e));
  open();
  return () => { stopped = true; clearTimeout(retry); es?.close(); };
}

/** A numeric fact, or undefined when absent or not a number. */
export function num(e: { facts: Record<string, { value: unknown }> } | undefined, key: string): number | undefined {
  const v = e?.facts[key]?.value; return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
