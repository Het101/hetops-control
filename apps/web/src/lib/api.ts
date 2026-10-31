import { z } from "zod";
import { ActionRunSchema, CenterStateSchema, EventSchema, HeadlineSchema, MeSchema, type ActionRun, type Event, type Headline } from "@hetops-control/contracts";

export type { Headline };
export const StateSchema = CenterStateSchema.extend({ headline: HeadlineSchema });
const MessageSchema = z.discriminatedUnion("type", [
  // a stream state may omit the headline; the last one is kept
  z.object({ type: z.literal("state"), state: CenterStateSchema.extend({ headline: HeadlineSchema.optional() }) }),
  z.object({ type: z.literal("event"), event: EventSchema }),
  z.object({ type: z.literal("action"), run: ActionRunSchema }) ]);
export type State = z.infer<typeof StateSchema>;

/** The center pings (and re-sends the state) every 15 s; twice that in silence means the stream is dead even if the socket is not. */
export const SILENCE_MS = 30_000;

export type Handlers = {
  state: (s: State) => void; event: (e: Event) => void; link: (open: boolean) => void;
  /** the latest events, on start and after every reconnect (what happened while the stream was down) */
  events: (list: Event[]) => void; eventsFailed: (err: unknown) => void;
  /** an action run moved (started, finished) */
  action: (r: ActionRun) => void;
};

async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return schema.parse(await r.json());
}
export const loadState = () => get("/api/state", StateSchema);
export const loadMe = () => get("/api/me", MeSchema);
export const loadEvents = (limit: number) => get(`/api/events?limit=${limit}`, z.array(EventSchema));

const eventKey = (e: Event) => `${e.at}|${e.server}|${e.summary}|${e.entity ?? ""}`;
/** Newest first, no duplicates; the copy already held wins (a stream copy carries fields the log may not). */
export function mergeEvents(held: Event[], incoming: Event[], keep: number): Event[] {
  const seen = new Map(held.map(e => [eventKey(e), e]));
  for (const e of incoming) if (!seen.has(eventKey(e))) seen.set(eventKey(e), e);
  return [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, keep);
}

/**
 * Loads the state and events, then follows /api/stream. Every (re)connect reloads both. A refused stream is re-opened
 * after 3 s; a silent one (no message for SILENCE_MS) is closed and re-opened. Returns a stop function.
 */
export function follow(on: Handlers, eventLimit: number): () => void {
  let es: EventSource | undefined, retry: ReturnType<typeof setTimeout> | undefined, stopped = false, last: State | undefined, heard = Date.now();
  // fetches and the stream can cross; never step back to an older snapshot
  const take = (s: State) => { if (last && s.generatedAt < last.generatedAt) return; last = s; on.state(s); };
  const reload = () => {
    loadState().then(take, e => console.warn(e));
    loadEvents(eventLimit).then(on.events, on.eventsFailed);
  };
  const open = () => {
    heard = Date.now();
    es = new EventSource("/api/stream");
    es.onopen = () => { heard = Date.now(); on.link(true); reload(); };
    es.onmessage = m => {
      heard = Date.now();
      let raw: unknown; try { raw = JSON.parse(m.data); } catch { return console.warn("stream: not JSON"); }
      const parsed = MessageSchema.safeParse(raw);
      if (!parsed.success) { console.warn("stream: unexpected message", parsed.error.issues); return; }
      const msg = parsed.data;
      if (msg.type === "event") return on.event(msg.event);
      if (msg.type === "action") return on.action(msg.run);
      const headline = msg.state.headline ?? last?.headline;
      if (headline) take({ ...msg.state, headline });
    };
    es.onerror = () => {
      on.link(false);
      // the browser retries a dropped stream itself; a refused one (CLOSED) is ours to re-open
      if (es?.readyState === EventSource.CLOSED && !stopped) { es.close(); clearTimeout(retry); retry = setTimeout(open, 3000); }
    };
  };
  const watchdog = setInterval(() => {
    if (stopped || Date.now() - heard < SILENCE_MS) return;
    es?.close(); clearTimeout(retry); on.link(false); open();
  }, 5000);
  reload();
  open();
  return () => { stopped = true; clearTimeout(retry); clearInterval(watchdog); es?.close(); };
}

/** A numeric fact, or undefined when absent or not a number. */
export function num(e: { facts: Record<string, { value: unknown }> } | undefined, key: string): number | undefined {
  const v = e?.facts[key]?.value; return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
