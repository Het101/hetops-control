import { describe, it, expect } from "vitest"; import { EntitySchema, EventSchema, SeriesSchema } from "@hetops-control/contracts";
import { appName, coolifySource, domain, type CoolifyReader } from "../src/sources/coolify.js"; import { buildSources } from "../src/sources/index.js";
// Recorded on the lab, 30 Oct 2026 21:55 UTC, with the owner's read-only token (GET /api/v1/applications and
// /api/v1/deployments/applications/<uuid>?take=20). Trimmed to the fields a reader might use: the application's server and
// proxy settings (they hold the server's address), each deployment's build log and all but the first line of commit messages are cut.
import rec from "./fixtures/coolify.json";

const NOW = "2026-10-30T21:55:00Z", DRILL = "lab/app/coolify/b141eiztobjhg20vt960lzax";
const at = (iso: string) => ({ server: "lab" as const, now: () => new Date(iso) });
const reader = (deps: Record<string, any[]> = {}, takes: number[] = []): CoolifyReader => ({
  applications: async () => rec.applications,
  deployments: async (uuid, take) => { takes.push(take); return (deps[uuid] ?? (rec.deployments as any)[uuid].deployments).slice(0, take); },
});
const row = (over: Record<string, unknown>) => ({ ...rec.deployments.b141eiztobjhg20vt960lzax.deployments[0], ...over });

