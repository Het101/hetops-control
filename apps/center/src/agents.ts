import { Agent, fetch } from "undici";
import { AgentStateSchema, StreamMessageSchema, type AgentState, type Event, type ServerId } from "@hetops-control/contracts";
import type { Store } from "./store.js";
import type { EventsDb } from "./events-db.js";

const SILENCE_MS = 20_000; // the agent pings every 15 s
const BACKOFF_MIN_MS = 1_000, BACKOFF_MAX_MS = 30_000;
const MAX_PENDING = 1 << 20; // 1 MiB of SSE text without a complete message drops the connection

/** 1 s doubling per failed attempt, ±20 % jitter, never above 30 s. */
export const backoffMs = (attempt: number, rand = Math.random) =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(attempt, 30) * (0.8 + rand() * 0.4));

/** One agent's feed into the store: GET /v1/state, then follow /v1/stream; reconnects with jittered backoff. */
export class AgentLink {
  private dispatcher?: Agent;
  private gen = 0; // each start() owns one generation; a loop from an older one exits
  private active = false;
  private ac?: AbortController;
  private wake?: () => void;
  private lastHeard?: Date;

  constructor(private server: ServerId, private url: string, private token: string, private ca?: Buffer) {}

  start(store: Store, db: EventsDb): void {
    if (this.active) return;
    this.active = true;
    const g = ++this.gen;
    if (this.ca) this.dispatcher = new Agent({ connect: { ca: this.ca } });
    this.loop(g, store, db).catch(e => console.error(`agent ${this.server}: link loop failed: ${describe(e)}`));
  }

  stop(): void {
    this.active = false; this.gen++;
    this.ac?.abort(); this.wake?.();
    void this.dispatcher?.close().catch(() => {}); this.dispatcher = undefined;
  }

  private async loop(g: number, store: Store, db: EventsDb) {
    const live = () => this.gen === g;
    // the store and the DB are ours, not the agent's: their failures are logged and never end the session
    const keep = (e: Event) => {
      try { db.add(e); } catch (err) { console.error(`events db: ${err instanceof Error ? err.message : String(err)}`); }
    };
    let attempt = 0;
    while (live()) {
      try { await this.session(store, keep, () => { attempt = 0; }); }
      catch (e) { if (live()) console.error(`agent ${this.server}: ${describe(e)}`); }
      if (!live()) break;
      for (const ev of store.markUnreachable(this.server, this.lastHeard ?? new Date())) keep(ev);
      const ms = backoffMs(attempt++);
      await new Promise<void>(r => { const t = setTimeout(r, ms); this.wake = () => { clearTimeout(t); r(); }; });
    }
  }

  /** Resolves when the stream ends, rejects on any link error; aborts after SILENCE_MS without a byte. */
  private async session(store: Store, keep: (e: Event) => void, connected: () => void) {
    const ac = this.ac = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const kick = () => { clearTimeout(timer); timer = setTimeout(() => ac.abort(new Error(`silent for ${SILENCE_MS / 1000} s`)), SILENCE_MS); };
    const heard = () => { this.lastHeard = new Date(); kick(); };
    const get = async (path: string) => {
      const res = await fetch(this.url + path, { headers: { authorization: `Bearer ${this.token}` }, signal: ac.signal, dispatcher: this.dispatcher });
      if (!res.ok || !res.body) throw new Error(`${path}: HTTP ${res.status}`); // the finally's abort releases the body
      return res;
    };
    const apply = (s: AgentState) => {
      if (s.server !== this.server) throw new Error(`agent reports server ${s.server}, expected ${this.server}`);
      for (const ev of store.apply(this.server, s)) keep(ev);
    };
    try {
      kick();
      apply(AgentStateSchema.parse(await (await get("/v1/state")).json()));
      heard(); connected();
      const body = (await get("/v1/stream")).body!;
      const dec = new TextDecoder(); let buf = "", data: string[] = [], dataLen = 0;
      for await (const chunk of body) {
        heard(); buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
          if (line.startsWith("data:")) { const d = line.slice(5).replace(/^ /, ""); data.push(d); dataLen += d.length; }
          else if (line === "" && data.length) { // blank line ends a message; ":" comments and other fields are ignored
            const raw = data.join("\n"); data = []; dataLen = 0;
            const m = StreamMessageSchema.safeParse(safeJson(raw));
            if (!m.success) { console.error(`agent ${this.server}: dropped an invalid stream message`); continue; }
            if (m.data.type === "state") apply(m.data.state);
            else if (m.data.event.server === this.server) { keep(m.data.event); store.record(m.data.event); }
          }
        }
        if (buf.length + dataLen > MAX_PENDING) throw new Error("stream message exceeds 1 MiB");
      }
    } finally { clearTimeout(timer); ac.abort(); }
  }
}

const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return undefined; } };
// undici hides the reason (refused, TLS, reset) in `cause`
const describe = (e: unknown): string => e instanceof Error ? e.message + (e.cause ? `: ${describe(e.cause)}` : "") : String(e);
