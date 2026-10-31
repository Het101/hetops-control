import type { Page } from "@playwright/test";
import type { Entity, Event, Series, SourceReport } from "@hetops-control/contracts";
import { StateSchema, type State } from "../src/lib/api.js";

// a realistic morning on the estate: lab busy with one smouldering app, ops quiet, staging not connected yet
const at = "2026-10-30T07:42:00.000Z";
type Srv = "lab" | "ops";
const base = { observedAt: at, links: [], actions: [] };
const app = (server: Srv, ns: string, name: string, pods: number, restarts = 0, last?: string): Entity => ({
  ...base, id: `${server}/app/${ns}/${name}`, kind: "app", server, name, parent: `${server}/cluster`, source: "kubernetes",
  status: restarts ? "attention" : "ok", ...(restarts ? { statusReason: `${restarts} restarts in 24h` } : {}),
  facts: { namespace: { value: ns }, pods: { value: pods, max: pods }, podsDesired: { value: pods }, restarts24h: { value: restarts },
    ...(last ? { lastRestartAt: { value: last } } : {}) } });
const cluster = (server: Srv, version: string, nodes: number, running: number, total: number): Entity => ({
  ...base, id: `${server}/cluster`, kind: "cluster", server, name: "cluster", status: "ok", source: "kubernetes",
  facts: { version: { value: version }, nodes: { value: nodes }, podsRunning: { value: running }, podsTotal: { value: total } } });
const node = (server: Srv, name: string, cpu: number, memory: number, disk: number): Entity => ({
  ...base, id: `${server}/node/${name}`, kind: "node", server, name, parent: `${server}/cluster`, status: "ok", source: "hostload",
  facts: { cpu: { value: cpu, unit: "%" }, memory: { value: memory, unit: "%" }, disk: { value: disk, unit: "%" } } });
const argo = (server: Srv, name: string): Entity => ({
  ...base, id: `${server}/argo-app/${name}`, kind: "argo-app", server, name, status: "ok", source: "argo",
  facts: { sync: { value: "Synced" }, health: { value: "Healthy" } } });

const labApps: [string, string, number, number?, string?][] = [
  ["clinic", "api", 3], ["clinic", "web", 2], ["clinic", "worker", 1], ["clinic", "postgres", 1],
  ["chaos", "chaos-api", 1, 2, "2026-10-30T03:12:00.000Z"], ["chaos", "chaos-console", 1],
  ["argocd", "argocd-server", 1], ["argocd", "argocd-repo-server", 1], ["argocd", "argocd-application-controller", 1],
  ["monitoring", "prometheus", 1], ["monitoring", "grafana", 1], ["monitoring", "alertmanager", 1], ["monitoring", "node-exporter", 2],
  ["logging", "fluent-bit", 2], ["crowdsec", "crowdsec-lapi", 1], ["crowdsec", "crowdsec-agent", 2],
  ["gateway", "traefik", 2], ["timeline", "timeline", 1], ["coolify", "coolify", 1], ["kube-system", "coredns", 2],
];
const opsApps: [string, string, number][] = [
  ["argocd", "argocd-server", 1], ["argocd", "argocd-repo-server", 1], ["gatus", "gatus", 1], ["logging", "opensearch", 1],
  ["logging", "vector", 2], ["storage", "local-path-provisioner", 1], ["tunnel", "cloudflared", 2], ["sealed-secrets", "sealed-secrets", 1],
];

const src = (id: string, periodMs: number, lastRunAt = "2026-10-30T07:41:55.000Z"): SourceReport => ({ id, periodMs, ok: true, lastRunAt });
const sources = [src("kubernetes", 10_000), src("hostload", 15_000), src("argo", 60_000)];
const opsSources = [...sources, src("gatus", 30_000), src("elasticsearch", 60_000), src("snapshots", 300_000)];