describe("coolify source (recorded)", () => {
  it("makes an app per Coolify application with the facts the Apps page reads", async () => {
    const { entities } = await coolifySource(reader()).collect(at(NOW));
    const apps = entities.map(e => EntitySchema.parse(e));
    expect(apps.map(e => [e.name, e.status, e.facts.fqdn?.value])).toEqual([
      ["hetops-dns", "ok", "dns.hetops.dev"], ["hetops-portfolio", "ok", "hetops.dev"], ["hungry-heron", "ok", "love.hetops.dev"],
      ["radar-cloud", "ok", "radar.hetops.dev"], ["restore-drill", "ok", "drill.hetops.dev"], ["tallybank", "ok", "tally.hetops.dev"]]);
    const drill = apps.find(e => e.id === DRILL)!;
    expect(drill.facts).toMatchObject({ lastDeployAt: { value: "2026-10-29T17:51:02.000Z" }, lastDeployDuration: { value: 23, unit: "s" },
      commit: { value: "e1855f6" }, branch: { value: "main" }, repository: { value: "Het101/restore-drill" }, state: { value: "running:healthy" } });
    expect(drill.facts.undeployedCommit).toBeUndefined();   // its one failed deploy was followed by good ones
    expect(drill.links).toEqual([{ label: "Site", href: "https://drill.hetops.dev" },
      { label: "GitHub", href: "https://github.com/Het101/restore-drill/commit/e1855f6523467ea4c6e0d3a69b2e5857446f502c" }]);
    const dns = apps[0]!, love = apps[2]!, tally = apps[5]!;
    expect([dns.statusReason, dns.facts.lastDeployAt?.value]).toEqual(["running, no health check", "2026-10-14T03:55:54.000Z"]);
    expect([love.facts.lastDeployAt, love.facts.repository?.value]).toEqual([undefined, "Het101/hetops-love"]);   // never deployed through Coolify
    expect([tally.facts.commit, tally.links.length]).toEqual([undefined, 1]);   // a Docker image: "HEAD" is not a commit
    for (const e of apps) for (const f of Object.values(e.facts)) expect(["string", "number"]).toContain(typeof f.value);
  });

  it("reports a commit waiting when its deploy failed or is stuck past 2 min, never a moving one", async () => {
    const run = async (top: Record<string, unknown>, now = NOW) => (await coolifySource(reader({ b141eiztobjhg20vt960lzax:
      [row({ deployment_uuid: "new", commit: "a".repeat(40), finished_at: null, ...top }), ...rec.deployments.b141eiztobjhg20vt960lzax.deployments] }))
      .collect(at(now))).entities.find(e => e.id === DRILL)!.facts.undeployedCommit?.value;
    expect(await run({ status: "failed", created_at: "2026-10-30T21:50:00Z", finished_at: "2026-10-30T21:51:00Z" })).toBe("a".repeat(40));
    expect(await run({ status: "queued", created_at: "2026-10-30T21:52:00Z" })).toBe("a".repeat(40));
    expect(await run({ status: "in_progress", created_at: "2026-10-30T21:54:00Z" })).toBeUndefined();   // a normal deploy, 1 min in
    expect(await run({ status: "cancelled-by-user", created_at: "2026-10-30T21:50:00Z" })).toBeUndefined();
    expect(await run({ status: "failed", commit: "HEAD", created_at: "2026-10-30T21:50:00Z", finished_at: "2026-10-30T21:51:00Z" })).toBeUndefined();
  });

  it("passes each finished deploy once as a deploy event with its duration; after a restart only the last two periods", async () => {
    const takes: number[] = [], deps: Record<string, any[]> = {};
    const src = coolifySource(reader(deps, takes));
    const first = (await src.collect(at("2026-10-29T17:53:00Z"))).events!.map(e => EventSchema.parse(e));
    expect(first).toEqual([{ at: "2026-10-29T17:51:02.000Z", server: "lab", source: "coolify", kind: "deploy", entity: DRILL,
      durationMs: 23_000, summary: "restore-drill deployed e1855f6 in 23 s" }]);
    expect(takes.every(n => n === 20)).toBe(true);
    expect((await src.collect(at("2026-10-29T17:55:00Z"))).events).toEqual([]);
    deps.b141eiztobjhg20vt960lzax = [row({ deployment_uuid: "new", status: "failed", commit: "b".repeat(40),
      created_at: "2026-10-29T17:56:00Z", finished_at: "2026-10-29T17:58:30Z" }), ...rec.deployments.b141eiztobjhg20vt960lzax.deployments];
    takes.length = 0;
    const next = (await src.collect(at("2026-10-29T17:59:00Z"))).events!;
    expect(next).toEqual([expect.objectContaining({ summary: "restore-drill failed to deploy bbbbbbb in 150 s", durationMs: 150_000, level: "attention" })]);
    expect(takes.every(n => n === 5)).toBe(true);
  });

  it("makes 14 days of deploy counts, median and longest deploy time", async () => {
    const out = await coolifySource(reader()).collect(at(NOW));
    const [count, median, max] = out.series!.map(s => SeriesSchema.parse(s));
    // 25 in all: what Coolify's database counted for those 14 days (application_deployment_queues, same evening)
    expect(count!.points.map(p => p[1])).toEqual([0, 1, 4, 4, 1, 9, 1, 0, 2, 0, 0, 0, 3, 0]);
    expect(count!.points.at(-2)![0]).toBe(Date.parse("2026-10-29T00:00:00Z"));
    // only days with deploys; 29 Oct: the portfolio 21 s, the drill 94 s and 23 s
    expect([median!.points.length, max!.points.length]).toEqual([8, 8]);
    expect([median!.points.at(-1), max!.points.at(-1)]).toEqual([[Date.parse("2026-10-29T00:00:00Z"), 23], [Date.parse("2026-10-29T00:00:00Z"), 94]]);
  });

  it("fails on a broken answer and drops a vanished app's deploys", async () => {
    await expect(coolifySource({ ...reader(), applications: async () => ({}) as any }).collect(at(NOW))).rejects.toThrow(/not a list/);
    await expect(coolifySource({ ...reader(), deployments: async () => ({}) as any }).collect(at(NOW))).rejects.toThrow(/not a list/);
    let apps = rec.applications;
    const src = coolifySource({ ...reader(), applications: async () => apps });
    await src.collect(at(NOW)); apps = apps.filter(a => a.uuid !== "b141eiztobjhg20vt960lzax");
    const out = await src.collect(at(NOW));
    expect(out.entities.some(e => e.id === DRILL)).toBe(false);
    expect(out.series![0]!.points.at(-2)![1]).toBe(1);   // only the portfolio's deploy is left on 29 Oct
  });

  it("names apps as the owner knows them and finds the first domain", () => {
    expect([appName({ name: "radar-cloud:main-jmjc", uuid: "jmjc" }), appName({ name: "hungry-heron-abc", uuid: "abc" }), appName({ uuid: "xyz" })])
      .toEqual(["radar-cloud", "hungry-heron", "xyz"]);
    expect([domain({ fqdn: "https://a.dev,https://b.dev" }), domain({ fqdn: null, docker_compose_domains: "{\"web\":{\"domain\":\"https://c.dev\"}}" }),
      domain({ docker_compose_domains: "not json" }), domain({ fqdn: "" })]).toEqual(["https://a.dev", "https://c.dev", undefined, undefined]);
  });

  it("runs on the lab only when COOLIFY_URL is set", () => {
    expect(buildSources({} as any, { COOLIFY_URL: "http://10.0.0.11:8000/" }).map(s => s.id)).toEqual(["kubernetes", "argo", "hostload", "coolify"]);
  });
});
