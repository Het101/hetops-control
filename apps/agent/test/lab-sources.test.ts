import { describe, it, expect } from "vitest"; import { EntitySchema, EventSchema, SeriesSchema } from "@hetops-control/contracts";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { alertmanagerSource } from "../src/sources/alertmanager.js"; import { sloSource } from "../src/sources/chaos.js";
import { timelineSource } from "../src/sources/timeline.js"; import { crowdsecSource, mask, seconds } from "../src/sources/crowdsec.js";
import { bedrockSource, realBedrock } from "../src/sources/bedrock.js"; import { buildSources } from "../src/sources/index.js";
// Recorded on the lab, 30 Oct 2026, scrubbed (pod IPs moved to 192.0.2.0/24; no secrets). alertmanager-alerts.json was taken without
// inhibited=false so it holds suppressed alerts too; timeline-owner.json keeps the first two events of each source/kind of a 24 h feed;
// crowdsec-decisions.json holds two decisions made for the recording on TEST-NET addresses (the LAPI had none that day; the empty
// answer is `null`); bedrock-hosts.json is the three state files with their mtimes.
import alerts from "./fixtures/alertmanager-alerts.json"; import chaos from "./fixtures/chaos-status.json";
import timeline from "./fixtures/timeline-owner.json"; import decisions from "./fixtures/crowdsec-decisions.json";
import bedrock from "./fixtures/bedrock-hosts.json";

const at = (iso: string) => ({ server: "lab" as const, now: () => new Date(iso) });
const NOW = "2026-10-30T21:25:00Z";

describe("alertmanager source (recorded)", () => {
  it("drops suppressed alerts, Watchdog and InfoInhibitor", async () => {
    expect((await alertmanagerSource({ alerts: async () => alerts }).collect(at(NOW))).entities).toEqual([]);
  });
  it("makes an alert per active alert with the center's fact names", async () => {
    const a = structuredClone(alerts) as any[]; a[0].status.state = "active"; a[0].labels.severity = "warning";
    const { entities } = await alertmanagerSource({ alerts: async () => a }).collect(at(NOW));
    expect(entities).toHaveLength(1); const [e] = entities.map(x => EntitySchema.parse(x));
    expect([e!.id, e!.name, e!.status]).toEqual(["lab/alert/023a3bc0b91ba239", "KubeQuotaFullyUsed (timeline)", "ok"]);
    expect(e!.facts).toMatchObject({ firing: { value: 1 }, severity: { value: "warning" }, since: { value: "2026-10-25T09:58:12.792Z" },
      summary: { value: "Namespace quota is fully used." }, namespace: { value: "timeline" } });
  });
});

describe("slo source (recorded)", () => {
  it("reports the error budget left in % with burn rates", async () => {
    const [e] = (await sloSource({ status: async () => chaos }).collect(at(NOW))).entities.map(x => EntitySchema.parse(x));
    expect([e!.id, e!.kind, e!.status]).toEqual(["lab/slo/lab-visits", "slo", "ok"]);
    expect(e!.facts).toMatchObject({ budgetLeft: { value: 71.2 }, current: { value: 99.712 }, objective: { value: 99 }, burn1h: { value: 0 }, frozen: { value: false } });
  });
  it("is attention when frozen, unknown (never ok) when chaos-api is blind, and fails on a broken answer", async () => {
    const run = (s: unknown) => sloSource({ status: async () => s }).collect(at(NOW));
    const frozen = (await run({ ...chaos, slo: { ...chaos.slo, budget: -0.1, frozen: true } })).entities[0]!;
    expect([frozen.status, frozen.facts.budgetLeft?.value]).toEqual(["attention", -10]);
    const blind = (await run({ ...chaos, slo: null })).entities[0]!;
    expect([blind.status, blind.facts.budgetLeft]).toEqual(["unknown", undefined]);
    await expect(run({ enabled: true })).rejects.toThrow(/no slo/);
    await expect(run({ ...chaos, slo: { budget: "x" } })).rejects.toThrow(/not a number/);
  });
});

describe("timeline source (recorded)", () => {
  it("passes each event once: on start only the last two periods, then every new id", async () => {
    const src = timelineSource({ list: async () => rows }); let rows: any[] = timeline;
    const first = await src.collect(at("2026-10-30T18:54:40Z"));   // the newest recorded event is 57 s old
    expect(first.events!.map(e => e.summary)).toEqual(["control-agent is Healthy (was Progressing)"]);
    expect((await src.collect(at("2026-10-30T18:55:10Z"))).events).toEqual([]);
    rows = [{ ...timeline[4], id: "new-1", at: "2026-10-30T18:55:20Z" }, ...timeline];
    const next = (await src.collect(at("2026-10-30T18:55:40Z"))).events!;
    expect(next).toHaveLength(1); EventSchema.parse(next[0]);
    expect(next[0]).toMatchObject({ server: "lab", source: "timeline", kind: "info", level: "down", actor: "falco" });
  });
  it("maps every recorded event to a valid event, rollouts as deploys", async () => {
    const { events } = await timelineSource({ list: async () => timeline }).collect(at("2026-10-30T13:00:00Z"));
    const all = await timelineSource({ list: async () => timeline.map(e => ({ ...e, at: "2026-10-30T12:59:50Z" })) }).collect(at("2026-10-30T13:00:00Z"));
    expect(events!.length).toBeLessThan(timeline.length);
    expect(all.events).toHaveLength(timeline.length); for (const e of all.events!) EventSchema.parse(e);
    expect(all.events!.filter(e => e.kind === "deploy")).toHaveLength(timeline.filter(e => e.kind === "rollout").length);
  });
});