// the ops agent's Gatus, Elasticsearch and snapshot sources, shaped as they report today
const gatus = (kind: "site" | "check", key: string, name: string, group: string, uptime: number, ms: number, http = 200): Entity => ({
  ...base, id: `ops/${kind}/${key}`, kind, server: "ops", name, source: "gatus", status: "ok",
  facts: { group: { value: group }, httpStatus: { value: http }, latencyMs: { value: ms, unit: "ms" }, uptime24h: { value: uptime, unit: "%", max: 100 },
    lastCheck: { value: "2026-10-30T07:41:30.000Z" } } });
const sites: Entity[] = [
  gatus("site", "sites_hetops-dev", "hetops.dev", "sites", 100, 84), gatus("site", "sites_status", "status.hetops.dev", "sites", 99.93, 121),
  gatus("site", "sites_drill", "drill.hetops.dev", "sites", 100, 96), gatus("site", "sites_dns", "dns.hetops.dev", "sites", 99.86, 143),
  gatus("site", "products_radar", "Radar Cloud", "products", 100, 212), gatus("site", "products_threadvault", "ThreadVault", "products", 99.71, 188),
  gatus("site", "sites_chaos", "chaos.hetops.dev", "sites", 98.61, 301), gatus("site", "sites_control", "control.hetops.dev", "sites", 100, 77),
  gatus("site", "products_domain-watch", "Domain Watch", "products", 100, 164), gatus("site", "sites_blog", "blog.hetops.dev", "sites", 99.98, 92),
];
const checks: Entity[] = [
  gatus("check", "logs_logs-arriving-from-the-lab", "Logs arriving from the lab", "logs", 100, 38), gatus("check", "logs_lab-security", "lab security logs arriving", "logs", 100, 41),
  gatus("check", "snapshots_nightly-all", "nightly snapshot", "snapshots", 100, 22), gatus("check", "snapshots_nightly-security", "security snapshot", "snapshots", 100, 24),
  gatus("check", "watcher_kuma", "Kuma reachable", "watchers", 100, 57), gatus("check", "watchers_lab-gateway", "Lab gateway", "watchers", 100, 31),
  gatus("check", "watcher_argo-ops", "ops Argo CD", "watchers", 100, 45), gatus("check", "watcher_center", "control center health", "watchers", 100, 12),
  { ...base, id: "ops/check/elasticsearch", kind: "check", server: "ops", name: "Elasticsearch", parent: "ops/cluster", source: "elasticsearch", status: "ok",
    facts: { health: { value: "green" }, nodes: { value: 1 }, unassignedShards: { value: 0 }, activeShards: { value: 100, unit: "%", max: 100 } } },
];
const backup = (name: string, repository: string, indices: string, lastOk: string, ageHours: number, kept: number, failed: number, lastFailure?: string): Entity => ({
  ...base, id: `ops/backup/${name}`, kind: "backup", server: "ops", name, source: "snapshots", status: "ok",
  facts: { repository: { value: repository }, indices: { value: indices }, snapshots: { value: kept }, failed: { value: failed },
    lastOk: { value: lastOk }, ageHours: { value: ageHours, unit: "h" }, nextRun: { value: lastOk.replace("2026-10-30", "2026-10-31") },
    ...(lastFailure ? { lastFailure: { value: lastFailure } } : {}) } });
const backups = [backup("nightly-all", "ops-disk", "logs-lab-*", "2026-10-30T01:30:04.000Z", 6.2, 14, 0),
  backup("nightly-security", "r2-security", "logs-lab-security*", "2026-10-30T01:45:09.000Z", 5.9, 30, 1, "2026-10-21T01:45:02.000Z")];
// 24 h of 10-min buckets ending at the fixture's now, with a 40-min gap (the ops outage test) in the afternoon
const flow = (id: string, label: string, baseRate: number, amp: number): Series => {
  const end = Date.parse(at) - (Date.parse(at) % 600_000), points: [number, number][] = [];
  for (let i = 143; i >= 0; i--) { if (i >= 90 && i < 94) continue; const t = end - i * 600_000;
    points.push([t, Math.round(baseRate + Math.sin(i / 9) * amp + Math.sin(i / 3.3) * amp * .35 + ((i * 7919) % 13) * amp / 30)]); }
  return { id, server: "ops", label, unit: "docs", stepMs: 600_000, points, observedAt: at, source: "elasticsearch" };
};

