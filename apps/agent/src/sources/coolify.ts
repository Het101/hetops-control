import { readFileSync } from "node:fs";
import type { Entity, Event, Series, Status } from "@hetops-control/contracts";
import type { Source } from "../registry.js";
import { json } from "./http.js";

// Coolify's API (v4.0.0-beta.470), shaped as recorded (test/fixtures/coolify.json): the applications, and each one's deployments
// newest first. A deployment row carries its full build log, so only a few are asked for after the first run.
export interface CoolifyReader { applications(): Promise<any[]>; deployments(uuid: string, take: number, signal?: AbortSignal): Promise<any[]> }

/** The token (a read-only one: no sensitive fields, no writes) is read on every call, so a rotated secret is picked up. */
export function realCoolify(base: string, tokenFile: string): CoolifyReader {
  const get = (path: string, signal?: AbortSignal) => json(`${base}${path}`,
    { headers: { accept: "application/json", authorization: `Bearer ${readFileSync(tokenFile, "utf8").trim()}` }, ...(signal ? { signal } : {}) });
  return {
    applications: () => get("/api/v1/applications"),
    deployments: async (uuid, take, signal) => (await get(`/api/v1/deployments/applications/${encodeURIComponent(uuid)}?skip=0&take=${take}`, signal))?.deployments,
  };
}

const MIN = 60_000, DAY = 86_400_000, PERIOD = 120_000, WAIT = 2 * MIN;
// ponytail: the first run reads 20 deployments per app and 40 are kept, so an app with more than 20 deploys in 14 days
// is undercounted for 14 days after an agent restart (16 was the most on record); page with skip= if that ever matters
const FIRST = 20, NEXT = 5, KEEP = 40;
const SHA = /^[0-9a-f]{7,40}$/;
const DONE = new Set(["finished", "failed"]);   // "cancelled-by-user" is the owner's choice, neither a deploy nor a failure
const ms = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
const secs = (d: number) => Math.round(d / 1000);

/** Coolify's generated names ("hetops-dns:main-<uuid>", "hungry-heron-<uuid>") as the owner knows them */
export const appName = (a: { name?: unknown; uuid: string }) => String(a.name ?? "").replace(/:.*$/, "").replace(`-${a.uuid}`, "") || a.uuid;

/** the first domain: `fqdn` is a comma-separated list; a compose app keeps its domains per service in a JSON string */
export function domain(a: any): string | undefined {
  let list = typeof a.fqdn === "string" ? a.fqdn : "";
  if (!list && typeof a.docker_compose_domains === "string") {
    try { list = Object.values(JSON.parse(a.docker_compose_domains) as Record<string, { domain?: string }>).map(s => s?.domain ?? "").join(","); }
    catch { /* not JSON: no domain */ }
  }
  return list.split(",").map((s: string) => s.trim()).find((s: string) => URL.canParse(s));
}

