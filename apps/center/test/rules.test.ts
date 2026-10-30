import { describe, it, expect } from "vitest";
import type { AgentState, Entity } from "@hetops-control/contracts";
import { Store } from "../src/store.js";
import { headline } from "../src/headline.js";

// the agent's clock runs 1 h behind the center's: every rule must judge time on the agent's clock plus that skew
const CENTER_NOW = "2026-10-31T12:00:00.000Z", AGENT_NOW = "2026-10-31T11:00:00.000Z";
const ent = (kind: Entity["kind"], name: string, facts: Entity["facts"], status: Entity["status"] = "ok"): Entity => ({ id: `lab/${kind}/${name}`, kind, server: "lab", name,
  status, facts, links: [], actions: [], observedAt: AGENT_NOW, source: "s" });
const agent = (entities: Entity[]): AgentState => ({ server: "lab", version: "1", generatedAt: AGENT_NOW, sources: [{ id: "s", periodMs: 60_000, ok: true, lastRunAt: AGENT_NOW }], entities });
const run = (...entities: Entity[]) => {
  const st = new Store(() => new Date(CENTER_NOW), ["lab"]); st.apply("lab", agent(entities));
  const s = st.snapshot(); return { s, h: headline(s) };
};
const f = <T extends string | number | boolean>(value: T) => ({ value });

describe("extended headline rules", () => {
  it("a critical alert is down, a warning needs a look, info and resolved stay quiet", () => {
    const { s, h } = run(ent("alert", "NodeDown", { severity: f("critical"), firing: f(1), since: f("2026-10-31T10:42:00Z") }),
      ent("alert", "DiskFilling", { severity: f("warning") }), ent("alert", "Info", { severity: f("info") }), ent("alert", "Gone", { severity: f("critical"), firing: f(0) }));
    expect(h).toMatchObject({ title: "Something is down.", emphasis: "1 thing needs you now." });
    expect(h.needs.map(n => n.entity)).toEqual(["lab/alert/NodeDown", "lab/alert/DiskFilling"]);
    expect(h.needs[0]!.detail).toBe("NodeDown is firing (critical) since 10:42 UTC");
    expect(s.servers.lab.status).toBe("down");
  });
  it("a backup with no success in 26 h is a need, judged on the skew-corrected clock", () => {
    // 25 h before the agent's now (26 h before the center's): fresh, because the agent's clock is behind
    const { h } = run(ent("backup", "nightly-all", { lastOk: f("2026-10-30T10:00:00Z") }), ent("backup", "nightly-security", { lastOk: f("2026-10-30T08:30:00Z") }),
      ent("backup", "never", {}));
    expect(h.needs.map(n => n.detail).sort()).toEqual(["never has no successful backup on record", "nightly-security has had no successful backup for 26 h (last at 08:30 UTC)"]);
    expect(h).toMatchObject({ title: "The estate is healthy.", emphasis: "2 things are waiting on you." });
  });
  it("a spent error budget is a need, a positive one is not", () => {
    const { h } = run(ent("slo", "lab-slo", { budgetLeft: f(-3) }), ent("slo", "other", { budgetLeft: f(12) }));
    expect(h.needs.map(n => n.detail)).toEqual(["lab-slo has spent its error budget (-3% left)"]);
  });
  it("an app with a commit waiting for a deploy is a need", () => {
    const { h } = run(ent("app", "blog", { undeployedCommit: f("abc1234def") }), ent("app", "site", { undeployedCommit: f("") }));
    expect(h.needs.map(n => n.detail)).toEqual(["blog has commit abc1234 waiting for a deploy"]);
  });
  it("drift on any host is a need", () => {
    const { h } = run(ent("check", "staging", { drift: f(true) }), ent("check", "ops", { drift: f(false) }));
    expect(h.needs.map(n => n.text)).toEqual(["staging on lab"]);
  });
  it("the center never lowers what the agent said, and stale readings are not judged", () => {
    const { h } = run(ent("slo", "lab-slo", { budgetLeft: f(-1) }, "down"));
    expect(h.needs[0]!.detail).toBe("lab-slo down");
    let now = CENTER_NOW; const st = new Store(() => new Date(now), ["lab"]); st.apply("lab", agent([ent("check", "staging", { drift: f(true) })]));
    now = "2026-10-31T12:04:00.000Z"; expect(st.snapshot().entities[0]!.status).toBe("unknown");
  });
});