export const fixtureState: State = {
  generatedAt: at,
  servers: {
    lab: { status: "attention", statusReason: "chaos-api: 2 restarts in 24h", reachable: true, configured: true, since: "2026-10-29T22:10:00.000Z", agentVersion: "0.1.0", sources },
    staging: { status: "unknown", statusReason: "not connected yet", reachable: false, configured: false, since: "2026-10-30T06:00:00.000Z" },
    ops: { status: "ok", reachable: true, configured: true, since: "2026-10-29T22:10:00.000Z", agentVersion: "0.1.0", sources: opsSources },
  },
  series: [flow("ops/logs/default", "Lab logs: default", 9000, 2600), flow("ops/logs/security", "Lab logs: security", 1400, 420)],
  entities: [
    cluster("lab", "v1.31.4+k3s1", 1, 34, 35), node("lab", "my-workspace", 48, 63, 41),
    ...labApps.map(([ns, n, p, r, l]) => app("lab", ns, n, p, r, l)), argo("lab", "clinic"), argo("lab", "chaos"),
    cluster("ops", "v1.31.4+k3s1", 1, 12, 12), node("ops", "hetops-3", 71, 78, 55),
    ...opsApps.map(([ns, n, p]) => app("ops", ns, n, p)), argo("ops", "logging"), argo("ops", "gatus"), argo("ops", "control"),
    ...sites, ...checks, ...backups,
  ],
  headline: {
    title: "The estate is healthy.", emphasis: "1 thing is waiting on you.",
    detail: "chaos-api restarted twice at 03:12. The other 27 apps are steady across 2 servers.",
    needs: [{ entity: "lab/app/chaos/chaos-api", server: "lab", text: "chaos-api is restarting on lab", detail: "2 restarts in 24h · last at 03:12",
      action: { id: "restart", label: "Restart", risk: "disruptive" } }],
  },
};

export const fixtureEvents: Event[] = [
  { at: "2026-10-30T07:31:00.000Z", server: "ops", source: "argo", kind: "sync", summary: "logging synced to 4c1e9a2" },
  { at: "2026-10-30T03:12:00.000Z", server: "lab", source: "kubernetes", kind: "status", entity: "lab/app/chaos/chaos-api", level: "attention", summary: "chaos-api (lab) ok → attention: 2 restarts in 24h" },
  { at: "2026-10-30T03:11:58.000Z", server: "lab", source: "kubernetes", kind: "restart", entity: "lab/app/chaos/chaos-api", summary: "chaos-api restarted (OOMKilled)" },
  { at: "2026-10-30T06:58:00.000Z", server: "lab", source: "argo", kind: "sync", summary: "clinic synced to 9d02f7b" },
  { at: "2026-10-30T06:41:00.000Z", server: "ops", source: "gatus", kind: "status", entity: "ops/site/sites_chaos", level: "ok", summary: "chaos.hetops.dev (ops) attention → ok" },
  { at: "2026-10-30T06:22:00.000Z", server: "ops", source: "gatus", kind: "status", entity: "ops/site/sites_chaos", level: "attention", summary: "chaos.hetops.dev (ops) ok → attention: 1 failed in a row" },
  { at: "2026-10-30T03:40:00.000Z", server: "lab", source: "kubernetes", kind: "deploy", summary: "clinic/api rolled out 3/3" },
  { at: "2026-10-30T01:45:09.000Z", server: "ops", source: "snapshots", kind: "info", entity: "ops/backup/nightly-security", summary: "nightly-security snapshot to r2-security" },
  { at: "2026-10-30T01:45:00.000Z", server: "ops", source: "kubernetes", kind: "deploy", summary: "vector rolled out 2/2" },
  { at: "2026-10-30T01:30:04.000Z", server: "ops", source: "snapshots", kind: "info", entity: "ops/backup/nightly-all", summary: "nightly-all snapshot to ops-disk" },
  { at: "2026-10-29T22:10:00.000Z", server: "ops", source: "center", kind: "info", summary: "ops reachable again" },
  { at: "2026-10-29T22:10:00.000Z", server: "lab", source: "center", kind: "info", summary: "lab reachable again" },
];

