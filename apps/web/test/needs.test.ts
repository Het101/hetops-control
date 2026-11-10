import { describe, it, expect } from "vitest";
import type { Entity, Need, ServerView } from "@hetops-control/contracts";
import { ranked } from "../src/lib/needs.js";

const ent = (id: string, status: Entity["status"], actions: Entity["actions"] = []): Entity =>
  ({ id, kind: "app", server: "lab", name: id.split("/").at(-1)!, status, facts: {}, links: [], actions, observedAt: "2026-11-07T00:00:00Z" });
const need = (entity: string, action?: Need["action"]): Need => ({ entity, server: "lab", text: entity, detail: "", ...(action ? { action } : {}) });

describe("ranked needs", () => {
  const sync = { id: "argo.sync", label: "Sync", risk: "safe" as const };
  const entities = [ent("lab/app/a/warn", "attention"), ent("lab/argo-app/clinic", "down", [sync]), ent("lab/backup/x", "attention")];
  const servers = { lab: { status: "attention" } } as unknown as Record<string, ServerView>;
  const catalog = [{ id: "argo.sync", server: "lab", label: "Sync" } as never];
  const rows = ranked([need("lab/app/a/warn"), need("lab"), need("lab/argo-app/clinic", sync)], entities, servers, catalog);
  it("puts what is down first, then what needs a look, keeping the center's order among equals", () => {
    expect(rows.map(r => [r.n.entity, r.sev])).toEqual([["lab/argo-app/clinic", "down"], ["lab/app/a/warn", "attention"], ["lab", "attention"]]);
    expect(rows[0]!.word).toBe("Down");
  });
  it("gives each row its one move: the offered action, or the page to open", () => {
    expect(rows[0]!.o?.descriptor.label).toBe("Sync");
    expect(rows[1]!.o).toBeUndefined();
    expect(rows[1]!.page.href).toBe("/apps");
  });
  it("a need about something it cannot see is blind, last", () => {
    expect(ranked([need("lab/source/crowdsec"), need("lab/app/a/warn")], entities, {}, []).map(r => r.sev)).toEqual(["attention", "blind"]);
  });
});
