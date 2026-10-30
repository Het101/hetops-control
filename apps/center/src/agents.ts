import { Agent, fetch, type Dispatcher } from "undici";
import { AgentStateSchema, StreamMessageSchema, type AgentState, type ServerId } from "@hetops-control/contracts";
import type { Store } from "./store.js";
import type { EventsDb } from "./events-db.js";

const SILENCE_MS = 20_000; // the agent pings every 15 s
const BACKOFF_MIN_MS = 1_000, BACKOFF_MAX_MS = 30_000;

/** One agent's feed into the store: GET /v1/state, then follow /v1/stream; reconnects with jittered backoff. */
export class AgentLink {
  private dispatcher?: Dispatcher;
  private running = false;
  private ac?: AbortController;
  private wake?: () => void;
  private lastHeard?: Date;

  constructor(private server: ServerId, private url: string, private token: string, ca?: Buffer) {
    if (ca) this.dispatcher = new Agent({ connect: { ca } });
  }

  start(store: Store, db: EventsDb): void {
    if (this.running) return;
    this.running = true;
    void this.loop(store, db);
  }

  stop(): void { this.running = false; this.ac?.abort(); this.wake?.(); }

  private async loop(store: Store, db: EventsDb) {
    let attempt = 0;
    while (this.running) {
      try { await this.session(store, db, () => { attempt = 0; }); }
      catch (e) { if (this.running) console.error(`agent ${this.server}: ${describe(e)}`); }
      if (!this.running) break;
      for (const ev of store.markUnreachable(this.server, this.lastHeard ?? new Date())) db.add(ev);
      const ms = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt++) * (0.8 + Math.random() * 0.4);
      await new Promise<void>(r => { const t = setTimeout(r, ms); this.wake = () => { clearTimeout(t); r(); }; });
    }
  }

  /** Resolves when the stream ends, rejects on any error; aborts after SILENCE_MS without a byte. */
  private async session(store: Store, db: EventsDb, connected: () => void) {
    const ac = this.ac = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const kick = () => { clearTimeout(timer); timer = setTimeout(() => ac.abort(new Error(`silent for ${SILENCE_MS / 1000} s`)), SILENCE_MS); };
    const heard = () => { this.lastHeard = new Date(); kick(); };
    const get = async (path: string) => {
      const res = await fetch(this.url + path, { headers: { authorization: `Bearer ${this.token}` }, signal: ac.signal, dispatcher: this.dispatcher });
      if (!res.ok || !res.body) throw new Error(`${path}: HTTP ${res.status}`);
      return res;
    };
    const apply = (s: AgentState) => {
      if (s.server !== this.server) throw new Error(`agent reports server ${s.server}, expected ${this.server}`);
      for (const ev of store.apply(this.server, s)) db.add(ev);
    };
    try {
      kick();
      apply(AgentStateSchema.parse(await (await get("/v1/state")).json()));
      heard(); connected();
      const body = (await get("/v1/stream")).body!;
      const dec = new TextDecoder(); let buf = "", data: string[] = [];
      for await (const chunk of body) {
        heard(); buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
          if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
          else if (line === "" && data.length) { // blank line ends a message; ":" comments and other fields are ignored
            const raw = data.join("\n"); data = [];
            const m = StreamMessageSchema.safeParse(safeJson(raw));
            if (!m.success) { console.error(`agent ${this.server}: dropped an invalid stream message`); continue; }
            if (m.data.type === "state") apply(m.data.state);
            else if (m.data.event.server === this.server) { db.add(m.data.event); store.record(m.data.event); }
          }
        }
      }
    } finally { clearTimeout(timer); }
  }
}

const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return undefined; } };
// undici hides the reason (refused, TLS, reset) in `cause`
const describe = (e: unknown): string => e instanceof Error ? e.message + (e.cause ? `: ${describe(e.cause)}` : "") : String(e);