/** The center, mocked: the state, the last events, who is signed in, and a stream that sends one state then ends (the page re-opens it). */
export async function mockApi(page: Page, state: State = fixtureState, events: Event[] = fixtureEvents) {
  const parsed = StateSchema.parse(state);
  await page.route("**/api/state", r => r.fulfill({ json: parsed }));
  await page.route("**/api/events?*", r => r.fulfill({ json: events }));
  await page.route("**/api/me", r => r.fulfill({ json: { email: "het@hetops.dev", version: "8b74612" } }));
  await page.route("**/api/stream", r => r.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "state", state: parsed })}

` }));
}

/**
 * The lab sources that are still landing (Alertmanager, error budget, CrowdSec, Bedrock drift), shaped as the contracts document
 * them, on a rough night: so the pages are proven to render those kinds. Test data only; production shows what the agents send.
 */
export function roughNight(): State {
  const s = structuredClone(fixtureState);
  s.servers.lab.sources = [...sources, src("alertmanager", 30_000), src("slo", 60_000), src("crowdsec", 60_000), src("bedrock", 300_000)];
  const alert = (name: string, severity: string, since: string, summary: string): Entity => ({ ...base, id: `lab/alert/${name}`, kind: "alert", server: "lab", name,
    source: "alertmanager", status: severity === "critical" ? "down" : severity === "warning" ? "attention" : "ok",
    facts: { firing: { value: 1 }, severity: { value: severity }, since: { value: since }, summary: { value: summary } },
    links: [{ label: "Grafana", href: "https://grafana.hetops.dev/alerting/list" }] });
  const ban = (n: number, ip: string, country: string, scenario: string, expiresIn: number): Entity => ({ ...base, id: `lab/decision/${n}`, kind: "decision", server: "lab",
    name: ip, source: "crowdsec", status: "ok", facts: { ip: { value: ip }, country: { value: country }, scenario: { value: scenario }, origin: { value: "crowdsec" }, expiresIn: { value: expiresIn, unit: "s" } } });
  const host = (name: string, drift: boolean, lastRun: string): Entity => ({ ...base, id: `lab/check/bedrock-${name}`, kind: "check", server: "lab", name, source: "bedrock",
    status: drift ? "attention" : "ok", ...(drift ? { statusReason: "has drifted from its Bedrock state" } : {}), facts: { drift: { value: drift }, lastRun: { value: lastRun } } });
  const bans = [["RU", "crowdsecurity/ssh-bf", 9], ["CN", "crowdsecurity/http-probing", 8], ["US", "crowdsecurity/http-crawl-non_statics", 5],
    ["NL", "crowdsecurity/ssh-bf", 4], ["SG", "crowdsecurity/http-probing", 4], ["BR", "crowdsecurity/ssh-slow-bf", 3], ["IN", "crowdsecurity/http-probing", 2], ["XX", "crowdsecurity/ssh-bf", 2]] as const;
  let n = 0;
  for (const [c, sc, k] of bans) for (let i = 0; i < k; i++) { n++; s.entities.push(ban(n, `${(n * 37) % 223 + 1}.${(n * 91) % 255}.${(n * 13) % 255}.0/24`, c, sc, 14400 - n * 211)); }
  s.entities.push(
    alert("KubePodCrashLooping", "warning", "2026-10-30T03:14:00.000Z", "chaos-api is crash looping in chaos"),
    alert("NodeFilesystemAlmostFull", "critical", "2026-10-30T06:05:00.000Z", "/ on my-workspace is 91% full"),
    alert("CPUThrottlingHigh", "info", "2026-10-30T05:20:00.000Z", "chaos-console is throttled 34%"),
    { ...base, id: "lab/slo/chaos", kind: "slo", server: "lab", name: "clinic availability", source: "slo", status: "ok",
      facts: { objective: { value: 99.5, unit: "%" }, current: { value: 99.71, unit: "%" }, budgetLeft: { value: 58, unit: "%" }, windowDays: { value: 7, unit: "d" } } },
    host("lab", false, "2026-10-30T06:00:00.000Z"), host("staging", true, "2026-10-30T06:00:00.000Z"), host("ops", false, "2026-10-30T06:00:00.000Z"),
    // a Coolify app whose newest commit is not deployed: the one deploy that waits on the owner
    { ...base, id: "lab/app/coolify/radar-cloud", kind: "app", server: "lab", name: "radar-cloud", source: "coolify", status: "attention",
      statusReason: "has commit 7a5cba8 waiting for a deploy", facts: { undeployedCommit: { value: "7a5cba8e41" } } });
  // ops: a site down and the security snapshot failed last night
  const www = s.entities.find(e => e.id === "ops/site/products_threadvault")!;
  Object.assign(www, { status: "down", statusReason: "3 failed in a row: [STATUS] == 200" }); www.facts.httpStatus = { value: 502 };
  const sec = s.entities.find(e => e.id === "ops/backup/nightly-security")!;
  Object.assign(sec, { status: "attention", statusReason: "last run failed: repository r2-security is not reachable" });
  sec.facts.lastOk = { value: "2026-10-29T01:45:09.000Z" }; sec.facts.lastFailure = { value: "2026-10-30T01:45:02.000Z" }; sec.facts.failed = { value: 2 };
  s.series.push({ id: "lab/crowdsec/bans", server: "lab", label: "CrowdSec bans per hour", unit: "bans", stepMs: 3_600_000, observedAt: at, source: "crowdsec",
    points: Array.from({ length: 24 }, (_, i): [number, number] => [Date.parse(at) - (23 - i) * 3_600_000, [1, 0, 2, 3, 1, 0, 0, 4, 2, 1, 3, 2, 5, 1, 0, 2, 1, 3, 2, 0, 1, 2, 4, 1][i]!]) });
  return s;
}
export const roughEvents: Event[] = [
  { at: "2026-10-30T07:20:00.000Z", server: "lab", source: "falco", kind: "info", summary: "Falco: shell spawned in chaos/chaos-api (kubectl exec)" },
  { at: "2026-10-30T06:05:00.000Z", server: "lab", source: "alertmanager", kind: "status", entity: "lab/alert/NodeFilesystemAlmostFull", level: "down", summary: "NodeFilesystemAlmostFull is firing (critical)" },
  { at: "2026-10-30T06:00:00.000Z", server: "lab", source: "bedrock", kind: "status", entity: "lab/check/bedrock-staging", level: "attention", summary: "staging drifted: /etc/ssh/sshd_config differs" },
  { at: "2026-10-30T05:10:00.000Z", server: "ops", source: "gatus", kind: "status", entity: "ops/site/products_threadvault", level: "down", summary: "ThreadVault (ops) ok → down: 3 failed in a row" },
  { at: "2026-10-30T01:45:02.000Z", server: "ops", source: "snapshots", kind: "status", entity: "ops/backup/nightly-security", level: "attention", summary: "nightly-security failed: repository r2-security is not reachable" },
  ...fixtureEvents,
];

/** Two weeks of rollouts and Argo syncs before the fixture's morning, so the Home deploy capsules have history to draw. */
export const deployHistory: Event[] = Array.from({ length: 13 }, (_, d) => d).flatMap(d =>
  Array.from({ length: [3, 5, 2, 7, 4, 6, 9, 3, 2, 8, 5, 4, 6][d]! }, (_, k): Event => ({
    at: new Date(Date.parse(at) - (13 - d) * 86_400_000 - k * 1_800_000).toISOString(), server: k % 3 ? "lab" : "ops", source: k % 2 ? "argo" : "kubernetes",
    kind: k % 2 ? "sync" : "deploy", summary: `${["clinic", "chaos", "logging", "gatus"][k % 4]} ${k % 2 ? "synced" : "rolled out"} (day ${d})` })));