describe("crowdsec source (recorded)", () => {
  it("makes masked decisions with the time left and a bans-per-hour series; null is no decisions", async () => {
    const src = crowdsecSource({ decisions: async () => decisions });
    const out = await src.collect(at(NOW));
    const [range, ip] = out.entities.map(x => EntitySchema.parse(x));
    expect([ip!.id, ip!.name, ip!.facts.expiresIn?.value, ip!.facts.until?.value]).toEqual(["lab/decision/6", "192.0.2.0/24", 179, "2026-10-30T21:27:59.000Z"]);
    expect([range!.name, range!.facts.type?.value, range!.facts.origin?.value]).toEqual(["198.51.100.0/24", "captcha", "cscli"]);
    const [s] = out.series!.map(x => SeriesSchema.parse(x));
    expect(s!.points).toHaveLength(24); expect(s!.points.at(-1)).toEqual([Date.parse("2026-10-30T21:00:00Z"), 1]);   // the captcha is not a ban
    expect((await crowdsecSource({ decisions: async () => null }).collect(at(NOW))).entities).toEqual([]);
    await expect(crowdsecSource({ decisions: async () => ({}) as any }).collect(at(NOW))).rejects.toThrow(/not a list/);
  });
  it("reads Go durations and never shows a whole address", () => {
    expect([seconds("1h29m59s"), seconds("2m59.5s"), seconds("350ms"), seconds("-3s"), seconds("")]).toEqual([5399, 180, 0, 0, undefined]);
    expect([mask("Ip", "203.0.113.9"), mask("Range", "203.0.113.0/28"), mask("Range", "10.0.0.0/8"), mask("Ip", "2001:db8:1:2::1"),
      mask("Country", "CN"), mask("Ip", "garbage")]).toEqual(["203.0.113.0/24", "203.0.113.0/24", "10.0.0.0/8", "2001:db8:1::/48", "CN", "hidden"]);
  });
});

describe("bedrock source (recorded)", () => {
  it("makes one check per server, all from the lab, with drift and the last run", async () => {
    const { entities } = await bedrockSource({ hosts: async () => bedrock }).collect(at(NOW));
    expect(entities.map(e => EntitySchema.parse(e)).map(e => [e.id, e.server, e.status, e.facts.drift?.value]))
      .toEqual([["lab/check/bedrock-lab", "lab", "ok", false], ["lab/check/bedrock-staging", "lab", "ok", false], ["lab/check/bedrock-ops", "lab", "ok", false]]);
    expect(entities[0]!.facts.lastRun?.value).toBe("2026-10-30T02:36:41.763Z");
  });
  it("reports drift, and is unknown (never clean) when a result is stale, missing or unreadable", async () => {
    const h = structuredClone(bedrock); h[2]!.state = "drift"; h[0]!.state = "?"; h.splice(1, 1);
    const { entities } = await bedrockSource({ hosts: async () => h }).collect(at(NOW));
    expect(entities.map(e => [e.status, e.statusReason, e.facts.drift?.value]))
      .toEqual([["unknown", "no drift check on record", undefined], ["ok", undefined, true], ["unknown", 'unreadable drift state "?"', undefined]]);
    const late = await bedrockSource({ hosts: async () => bedrock }).collect(at("2026-10-31T05:00:00Z"));
    expect(late.entities.every(e => e.status === "unknown" && e.statusReason === "no drift check for 26 h" && !e.facts.drift)).toBe(true);
  });
  it("reads the state directory as the drift timer writes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bedrock-"));
    for (const b of bedrock) { writeFileSync(join(dir, b.host), `${b.state}\n`); utimesSync(join(dir, b.host), b.at / 1000, b.at / 1000); }
    const got = (await realBedrock(dir).hosts()).sort((a, b) => a.host.localeCompare(b.host));
    expect(got.map(h => [h.host, h.state, Math.round(h.at / 1000)])).toEqual(bedrock.map(b => [b.host, b.state, Math.round(b.at / 1000)]));
  });
});

describe("buildSources on the lab", () => {
  it("adds the lab sources only where their settings are present", () => {
    expect(buildSources({} as any, { ALERTMANAGER_URL: "http://am:9093", CHAOS_URL: "http://chaos-api.chaos.svc", TIMELINE_URL: "http://timeline.timeline.svc:8081",
      CROWDSEC_URL: "https://crowdsec-service.crowdsec:8080", BEDROCK_DIR: "/bedrock" }).map(s => s.id))
      .toEqual(["kubernetes", "argo", "hostload", "alertmanager", "slo", "timeline", "crowdsec", "bedrock"]);
  });
});
