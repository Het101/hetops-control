import Database from "better-sqlite3";
import { AckSchema, ActionRunSchema, EventSchema, type Ack, type ActionRun, type Event } from "@hetops-control/contracts";

const COLS = ["at", "server", "source", "kind", "summary", "entity", "actor", "level", "durationMs"] as const;
export const MAX_RECENT = 500;
const RUN_COLS = ["id", "at", "actor", "server", "action", "label", "target", "targetName", "params", "state", "finishedAt", "result", "error"] as const;
const ACK_COLS = ["entity", "server", "status", "actor", "at", "until", "note"] as const;
const noNulls = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null));

export class EventsDb {
  private db: Database.Database;
  private insert: Database.Statement;
  private select: Database.Statement;
  private remove: Database.Statement;
  private insRun: Database.Statement;
  private endRun: Database.Statement;
  private getRun: Database.Statement;
  private abandon: Database.Statement;
  private insAck: Database.Statement;
  private getAcks: Database.Statement;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS events(at TEXT, server TEXT, source TEXT, kind TEXT, summary TEXT, entity TEXT, actor TEXT, level TEXT, durationMs INTEGER);
      CREATE INDEX IF NOT EXISTS events_at ON events(at);`);
    // databases from before a column existed gain it on open; old rows read back without it
    const cols = this.db.prepare("PRAGMA table_info(events)").all() as { name: string }[];
    for (const [c, type] of [["level", "TEXT"], ["durationMs", "INTEGER"]]) if (!cols.some(x => x.name === c)) this.db.exec(`ALTER TABLE events ADD COLUMN ${c} ${type}`);
    this.insert = this.db.prepare(`INSERT INTO events(${COLS.join(",")}) VALUES (${COLS.map(c => "@" + c).join(",")})`);
    this.select = this.db.prepare(`SELECT ${COLS.join(",")} FROM events ORDER BY at DESC, rowid DESC LIMIT ?`);
    this.remove = this.db.prepare("DELETE FROM events WHERE at < ?");
    // the audit: one row per action request (the Idempotency-Key is its id), and the center-side acknowledgements; never pruned
    this.db.exec(`CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, server TEXT NOT NULL, action TEXT NOT NULL,
        label TEXT NOT NULL, target TEXT NOT NULL, targetName TEXT NOT NULL, params TEXT NOT NULL, state TEXT NOT NULL, finishedAt TEXT, result TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS acks(entity TEXT NOT NULL, server TEXT NOT NULL, status TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, until TEXT NOT NULL, note TEXT);
      CREATE INDEX IF NOT EXISTS acks_until ON acks(until);`);
    this.insRun = this.db.prepare(`INSERT OR IGNORE INTO actions(${RUN_COLS.join(",")}) VALUES (${RUN_COLS.map(c => "@" + c).join(",")})`);
    this.endRun = this.db.prepare("UPDATE actions SET state=@state, finishedAt=@finishedAt, result=@result, error=@error WHERE id=@id AND state='running'");
    this.getRun = this.db.prepare(`SELECT ${RUN_COLS.join(",")} FROM actions WHERE id = ?`);
    this.abandon = this.db.prepare("UPDATE actions SET state='failed', finishedAt=?, error='the center restarted before the agent answered; the result is unknown' WHERE state='running'");
    this.insAck = this.db.prepare(`INSERT INTO acks(${ACK_COLS.join(",")}) VALUES (${ACK_COLS.map(c => "@" + c).join(",")})`);
    this.getAcks = this.db.prepare(`SELECT ${ACK_COLS.join(",")} FROM acks WHERE until > ? ORDER BY at, rowid`);
  }

  add(e: Event): void {
    const v = EventSchema.parse(e);
    // one ISO form (with ms) so text order is time order
    this.insert.run({ ...v, at: new Date(v.at).toISOString(), entity: v.entity ?? null, actor: v.actor ?? null, level: v.level ?? null, durationMs: v.durationMs ?? null });
  }

  /** limit is clamped to 1..500 (SQLite reads a negative LIMIT as "no limit"). */
  recent(limit: number): Event[] {
    const n = Math.min(MAX_RECENT, Math.max(1, Math.trunc(limit) || 1));
    const rows = this.select.all(n) as Record<string, string | number | null>[];
    return rows.map(r => EventSchema.parse(Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null))));
  }

  prune(olderThanDays = 30): void {
    this.remove.run(new Date(Date.now() - olderThanDays * 86_400_000).toISOString());
  }

  addRun(r: ActionRun): boolean {
    const v = ActionRunSchema.parse(r);
    return this.insRun.run({ ...v, params: JSON.stringify(v.params), finishedAt: v.finishedAt ?? null, result: v.result ? JSON.stringify(v.result) : null, error: v.error ?? null }).changes === 1;
  }
  finishRun(r: ActionRun): void {
    const v = ActionRunSchema.parse(r);
    this.endRun.run({ id: v.id, state: v.state, finishedAt: v.finishedAt ?? null, result: v.result ? JSON.stringify(v.result) : null, error: v.error ?? null });
  }
  run(id: string): ActionRun | undefined {
    const row = this.getRun.get(id) as Record<string, string | null> | undefined;
    if (!row) return undefined;
    return ActionRunSchema.parse(noNulls({ ...row, params: JSON.parse(row.params!), result: row.result ? JSON.parse(row.result) : null }));
  }
  /** At start: a run still "running" lost its answer with the old process. */
  abandonRunning(at: string): number { return this.abandon.run(at).changes; }
  addAck(a: Ack): void { const v = AckSchema.parse(a); this.insAck.run({ ...v, note: v.note ?? null }); }
  acks(nowIso: string): Ack[] { return (this.getAcks.all(nowIso) as Record<string, string | null>[]).map(r => AckSchema.parse(noNulls(r))); }

  close(): void { this.db.close(); }
}
