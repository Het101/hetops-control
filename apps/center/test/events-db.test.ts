import { describe, it, expect } from "vitest"; import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import Database from "better-sqlite3";
import { EventsDb } from "../src/events-db.js";
import type { ActionRun } from "@hetops-control/contracts";

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

const run: ActionRun = { id: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", action: "argo.sync", label: "Sync", server: "lab", target: "lab/argo-app/clinic", targetName: "clinic",
  actor: "het@hetops.dev", params: { hard: false }, state: "running", at: "2026-10-31T10:00:00.000Z" };
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), "center-")); return { dir, path: join(dir, "events.db") }; };

describe("audit", () => {
  it("records a run once per id, finishes it once, and keeps it across a reopen and a prune", () => {
    const { dir, path } = tmp(); let db = new EventsDb(path);
    try {
      expect(db.addRun(run)).toBe(true); expect(db.addRun({ ...run, actor: "x@y.z" })).toBe(false);
      db.finishRun({ ...run, state: "succeeded", finishedAt: "2026-10-31T10:00:02.000Z", result: { ok: true, summary: "sync of clinic started" } });
      db.finishRun({ ...run, state: "failed", error: "late" });   // only a running row changes
      db.prune(0); db.close(); db = new EventsDb(path);
      expect(db.run(run.id)).toEqual({ ...run, state: "succeeded", finishedAt: "2026-10-31T10:00:02.000Z", result: { ok: true, summary: "sync of clinic started" } });
      expect(db.run("00000000-0000-4000-8000-000000000000")).toBeUndefined();
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it("closes runs the center restarted on as failed, result unknown", () => {
    const { dir, path } = tmp(); const db = new EventsDb(path);
    try {
      db.addRun(run); expect(db.abandonRunning("2026-10-31T10:05:00.000Z")).toBe(1);
      expect(db.run(run.id)).toMatchObject({ state: "failed", finishedAt: "2026-10-31T10:05:00.000Z", error: "the center restarted before the agent answered; the result is unknown" });
      expect(db.abandonRunning("2026-10-31T10:06:00.000Z")).toBe(0);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it("keeps acks and returns only the unexpired", () => {
    const { dir, path } = tmp(); const db = new EventsDb(path);
    try {
      const ack = { entity: "ops/site/blog", server: "ops" as const, status: "down" as const, actor: "het@hetops.dev", at: "2026-10-31T10:00:00.000Z", until: "2026-10-31T14:00:00.000Z" };
      db.addAck(ack); db.addAck({ ...ack, entity: "ops/check/x", until: "2026-10-31T11:00:00.000Z", note: "known" });
      expect(db.acks("2026-10-31T10:30:00.000Z").map(a => a.entity)).toEqual(["ops/site/blog", "ops/check/x"]);
      expect(db.acks("2026-10-31T12:00:00.000Z")).toEqual([ack]);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
