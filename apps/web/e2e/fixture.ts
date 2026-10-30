import type { Page } from "@playwright/test";
import type { Entity, Event, SourceReport } from "@hetops-control/contracts";
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

export const fixtureState: State = {
  generatedAt: at,
  servers: {
    lab: { status: "attention", statusReason: "chaos-api: 2 restarts in 24h", reachable: true, configured: true, since: "2026-10-29T22:10:00.000Z", agentVersion: "0.1.0", sources },
    staging: { status: "unknown", statusReason: "not connected yet", reachable: false, configured: false, since: "2026-10-30T06:00:00.000Z" },
    ops: { status: "ok", reachable: true, configured: true, since: "2026-10-29T22:10:00.000Z", agentVersion: "0.1.0", sources },
  },
  series: [],
  entities: [
    cluster("lab", "v1.31.4+k3s1", 1, 34, 35), node("lab", "my-workspace", 48, 63, 41),
    ...labApps.map(([ns, n, p, r, l]) => app("lab", ns, n, p, r, l)), argo("lab", "clinic"), argo("lab", "chaos"),
    cluster("ops", "v1.31.4+k3s1", 1, 12, 12), node("ops", "hetops-3", 71, 78, 55),
    ...opsApps.map(([ns, n, p]) => app("ops", ns, n, p)), argo("ops", "logging"),
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
  { at: "2026-10-30T01:45:00.000Z", server: "ops", source: "kubernetes", kind: "deploy", summary: "vector rolled out 2/2" },
  { at: "2026-10-29T22:10:00.000Z", server: "ops", source: "center", kind: "info", summary: "ops reachable again" },
  { at: "2026-10-29T22:10:00.000Z", server: "lab", source: "center", kind: "info", summary: "lab reachable again" },
];

/** The center, mocked: the state, the last events, who is signed in, and a stream that sends one state then ends (the page re-opens it). */
export async function mockApi(page: Page, state: State = fixtureState) {
  const parsed = StateSchema.parse(state);
  await page.route("**/api/state", r => r.fulfill({ json: parsed }));
  await page.route("**/api/events?*", r => r.fulfill({ json: fixtureEvents }));
  await page.route("**/api/me", r => r.fulfill({ json: { email: "het@hetops.dev", version: "8b74612" } }));
  await page.route("**/api/stream", r => r.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "state", state: parsed })}

` }));
}
