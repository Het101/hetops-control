import { describe, it, expect } from "vitest"; import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import Database from "better-sqlite3";
import { EventsDb } from "../src/events-db.js";

describe("events db", () => {
  it("returns the newest first and prunes old events", () => {
    const dir = mkdtempSync(join(tmpdir(), "center-")); const db = new EventsDb(join(dir, "events.db"));
    try {
      const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
      db.add({ at: ago(31), server: "lab", source: "kubernetes", kind: "restart", summary: "old" });
      db.add({ at: ago(2), server: "lab", source: "kubernetes", kind: "status", summary: "middle", entity: "lab/app/x" });
      db.add({ at: ago(1), server: "ops", source: "argo", kind: "sync", summary: "newest", actor: "argo" });
      expect(db.recent(2).map(e => e.summary)).toEqual(["newest", "middle"]);
      const mid = db.recent(2)[1]!; expect(mid.entity).toBe("lab/app/x"); expect(mid).not.toHaveProperty("actor"); // NULL columns are omitted
      expect(db.recent(0)).toHaveLength(1); expect(db.recent(-1)).toHaveLength(1); expect(db.recent(9999)).toHaveLength(3); // clamped to 1..500
      db.prune(30); expect(db.recent(10).map(e => e.summary)).toEqual(["newest", "middle"]);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("round-trips the status level, and omits it when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "center-")); const db = new EventsDb(join(dir, "events.db"));
    try {
      db.add({ at: "2026-10-30T03:12:00.000Z", server: "lab", source: "kubernetes", kind: "status", summary: "a → attention", level: "attention" });
      db.add({ at: "2026-10-30T03:13:00.000Z", server: "lab", source: "center", kind: "info", summary: "plain" });
      const [plain, hot] = db.recent(2);
      expect(hot!.level).toBe("attention"); expect(plain).not.toHaveProperty("level");
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("round-trips a deploy's duration, and omits it when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "center-")); const db = new EventsDb(join(dir, "events.db"));
    try {
      db.add({ at: "2026-10-30T03:12:00.000Z", server: "lab", source: "coolify", kind: "deploy", summary: "deployed in 74 s", durationMs: 74_000 });
      db.add({ at: "2026-10-30T03:13:00.000Z", server: "lab", source: "center", kind: "info", summary: "plain" });
      const [plain, deploy] = db.recent(2);
      expect(deploy!.durationMs).toBe(74_000); expect(plain).not.toHaveProperty("durationMs");
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("migrates a database created before level existed and keeps its rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "center-")); const path = join(dir, "events.db");
    const old = new Database(path);
    old.exec("CREATE TABLE events(at TEXT, server TEXT, source TEXT, kind TEXT, summary TEXT, entity TEXT, actor TEXT)");
    old.prepare("INSERT INTO events(at, server, source, kind, summary) VALUES (?, ?, ?, ?, ?)").run("2026-10-29T22:10:00.000Z", "ops", "center", "info", "old row");
    old.close();
    let db = new EventsDb(path); db.close(); db = new EventsDb(path); // opening twice: the migration is idempotent
    try {
      db.add({ at: "2026-10-30T03:12:00.000Z", server: "lab", source: "kubernetes", kind: "status", summary: "new row", level: "down" });
      expect(db.recent(5)).toEqual([
        { at: "2026-10-30T03:12:00.000Z", server: "lab", source: "kubernetes", kind: "status", summary: "new row", level: "down" },
        { at: "2026-10-29T22:10:00.000Z", server: "ops", source: "center", kind: "info", summary: "old row" }]);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
