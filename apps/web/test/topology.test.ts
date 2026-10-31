import { describe, it, expect } from "vitest";
import { fixtureState, roughNight } from "../e2e/fixture.js";
import { flowOf, logFlow, topology } from "../src/lib/topology.js";
import type { State } from "../src/lib/api.js";

const now = Date.parse("2026-10-30T07:42:00.000Z");
const edge = (s: State, id: string) => topology(s, now).edges.find(e => e.id === id)!;
const states = (s: State) => Object.fromEntries(topology(s, now).edges.map(e => [e.id, e.state]));
const bare = (): State => ({ ...structuredClone(fixtureState), entities: [], series: [] });

describe("topology edge states", () => {
  it("the base morning: every built link carries traffic, staging is planned", () => {
    expect(states(fixtureState)).toEqual({ public: "ok", "tunnel-lab": "ok", "tunnel-ops": "ok", "agent-lab": "ok", gateway: "ok", logs: "ok",
      "agent-staging": "planned", "snap-disk": "ok", "snap-r2": "ok" });
    expect(topology(fixtureState, now).headline).toBe("Every link is carrying traffic.");
    expect(topology(fixtureState, now).nodes.find(n => n.id === "staging")!.state).toBe("planned");
  });

  it("no signal is unknown, never green by default", () => {
    const s = states(bare());
    for (const id of ["public", "tunnel-lab", "tunnel-ops", "gateway", "logs", "snap-disk", "snap-r2"]) expect(s[id]).toBe("unknown");
    expect(s["agent-lab"]).toBe("ok"); // the agent link has its own signal: the lab agent answers
    expect(edge(bare(), "logs").reason).toBe("no signal reports on this link yet");
    expect(edge(bare(), "logs").flow).toBeUndefined();
  });

  it("a failing source or an unreachable agent blinds the signal: unknown, not stale green", () => {
    const s = structuredClone(fixtureState);
    s.servers.ops.failingSources = [{ id: "gatus", error: "connection refused" }];
    expect(edge(s, "tunnel-lab").state).toBe("unknown");
    expect(edge(s, "gateway").reason).toContain("can't read gatus on ops");
    s.servers.ops.reachable = false;
    expect(edge(s, "logs").state).toBe("unknown");
  });

  it("failures need the owner: one site down is attention, an unreachable agent and stopped logs are down", () => {
    const r = roughNight();
    expect(edge(r, "tunnel-lab").state).toBe("attention");
    expect(edge(r, "tunnel-lab").reason).toContain("ThreadVault down");
    expect(edge(r, "public").state).toBe("ok"); // the internet still reaches Cloudflare
    expect(edge(r, "snap-r2").state).toBe("attention");
    expect(edge(r, "snap-disk").state).toBe("ok");
    r.servers.lab.reachable = false;
    expect(edge(r, "agent-lab").state).toBe("down");
  });

  it("logs that stopped say how long ago, and the headline leads with it", () => {
    const s = structuredClone(fixtureState);
    // nothing in the last 30 min
    for (const x of s.series) x.points = x.points.map(([t, v]) => [t, t > now - 30 * 60_000 ? 0 : v]);
    const l = logFlow(s, now);
    expect(l.signal).toMatchObject({ state: "down", detail: "the last log arrived 22 min ago" });
    expect(edge(s, "logs").state).toBe("down");
    expect(edge(s, "logs").flow).toBeUndefined();
    expect(topology(s, now).headline).toBe("Logs from the lab stopped 22 min ago.");
  });

  it("a failing Gatus log check makes the logs link down even while docs still flow", () => {
    const s = structuredClone(fixtureState);
    Object.assign(s.entities.find(e => e.name === "Logs arriving from the lab")!, { status: "down", statusReason: "3 failed in a row" });
    expect(edge(s, "logs").state).toBe("down");
    expect(topology(s, now).headline).toBe("Lab logs to ops is down.");
  });

  it("staging turns live once configured: down while unreachable, ok when answering", () => {
    const s = structuredClone(fixtureState);
    s.servers.staging.configured = true;
    expect(edge(s, "agent-staging").state).toBe("down");
    s.servers.staging.reachable = true;
    expect(edge(s, "agent-staging").state).toBe("ok");
  });

  it("dots follow the real flow: busier is more and faster, stopped or blind is still", () => {
    const quiet = flowOf("ok", 10)!, busy = flowOf("ok", 2000)!;
    expect(busy.dots).toBeGreaterThan(quiet.dots);
    expect(busy.secs).toBeLessThan(quiet.secs);
    expect(flowOf("ok", 0)).toBeUndefined();
    expect(flowOf("down", 500)).toBeUndefined();
    expect(flowOf("unknown")).toBeUndefined();
    expect(flowOf("planned")).toBeUndefined();
    expect(edge(fixtureState, "logs").perMin).toBeGreaterThan(500);
  });
});
