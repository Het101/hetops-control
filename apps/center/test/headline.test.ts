import { describe, it, expect } from "vitest";
import type { CenterState, Entity } from "@hetops-control/contracts";
import { headline } from "../src/headline.js";

const sv = (status: "ok" | "attention" | "down" | "unknown" = "ok", extra = {}) => ({ status, reachable: true, since: "2026-10-30T00:00:00.000Z", ...extra });
const app = (name: string, status: Entity["status"], facts: Entity["facts"] = {}, reason?: string): Entity => ({ id: `lab/app/${name}`, kind: "app", server: "lab", name,
  status, ...(reason ? { statusReason: reason } : {}), facts, links: [], actions: [], observedAt: "2026-10-30T03:12:00.000Z" });
const state = (entities: Entity[], servers: Partial<CenterState["servers"]> = {}): CenterState => ({ generatedAt: "2026-10-30T08:00:00.000Z", entities,
  servers: { lab: sv(), staging: sv("unknown", { reachable: false, statusReason: "not connected yet" }), ops: sv(), ...servers } });

describe("headline", () => {
  it("all ok, staging never connected is not a need", () => {
    const h = headline(state([app("api", "ok")]));
    expect(h).toMatchObject({ title: "The estate is healthy.", needs: [] }); expect(h.emphasis).toBeUndefined();
  });
  it("attention becomes a need naming the app and server", () => {
    const h = headline(state([app("chaos-api", "attention", { restarts24h: { value: 2 }, lastRestartAt: { value: "2026-10-30T03:12:00.000Z" } })]));
    expect(h).toMatchObject({ title: "The estate is healthy.", emphasis: "1 thing is waiting on you.", detail: "chaos-api restarted twice at 03:12." });
    expect(h.needs).toHaveLength(1); expect(h.needs[0]!.text).toContain("chaos-api"); expect(h.needs[0]!.text).toContain("lab");
  });
  it("down", () => {
    const h = headline(state([app("api", "down", {}, "0/1 ready"), app("web", "attention")]));
    expect(h).toMatchObject({ title: "Something is down.", emphasis: "1 thing needs you now." }); expect(h.needs[0]!.entity).toBe("lab/app/api");
  });
  it("unreachable server wins, names the silent time", () => {
    const h = headline(state([], { lab: sv("unknown", { reachable: false, since: "2026-10-30T07:40:00.000Z", statusReason: "agent unreachable since 07:40" }) }));
    expect(h).toMatchObject({ title: "We can't see lab.", emphasis: "Its agent has been silent since 07:40." });
  });
  it("tolerates a stale-attention server without entity needs", () => {
    const h = headline(state([], { lab: sv("attention", { statusReason: "3 readings stale" }) }));
    expect(h.needs).toHaveLength(1);
  });
});