/** "Het101/radar-cloud" or "git@github.com:Het101/hetops-love.git" as owner/repo on GitHub */
const github = (r: unknown) => /^(?:git@github\.com:|https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(String(r ?? ""))?.[1];

function state(s: string): [Status, string?] {
  const [run = "", health = ""] = s.split(":");
  if (run === "running") return health === "healthy" ? ["ok"] : health === "unhealthy" ? ["attention", "running but unhealthy"] : ["ok", "running, no health check"];
  if (run.startsWith("exited") || run === "degraded") return ["down", s];
  if (run === "restarting" || run === "starting") return ["attention", s];
  return ["unknown", s ? `Coolify says "${s}"` : "no state from Coolify"];
}

type Dep = { app: string; status: string; commit: string; message: string; created: number; finished: number };

export function coolifySource(api: CoolifyReader): Source {
  const deps = new Map<string, Dep>();   // deployment uuid -> the run; the newest KEEP per app
  let sent: Set<string> | undefined;      // finished deployments already passed on as events (undefined until the first run)
  return {
    id: "coolify", periodMs: PERIOD,
    async collect({ server, now }) {
      const t = now().getTime(), observedAt = now().toISOString();
      const list = await api.applications();
      if (!Array.isArray(list)) throw new Error("applications is not a list");
      const apps = list.filter(a => typeof a?.uuid === "string" && /^[a-z0-9]+$/.test(a.uuid));
      const pages = await Promise.all(apps.map(a => api.deployments(a.uuid, sent ? NEXT : FIRST)));
      pages.forEach((rows, i) => {
        if (!Array.isArray(rows)) throw new Error("deployments is not a list");
        for (const d of rows) if (typeof d?.deployment_uuid === "string" && !Number.isNaN(ms(d.created_at)))
          deps.set(d.deployment_uuid, { app: apps[i]!.uuid, status: String(d.status ?? ""), commit: String(d.commit ?? ""),
            message: String(d.commit_message ?? "").split("\n")[0]!.slice(0, 200), created: ms(d.created_at), finished: ms(d.finished_at) });
      });
      const byApp = new Map<string, [string, Dep][]>(apps.map(a => [a.uuid, []]));
      for (const [k, d] of [...deps].sort((x, y) => y[1].created - x[1].created)) {
        const mine = byApp.get(d.app);
        if (mine && mine.length < KEEP) mine.push([k, d]); else deps.delete(k);
      }

      const idOf = (uuid: string) => `${server}/app/coolify/${uuid}`, nameOf = new Map(apps.map(a => [a.uuid, appName(a)]));
      const entities = apps.map((a): Entity => {
        const runs = byApp.get(a.uuid)!.map(([, d]) => d), last = runs.find(d => d.status === "finished"), newest = runs[0];
        const [status, statusReason] = state(String(a.status ?? ""));
        const site = domain(a), repo = github(a.git_repository);
        // Coolify does not watch the branch, so a commit waits when its deploy failed, or is queued or running past 2 min
        const waiting = newest && SHA.test(newest.commit) && newest.commit !== last?.commit && (newest.status === "failed"
          || ((newest.status === "queued" || newest.status === "in_progress") && t - newest.created > WAIT)) ? newest : undefined;
        const facts: Entity["facts"] = { state: { value: String(a.status ?? "") } };
        if (site) facts.fqdn = { value: new URL(site).host };
        if (last && !Number.isNaN(last.finished)) {
          facts.lastDeployAt = { value: new Date(last.finished).toISOString() };
          facts.lastDeployDuration = { value: secs(Math.max(0, last.finished - last.created)), unit: "s" };
        }
        if (last && SHA.test(last.commit)) facts.commit = { value: last.commit.slice(0, 7) };
        if (last?.message) facts.commitMessage = { value: last.message };
        if (typeof a.git_branch === "string" && a.git_branch) facts.branch = { value: a.git_branch };
        if (repo) facts.repository = { value: repo };
        if (waiting) facts.undeployedCommit = { value: waiting.commit };
        const links: Entity["links"] = [];
        if (site) links.push({ label: "Site", href: site });
        if (repo && last && SHA.test(last.commit)) links.push({ label: "GitHub", href: `https://github.com/${repo}/commit/${last.commit}` });
        return { id: idOf(a.uuid), kind: "app", server, name: nameOf.get(a.uuid)!, status, ...(statusReason ? { statusReason } : {}),
          facts, links, actions: [], observedAt };
      });

      // each finished or failed deploy once; after a restart only those of the last two periods are sent again
      const floor = sent ? -Infinity : t - 2 * PERIOD, done = new Set<string>(), events: Event[] = [];
      for (const [k, d] of deps) {
        if (!DONE.has(d.status) || Number.isNaN(d.finished)) continue;
        done.add(k);
        if (sent?.has(k) || d.finished < floor) continue;
        const durationMs = Math.max(0, d.finished - d.created), failed = d.status === "failed";
        events.push({ at: new Date(d.finished).toISOString(), server, source: "coolify", kind: "deploy", entity: idOf(d.app), durationMs,
          summary: `${nameOf.get(d.app)} ${failed ? "failed to deploy" : "deployed"}${SHA.test(d.commit) ? ` ${d.commit.slice(0, 7)}` : ""} in ${secs(durationMs)} s`,
          ...(failed ? { level: "attention" as const } : {}) });
      }
      sent = done;

      // 14 days (UTC) of deploys: count, and the median and longest time from queued to finished
      const end = Math.floor(t / DAY) * DAY, days = Array.from({ length: 14 }, (_, i) => end - (13 - i) * DAY), took = new Map<number, number[]>();
      for (const d of deps.values()) if (DONE.has(d.status) && !Number.isNaN(d.finished)) {
        const day = Math.floor(d.created / DAY) * DAY;
        took.set(day, [...(took.get(day) ?? []), secs(Math.max(0, d.finished - d.created))]);
      }
      const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
      const series = (id: string, label: string, unit: string, f: (v: number[]) => number, all = false): Series => ({ id: `${server}/coolify/${id}`, server, label, unit,
        stepMs: DAY, observedAt, points: days.filter(d => all || took.has(d)).map((d): [number, number] => [d, f(took.get(d) ?? [])]) });
      return { entities, events: events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), series: [
        series("deploys", "Coolify deploys per day", "deploys", v => v.length, true),
        series("deploy-median", "Median Coolify deploy time per day", "s", median),
        series("deploy-max", "Longest Coolify deploy per day", "s", v => Math.max(...v))] };
    },
  };
}
