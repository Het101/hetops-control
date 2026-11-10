import { describe, it, expect } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { commands, search } from "../src/lib/palette.js";
const PAGES = { "/": "Home", "/alerts": "Alerts", "/apps": "Apps" };

const ent = (id: string, kind: string, actions: Entity["actions"] = []): Entity =>
  ({ id, kind, server: id.split("/")[0] as "lab", name: id.split("/").at(-1)!, status: "ok", facts: {}, links: [], actions, observedAt: "2026-11-07T00:00:00Z" } as Entity);
const sync = { id: "argo.sync", label: "Sync", risk: "safe" as const };
const list = commands(PAGES, [ent("lab/argo-app/clinic", "argo-app", [sync]), ent("lab/app/clinic/api", "app"), ent("ops/site/sites_dns", "site")],
  [{ id: "argo.sync", server: "lab", label: "Sync" } as never]);

describe("palette", () => {
  it("offers the pages and servers before anything is typed", () => {
    const first = search(list, "");
    expect(first.map(c => c.label)).toEqual(expect.arrayContaining(["Home", "Alerts", "Lab", "Ops"]));
    expect(first.some(c => c.group === "Actions")).toBe(false);
  });
  it("finds an action by its verb and target, and an app by name, with where it lives", () => {
    expect(search(list, "sync clin")[0]!.label).toBe("Sync clinic");
    const api = search(list, "api")[0]!;
    expect([api.label, api.go]).toEqual(["api", "/apps"]);
  });
  it("every typed word must match; nothing invented", () => {
    expect(search(list, "sync nothere")).toEqual([]);
    expect(search(list, "dns")[0]!.hint).toContain("site");
  });
});
