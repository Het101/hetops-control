import { describe, it, expect } from "vitest"; import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
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
      db.prune(30); expect(db.recent(10).map(e => e.summary)).toEqual(["newest", "middle"]);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
