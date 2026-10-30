import Database from "better-sqlite3";
import { EventSchema, type Event } from "@hetops-control/contracts";

const COLS = ["at", "server", "source", "kind", "summary", "entity", "actor"] as const;

export class EventsDb {
  private db: Database.Database;
  private insert: Database.Statement;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS events(at TEXT, server TEXT, source TEXT, kind TEXT, summary TEXT, entity TEXT, actor TEXT);
      CREATE INDEX IF NOT EXISTS events_at ON events(at);`);
    this.insert = this.db.prepare(`INSERT INTO events(${COLS.join(",")}) VALUES (${COLS.map(c => "@" + c).join(",")})`);
  }

  add(e: Event): void {
    const v = EventSchema.parse(e);
    // one ISO form (with ms) so text order is time order
    this.insert.run({ ...v, at: new Date(v.at).toISOString(), entity: v.entity ?? null, actor: v.actor ?? null });
  }

  recent(limit: number): Event[] {
    const rows = this.db.prepare("SELECT * FROM events ORDER BY at DESC, rowid DESC LIMIT ?").all(limit) as Record<string, string | null>[];
    return rows.map(r => EventSchema.parse(Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null))));
  }

  prune(olderThanDays = 30): void {
    this.db.prepare("DELETE FROM events WHERE at < ?").run(new Date(Date.now() - olderThanDays * 86_400_000).toISOString());
  }

  close(): void { this.db.close(); }
}
