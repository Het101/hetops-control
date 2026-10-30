import Database from "better-sqlite3";
import { EventSchema, type Event } from "@hetops-control/contracts";

const COLS = ["at", "server", "source", "kind", "summary", "entity", "actor", "level"] as const;
export const MAX_RECENT = 500;

export class EventsDb {
  private db: Database.Database;
  private insert: Database.Statement;
  private select: Database.Statement;
  private remove: Database.Statement;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS events(at TEXT, server TEXT, source TEXT, kind TEXT, summary TEXT, entity TEXT, actor TEXT, level TEXT);
      CREATE INDEX IF NOT EXISTS events_at ON events(at);`);
    // databases from before `level` existed gain the column on open; old rows read back without it
    const cols = this.db.prepare("PRAGMA table_info(events)").all() as { name: string }[];
    if (!cols.some(c => c.name === "level")) this.db.exec("ALTER TABLE events ADD COLUMN level TEXT");
    this.insert = this.db.prepare(`INSERT INTO events(${COLS.join(",")}) VALUES (${COLS.map(c => "@" + c).join(",")})`);
    this.select = this.db.prepare(`SELECT ${COLS.join(",")} FROM events ORDER BY at DESC, rowid DESC LIMIT ?`);
    this.remove = this.db.prepare("DELETE FROM events WHERE at < ?");
  }

  add(e: Event): void {
    const v = EventSchema.parse(e);
    // one ISO form (with ms) so text order is time order
    this.insert.run({ ...v, at: new Date(v.at).toISOString(), entity: v.entity ?? null, actor: v.actor ?? null, level: v.level ?? null });
  }

  /** limit is clamped to 1..500 (SQLite reads a negative LIMIT as "no limit"). */
  recent(limit: number): Event[] {
    const n = Math.min(MAX_RECENT, Math.max(1, Math.trunc(limit) || 1));
    const rows = this.select.all(n) as Record<string, string | null>[];
    return rows.map(r => EventSchema.parse(Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null))));
  }

  prune(olderThanDays = 30): void {
    this.remove.run(new Date(Date.now() - olderThanDays * 86_400_000).toISOString());
  }

  close(): void { this.db.close(); }
}
