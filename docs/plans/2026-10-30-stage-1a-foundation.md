# HetOps Control, stage 1a (foundation): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `control.hetops.dev` shows the lab and ops servers live: the headline, "Needs you", the forest generated from the real clusters, host-load dials and a merged timeline, served by a center on hetops-3 that reads two agents.

**Architecture:** a pnpm workspace with four packages. `packages/contracts` defines `Entity`, `Event`, `Source`, the agent and center APIs as zod schemas (types derived from them). `apps/agent` runs sources on schedules and serves `/v1/state` and `/v1/stream` (SSE). `apps/center` subscribes to each agent, merges and ages state, records status changes as events in SQLite, verifies Cloudflare Access, and serves `/api/*` plus the built web app. `apps/web` is a Svelte 5 app ported from `docs/design/home.html`.

**Tech Stack:** Node 22, TypeScript 5, pnpm 9 workspaces, zod 3, Fastify 5, `@kubernetes/client-node`, `better-sqlite3`, `jose`, Svelte 5 + Vite 6, Vitest 2, Playwright, Docker (arm64), GitHub Actions, GHCR, cosign, Argo CD, Sealed Secrets.

**Spec:** [docs/specs/2026-10-30-hetops-control-design.md](../specs/2026-10-30-hetops-control-design.md). Stage 1b (Alertmanager, Gatus, Elasticsearch, Coolify, CrowdSec, Timeline, Bedrock drift, backups sources and their modules and pages) gets its own plan once 1a is live.

## Global Constraints

- Node 22 LTS, TypeScript `strict: true`, ESM everywhere (`"type": "module"`).
- Every network payload is validated with its zod schema on both sides; types come from `z.infer`, never hand-written twice.
- Entity `status`: exactly `"ok" | "attention" | "down" | "unknown"`. Anything older than 3 × its source's period, or from an unreachable agent, is `unknown`, never shown as healthy.
- Agent API: `GET /healthz` (no auth), `GET /v1/state`, `GET /v1/stream` (SSE), all but `/healthz` require `Authorization: Bearer <token>` compared in constant time. Agent port **7443**.
- Center API: `GET /healthz`, `GET /api/state`, `GET /api/stream` (SSE), `GET /api/events?limit=`; every `/api/*` and the web app require a valid Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`), except when `CONTROL_DEV=1`, which is only honoured when the server listens on `127.0.0.1`.
- Secrets never in a command line, image, log or the browser.
- UI: the tokens, type and motion of `docs/design/home.html`; ember only for "needs you"; animations only on transform/opacity/stroke; everything off under `prefers-reduced-motion`; no class or id containing policy, cookie, consent, banner, ad, sponsor, promo.
- Containers: non-root (uid 10001), read-only root filesystem, no privilege escalation, all capabilities dropped, `seccompProfile: RuntimeDefault`.
- Commits: author `Het Patel <patel.x.het@gmail.com>`, GPG-signed (`-S`), never `--no-gpg-sign`, no Claude attribution, subject under 72 characters. Push with the Het101 token. One branch and PR per task once the GitHub repo exists; before that, commit on `main` locally.
- Journal: every step and mistake into `C:\Users\HetPatel\Personal\HetOps\journal-pending.md` (the controller writes it from reports).

## File structure

```text
package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.workspace.ts, .github/workflows/ci.yml
packages/contracts/src/{entity.ts, event.ts, agent-api.ts, index.ts}, test/contracts.test.ts
apps/agent/src/{server.ts, registry.ts, auth.ts, config.ts, main.ts}
apps/agent/src/sources/{kubernetes.ts, argo.ts, hostload.ts}
apps/agent/test/{server.test.ts, kubernetes.test.ts, argo.test.ts, hostload.test.ts}, test/fixtures/*.json
apps/agent/Dockerfile
apps/center/src/{agents.ts, store.ts, events-db.ts, access.ts, headline.ts, server.ts, config.ts, main.ts}
apps/center/test/{store.test.ts, headline.test.ts, access.test.ts, agents.test.ts}
apps/center/Dockerfile   (also builds and serves apps/web)
apps/web/src/{App.svelte, main.ts, styles/tokens.css, lib/api.ts, lib/forest.ts, lib/motion.ts}
apps/web/src/components/{Rail.svelte, NavIcon.svelte, Headline.svelte, NeedsYou.svelte, Forest.svelte, Dial.svelte, HostLoad.svelte, Timeline.svelte}
apps/web/test/forest.test.ts, apps/web/e2e/home.spec.ts
```

Deployment lives in `Het101/hetops-k8s-lab` (Tasks 8 and 9).

---

### Task 1: Workspace and contracts

**Files:** root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`; `packages/contracts/**`.

**Interfaces — Produces** (exported from `@hetops-control/contracts`):
`ServerId`, `Status`, `EntityKind`, `Fact`, `Link`, `Entity`, `Event`, `SourceReport`, `AgentState`, `StreamMessage` (schemas `*Schema` and types), and `worst(statuses: Status[]): Status`.

- [ ] **Step 1: Workspace files.**

`package.json`:
```json
{ "name": "hetops-control", "private": true, "type": "module",
  "packageManager": "pnpm@9.12.3",
  "scripts": { "test": "vitest run", "typecheck": "pnpm -r exec tsc --noEmit", "build": "pnpm -r build" },
  "devDependencies": { "typescript": "5.6.3", "vitest": "2.1.4", "@types/node": "22.9.0" } }
```
`pnpm-workspace.yaml`: `packages: ["packages/*", "apps/*"]`.
`tsconfig.base.json`: `{"compilerOptions":{"target":"ES2023","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"noUncheckedIndexedAccess":true,"esModuleInterop":true,"skipLibCheck":true,"declaration":true,"outDir":"dist"}}`.
`vitest.workspace.ts`: `export default ["packages/*", "apps/agent", "apps/center", "apps/web"];`

- [ ] **Step 2: The failing contract test** `packages/contracts/test/contracts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EntitySchema, AgentStateSchema, worst } from "../src/index.js";

const entity = { id: "lab/app/clinic/api", kind: "app", server: "lab", name: "api", status: "ok",
  facts: { pods: { value: 3, unit: "pods" }, restarts24h: { value: 0 } }, links: [], actions: [],
  observedAt: "2026-10-30T11:33:44Z", parent: "lab/cluster" };

describe("contracts", () => {
  it("accepts a valid entity", () => { expect(EntitySchema.parse(entity)).toEqual(entity); });
  it("rejects an unknown status", () => { expect(() => EntitySchema.parse({ ...entity, status: "green" })).toThrow(); });
  it("rejects a server outside the estate", () => { expect(() => EntitySchema.parse({ ...entity, server: "mars" })).toThrow(); });
  it("worst() orders down > attention > unknown > ok", () => {
    expect(worst(["ok", "attention"])).toBe("attention");
    expect(worst(["ok", "unknown"])).toBe("unknown");
    expect(worst(["attention", "down", "ok"])).toBe("down");
    expect(worst([])).toBe("unknown");
  });
  it("accepts an agent state with a failed source", () => {
    const s = { server: "lab", version: "0.1.0", generatedAt: "2026-10-30T11:33:44Z", entities: [entity],
      sources: [{ id: "kubernetes", periodMs: 10000, ok: true, lastRunAt: "2026-10-30T11:33:44Z" },
                { id: "argo", periodMs: 15000, ok: false, lastRunAt: "2026-10-30T11:33:40Z", error: "forbidden" }] };
    expect(AgentStateSchema.parse(s).sources[1]!.error).toBe("forbidden");
  });
});
```

Run `pnpm vitest run packages/contracts` → fails (module missing).

- [ ] **Step 3: Contracts.** `packages/contracts/src/entity.ts`:

```ts
import { z } from "zod";
export const ServerIdSchema = z.enum(["lab", "staging", "ops"]);
export const StatusSchema = z.enum(["ok", "attention", "down", "unknown"]);
export const EntityKindSchema = z.enum(["server", "cluster", "node", "app", "argo-app", "site", "alert", "backup", "check"]);
export const FactSchema = z.object({ value: z.union([z.number(), z.string(), z.boolean()]), unit: z.string().optional(), max: z.number().optional() });
export const LinkSchema = z.object({ label: z.string(), href: z.string().url() });
export const ActionRefSchema = z.object({ id: z.string(), label: z.string(), risk: z.enum(["safe", "disruptive"]) });
export const EntitySchema = z.object({
  id: z.string().min(1), kind: EntityKindSchema, server: ServerIdSchema, name: z.string(),
  status: StatusSchema, statusReason: z.string().optional(),
  facts: z.record(FactSchema), links: z.array(LinkSchema), actions: z.array(ActionRefSchema),
  observedAt: z.string().datetime(), parent: z.string().optional(),
});
export type ServerId = z.infer<typeof ServerIdSchema>; export type Status = z.infer<typeof StatusSchema>;
export type EntityKind = z.infer<typeof EntityKindSchema>; export type Fact = z.infer<typeof FactSchema>;
export type Entity = z.infer<typeof EntitySchema>;
const rank: Record<Status, number> = { ok: 0, unknown: 1, attention: 2, down: 3 };
export function worst(s: Status[]): Status { return s.length ? s.reduce((a, b) => (rank[b] > rank[a] ? b : a)) : "unknown"; }
```

`event.ts`:
```ts
import { z } from "zod"; import { ServerIdSchema } from "./entity.js";
export const EventSchema = z.object({ at: z.string().datetime(), server: ServerIdSchema, source: z.string(),
  kind: z.enum(["status", "restart", "deploy", "sync", "action", "info"]), summary: z.string(),
  entity: z.string().optional(), actor: z.string().optional() });
export type Event = z.infer<typeof EventSchema>;
```

`agent-api.ts`:
```ts
import { z } from "zod"; import { EntitySchema, ServerIdSchema } from "./entity.js"; import { EventSchema } from "./event.js";
export const SourceReportSchema = z.object({ id: z.string(), periodMs: z.number().int().positive(), ok: z.boolean(),
  lastRunAt: z.string().datetime().optional(), error: z.string().optional() });
export const AgentStateSchema = z.object({ server: ServerIdSchema, version: z.string(), generatedAt: z.string().datetime(),
  entities: z.array(EntitySchema), sources: z.array(SourceReportSchema) });
export const StreamMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), state: AgentStateSchema }),
  z.object({ type: z.literal("event"), event: EventSchema }) ]);
export type SourceReport = z.infer<typeof SourceReportSchema>; export type AgentState = z.infer<typeof AgentStateSchema>;
export type StreamMessage = z.infer<typeof StreamMessageSchema>;
```

`index.ts` re-exports all three. `packages/contracts/package.json`: name `@hetops-control/contracts`, `"exports": {".": "./src/index.ts"}`, dependency `zod@3.23.8`.

- [ ] **Step 4:** `pnpm install && pnpm vitest run packages/contracts` → 5 pass; `pnpm typecheck` clean.
- [ ] **Step 5: Commit** `feat(contracts): entity, event and agent API schemas`.

---

### Task 2: Agent core (registry, scheduler, API, SSE, auth)

**Files:** `apps/agent/src/{registry.ts,auth.ts,server.ts,config.ts,main.ts}`, `apps/agent/test/server.test.ts`, `apps/agent/package.json`, `apps/agent/tsconfig.json`.

**Interfaces — Produces:**
- `interface Source { id: string; periodMs: number; collect(ctx: SourceContext): Promise<{ entities: Entity[]; events?: Event[] }> }`, `type SourceContext = { server: ServerId; now: () => Date }`
- `class Registry { constructor(server: ServerId, sources: Source[], now?: () => Date); start(): void; stop(): void; runOnce(id: string): Promise<void>; state(): AgentState; on(listener: (m: StreamMessage) => void): () => void }`
- `buildServer(reg: Registry, token: string): FastifyInstance`
- `bearerOk(header: string | undefined, token: string): boolean` (constant time)

- [ ] **Step 1: Failing tests** `apps/agent/test/server.test.ts` (Fastify `inject`, a fake source):

```ts
import { describe, it, expect } from "vitest";
import { Registry } from "../src/registry.js"; import { buildServer } from "../src/server.js";
import { AgentStateSchema } from "@hetops-control/contracts";

const t0 = new Date("2026-10-30T11:00:00Z");
const fake = (status: "ok" | "down" = "ok") => ({ id: "fake", periodMs: 10_000, async collect() {
  return { entities: [{ id: "lab/app/x", kind: "app" as const, server: "lab" as const, name: "x", status, facts: {}, links: [], actions: [], observedAt: t0.toISOString() }] }; } });
const broken = { id: "broken", periodMs: 10_000, async collect(): Promise<never> { throw new Error("forbidden"); } };

describe("agent", () => {
  it("requires the bearer token on /v1/state but not on /healthz", async () => {
    const reg = new Registry("lab", [fake()], () => t0); await reg.runOnce("fake");
    const app = buildServer(reg, "s3cret");
    expect((await app.inject("/healthz")).statusCode).toBe(200);
    expect((await app.inject("/v1/state")).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/state", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    const ok = await app.inject({ url: "/v1/state", headers: { authorization: "Bearer s3cret" } });
    expect(ok.statusCode).toBe(200);
    const st = AgentStateSchema.parse(ok.json()); expect(st.entities).toHaveLength(1);
  });
  it("reports a failing source without losing the others", async () => {
    const reg = new Registry("lab", [fake(), broken], () => t0);
    await reg.runOnce("fake"); await reg.runOnce("broken");
    const s = reg.state();
    expect(s.sources.find(x => x.id === "broken")).toMatchObject({ ok: false, error: "forbidden" });
    expect(s.entities.map(e => e.id)).toEqual(["lab/app/x"]);
  });
  it("emits a state message to listeners after each run", async () => {
    const reg = new Registry("lab", [fake()], () => t0); const got: string[] = [];
    reg.on(m => got.push(m.type)); await reg.runOnce("fake"); expect(got).toContain("state");
  });
});
```

- [ ] **Step 2:** run → fails.
- [ ] **Step 3: Implement.**

`auth.ts`:
```ts
import { timingSafeEqual } from "node:crypto";
export function bearerOk(h: string | undefined, token: string): boolean {
  if (!h?.startsWith("Bearer ")) return false;
  const a = Buffer.from(h.slice(7)), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

`registry.ts`: keeps `Map<sourceId, {entities, report}>`; `runOnce(id)` calls `collect` with a timeout of `min(periodMs, 30000)`, on success replaces that source's entities and sets `ok: true, lastRunAt`, on failure keeps nothing from that source (its entities disappear, so the center ages them to unknown) and sets `ok: false, error: err.message` (message only, never stack or payload); validates every entity with `EntitySchema.parse` (a bad entity is a source error); then notifies listeners with `{type:"state", state: this.state()}` and `{type:"event", …}` for each returned event. `start()` runs each source immediately, then on `setInterval(periodMs)` with a guard so runs of one source never overlap; `stop()` clears intervals. `state()` returns `{server, version: process.env.VERSION ?? "dev", generatedAt: now().toISOString(), entities: all sources' entities sorted by id, sources: reports}`.

`server.ts`:
```ts
import Fastify from "fastify"; import type { Registry } from "./registry.js"; import { bearerOk } from "./auth.js";
export function buildServer(reg: Registry, token: string) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization"] } });
  app.get("/healthz", async () => ({ ok: true }));
  app.addHook("onRequest", async (req, rep) => { if (req.url !== "/healthz" && !bearerOk(req.headers.authorization, token)) return rep.code(401).send({ error: "unauthorized" }); });
  app.get("/v1/state", async () => reg.state());
  app.get("/v1/stream", (req, rep) => {
    rep.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const send = (m: unknown) => rep.raw.write(`data: ${JSON.stringify(m)}\n\n`);
    send({ type: "state", state: reg.state() });
    const off = reg.on(send); const ping = setInterval(() => rep.raw.write(": ping\n\n"), 15_000);
    req.raw.on("close", () => { off(); clearInterval(ping); });
  });
  return app;
}
```

`config.ts`: reads `SERVER` (validated with `ServerIdSchema`), `AGENT_TOKEN_FILE` (token read from that file, trimmed; refuses to start if empty), `TLS_CERT_FILE`/`TLS_KEY_FILE` (optional: when set, Fastify `https`), `PORT` (default 7443), `HOST` (default `0.0.0.0`). `main.ts` wires config → sources (Task 3) → `Registry.start()` → `buildServer(...).listen`.

- [ ] **Step 4:** tests pass; typecheck clean.
- [ ] **Step 5: Commit** `feat(agent): source registry, state API and SSE stream`.

---

### Task 3: Agent sources: Kubernetes, Argo CD, host load

**Files:** `apps/agent/src/sources/{kubernetes.ts,argo.ts,hostload.ts}`, tests and fixtures in `apps/agent/test/`.

**Interfaces — Consumes:** `Source`, `SourceContext` (Task 2). **Produces:**
- `kubernetesSource(api: KubeReader, opts?: { namespaces?: string[] }): Source` (id `kubernetes`, period 10 s) — entities: one `cluster` (`<server>/cluster`, facts `version`, `nodes`, `podsRunning`, `podsTotal`), one `app` per workload (Deployment, StatefulSet, DaemonSet) id `<server>/app/<ns>/<name>`, parent `<server>/cluster`, facts `namespace`, `pods` (ready), `podsDesired`, `restarts24h`, `lastRestartAt`; status: `down` if 0 ready and desired > 0, `attention` if ready < desired or restarts24h > 0, else `ok`; events: one `restart` event per container restart seen since the previous run.
- `argoSource(api: KubeReader): Source` (id `argo`, period 15 s) — `argo-app` per `applications.argoproj.io` in `argocd`, facts `sync`, `health`, `revision`; status `ok` when Synced+Healthy, `attention` when OutOfSync or Progressing/Degraded for over 10 min (keep first-seen times), `down` when Missing/Degraded over 30 min.
- `hostloadSource(api: KubeReader): Source` (id `hostload`, period 15 s) — one `node` entity per node from `/api/v1/nodes/<n>/proxy/stats/summary`: facts `cpu` (`usageNanoCores / (capacity cores × 1e9)` in %, max 100), `memory` (`workingSetBytes / capacity`), `disk` (`fs.usedBytes / fs.capacityBytes`); status `attention` above 85% for memory or disk, or CPU above 85%.
- `interface KubeReader { listNodes(): Promise<any[]>; listPods(): Promise<any[]>; listWorkloads(): Promise<any[]>; listArgoApps(): Promise<any[]>; nodeSummary(node: string): Promise<any>; version(): Promise<string> }` with `realKube()` implementing it via `@kubernetes/client-node` (in-cluster config) — the sources take the interface so tests use fixtures.

- [ ] **Step 1: Record fixtures** from the live lab, read-only, stripped of anything sensitive (no env, no annotations with secrets, no IPs beyond node names): run on the lab `kubectl get nodes -o json`, `kubectl get pods -A -o json`, `kubectl get deploy,sts,ds -A -o json`, `kubectl -n argocd get applications -o json`, `kubectl get --raw /api/v1/nodes/my-workspace/proxy/stats/summary`, then a python filter that keeps only the fields the sources read (`metadata.name/namespace/ownerReferences/labels.app`, `status.containerStatuses[].restartCount/lastState.terminated.finishedAt/reason`, `spec.replicas`, `status.readyReplicas/numberReady/desiredNumberScheduled`, Argo `status.sync.status/revision`, `status.health.status`, node `status.capacity`, summary `node.cpu/memory/fs`). Save as `apps/agent/test/fixtures/{nodes,pods,workloads,argo,summary}.json`. Grep the fixtures for `password|token|secret|key` before committing: zero hits.
- [ ] **Step 2: Failing tests** (one file per source), e.g. `kubernetes.test.ts`:

```ts
import { describe, it, expect } from "vitest"; import { kubernetesSource } from "../src/sources/kubernetes.js";
import nodes from "./fixtures/nodes.json"; import pods from "./fixtures/pods.json"; import workloads from "./fixtures/workloads.json";
const kube = (over: Partial<Record<string, unknown>> = {}) => ({ listNodes: async () => nodes.items, listPods: async () => pods.items,
  listWorkloads: async () => workloads.items, listArgoApps: async () => [], nodeSummary: async () => ({}), version: async () => "v1.35.9", ...over });
const ctx = { server: "lab" as const, now: () => new Date("2026-10-30T12:00:00Z") };

describe("kubernetes source", () => {
  it("makes one cluster and one app per workload", async () => {
    const { entities } = await kubernetesSource(kube() as any).collect(ctx);
    expect(entities.filter(e => e.kind === "cluster")).toHaveLength(1);
    expect(entities.filter(e => e.kind === "app").length).toBe(workloads.items.length);
    expect(entities.every(e => e.kind === "cluster" || e.parent === "lab/cluster")).toBe(true);
  });
  it("marks a workload with no ready pods down and one with restarts attention", async () => {
    const w = structuredClone(workloads.items); (w[0] as any).status.readyReplicas = 0;
    const p = structuredClone(pods.items); (p[0] as any).status.containerStatuses[0].restartCount = 3;
    (p[0] as any).status.containerStatuses[0].lastState = { terminated: { finishedAt: "2026-10-30T03:12:00Z", reason: "OOMKilled" } };
    const { entities } = await kubernetesSource(kube({ listWorkloads: async () => w, listPods: async () => p }) as any).collect(ctx);
    expect(entities.some(e => e.status === "down")).toBe(true);
    expect(entities.some(e => e.status === "attention" && Number(e.facts.restarts24h?.value) > 0)).toBe(true);
  });
  it("emits a restart event only for restarts new since the last run", async () => {
    let current: unknown[] = pods.items;
    const src = kubernetesSource(kube({ listPods: async () => current }) as any);
    expect((await src.collect(ctx)).events ?? []).toHaveLength(0);           // first run: baseline only
    const p = structuredClone(pods.items); (p[0] as any).status.containerStatuses[0].restartCount += 1; current = p;
    const second = await src.collect(ctx);
    expect(second.events ?? []).toHaveLength(1);                               // one new restart
    expect(second.events![0]!.kind).toBe("restart");
    expect((await src.collect(ctx)).events ?? []).toHaveLength(0);            // nothing new
  });
});
```

(`argo.test.ts` and `hostload.test.ts` follow the same pattern: Argo fixture → every app an `argo-app` with `sync`/`health` facts and the right status for a mutated OutOfSync app with a first-seen time 11 minutes before `now`; summary fixture → CPU fact = `1361089885 / (4 × 1e9) × 100 ≈ 34.0` (rounded to one decimal), memory and disk within 0–100.) Each pod's owning workload is resolved through `ownerReferences` (Pod → ReplicaSet → Deployment by the ReplicaSet name prefix, or directly StatefulSet/DaemonSet).

- [ ] **Step 3:** run → fails. **Step 4:** implement the three sources against `KubeReader`, plus `realKube()` (client-node `CoreV1Api`, `AppsV1Api`, `CustomObjectsApi`, `VersionApi`, and `/api/v1/nodes/{n}/proxy/stats/summary` through the core API's `connectGetNodeProxyWithPath`). **Step 5:** tests pass; `pnpm typecheck`.
- [ ] **Step 6: Commit** `feat(agent): kubernetes, argo and host-load sources`.

---

### Task 4: Center: agent links, merged store, ageing, events in SQLite

**Files:** `apps/center/src/{agents.ts,store.ts,events-db.ts,config.ts}`, tests.

**Interfaces — Produces:**
- `class Store { constructor(now?: () => Date); apply(server: ServerId, s: AgentState): Event[]; markUnreachable(server: ServerId, since: Date): Event[]; snapshot(): CenterState; on(fn: (m: CenterMessage) => void): () => void }` — `apply` returns status-change events (`kind: "status"`, summary like `"api (lab) ok → attention: 3 restarts"`).
- `CenterState = { generatedAt: string; servers: Record<ServerId, { status: Status; reachable: boolean; since: string; agentVersion?: string }>; entities: Entity[] }` (zod `CenterStateSchema` added to contracts).
- `ageing`: `snapshot()` sets an entity `unknown` (statusReason `"stale: no data for 45 s"`) when `now - observedAt > 3 × periodMs` of its source (from the agent's `sources[]`); an unreachable server's entities all become `unknown` with reason `"agent unreachable since <t>"`.
- `class EventsDb { constructor(path: string); add(e: Event): void; recent(limit: number): Event[]; prune(olderThanDays = 30): void }` (`better-sqlite3`, WAL, table `events(at TEXT, server TEXT, source TEXT, kind TEXT, summary TEXT, entity TEXT, actor TEXT)`, index on `at`).
- `class AgentLink { constructor(server: ServerId, url: string, token: string, ca?: Buffer); start(store: Store, db: EventsDb): void; stop(): void }` — fetches `/v1/state`, then reads `/v1/stream`; on error or 20 s without data marks the server unreachable and reconnects with backoff 1 s → 30 s (jittered).

- [ ] **Step 1: Failing tests** `store.test.ts`:

```ts
import { describe, it, expect } from "vitest"; import { Store } from "../src/store.js";
const at = (s: string) => new Date(`2026-10-30T12:00:${s}Z`);
const state = (status: "ok" | "attention", observed = "2026-10-30T12:00:00Z") => ({ server: "lab" as const, version: "0.1.0", generatedAt: observed,
  sources: [{ id: "kubernetes", periodMs: 10000, ok: true, lastRunAt: observed }],
  entities: [{ id: "lab/app/clinic/api", kind: "app" as const, server: "lab" as const, name: "api", status, facts: {}, links: [], actions: [], observedAt: observed }] });

describe("store", () => {
  it("records a status change as an event", () => {
    let now = at("00"); const st = new Store(() => now);
    expect(st.apply("lab", state("ok"))).toHaveLength(0);
    now = at("10"); const ev = st.apply("lab", state("attention", "2026-10-30T12:00:10Z"));
    expect(ev).toHaveLength(1); expect(ev[0]!.summary).toContain("ok → attention");
  });
  it("ages data older than 3 periods to unknown", () => {
    let now = at("00"); const st = new Store(() => now); st.apply("lab", state("ok"));
    now = new Date("2026-10-30T12:00:31Z"); expect(st.snapshot().entities[0]!.status).toBe("unknown");
  });
  it("an unreachable agent turns its server and entities unknown", () => {
    const st = new Store(() => at("00")); st.apply("lab", state("ok")); st.markUnreachable("lab", at("05"));
    const s = st.snapshot(); expect(s.servers.lab.status).toBe("unknown"); expect(s.servers.lab.reachable).toBe(false);
    expect(s.entities.every(e => e.status === "unknown")).toBe(true);
  });
  it("staging, never connected, is unknown and not reachable", () => {
    expect(new Store().snapshot().servers.staging).toMatchObject({ status: "unknown", reachable: false });
  });
});
```

`agents.test.ts`: start a real agent `buildServer` (Task 2) on a random localhost port with a fake source; an `AgentLink` against it fills the store within 2 s; closing the agent marks the server unreachable within 25 s (use fake timers for the 20 s silence rule). `events-db.test.ts`: add three events, `recent(2)` returns the newest two newest-first; `prune(30)` removes a 31-day-old one (tmp file DB).

- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass. **Step 5: Commit** `feat(center): agent links, merged state with ageing, event log`.

---

### Task 5: Center: headline and "Needs you", Access, API and SSE

**Files:** `apps/center/src/{headline.ts,access.ts,server.ts,main.ts}`, tests.

**Interfaces — Produces:**
- `headline(s: CenterState): { title: string; emphasis?: string; detail: string; needs: Need[] }` with `Need = { entity: string; server: ServerId; text: string; detail: string; action?: ActionRef }`. Rules (in order): any server unreachable → title "We can't see <server>.", emphasis "Its agent has been silent since <hh:mm>."; any `down` → "Something is down.", emphasis "<n> thing(s) need you now."; any `attention` → "The estate is healthy." / "<n> thing(s) are waiting on you." (attention items become needs); else "The estate is healthy." / no emphasis. `detail` is one sentence naming the top two items by severity then recency (for example "chaos-api restarted twice at 03:12."). Staging that was never connected is not a "need" in stage 1.
- `verifyAccess(jwt: string | undefined, cfg: { teamDomain: string; aud: string }): Promise<{ email: string }>` using `jose` `createRemoteJWKSet(new URL(\`https://${teamDomain}/cdn-cgi/access/certs\`))`, `jwtVerify(jwt, jwks, { audience: aud, issuer: \`https://${teamDomain}\` })`; throws on anything missing or invalid.
- `buildCenter({ store, db, access, webRoot }): FastifyInstance` with `/healthz`, `/api/state` (`{ ...snapshot, headline: headline(snapshot) }`), `/api/stream` (SSE: full state on connect, then a debounced (250 ms) full state on every store change, plus `event` messages), `/api/events?limit=50` (max 500), and static files from `webRoot` with `index.html` fallback; an `onRequest` hook enforces Access on everything except `/healthz`.

- [ ] **Step 1: Failing tests** `headline.test.ts`: four snapshots (all ok; one attention app with `restarts24h: 2` and `lastRestartAt 03:12`; one down; lab unreachable since 07:40) → the exact titles above; the attention case yields one need whose `text` names the app and server. `access.test.ts`: generate an RS256 key pair with `jose`, serve its JWKS from a local HTTP server, sign tokens: valid (right aud/iss/unexpired) → email; wrong aud → throws; expired → throws; missing → throws. `server.test.ts`: with access stubbed to reject, `/api/state` → 403 and `/healthz` → 200; with it stubbed to accept, `/api/state` returns a `headline`; `/api/events?limit=9999` caps at 500.
- [ ] **Step 2:** fail. **Step 3:** implement. `main.ts`: config `AGENTS` = JSON array `[{server, url, tokenFile, caFile?}]`, `DB_PATH`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `WEB_ROOT`, `PORT=8080`; starts one `AgentLink` per agent, `db.prune` daily. `CONTROL_DEV=1` replaces `verifyAccess` with a fixed `{email:"dev@local"}` only when `HOST=127.0.0.1` (refuse to start otherwise). **Step 4:** pass.
- [ ] **Step 5: Commit** `feat(center): headline, Access verification, API and live stream`.

---

### Task 6: Web: design system, rail, Home with the live forest

**Files:** `apps/web/**`.

**Interfaces — Consumes:** `/api/state`, `/api/stream`, `/api/events` (Task 5); `CenterState`, `Entity`, `Event`, headline shape. **Produces** the built app in `apps/web/dist` (the center serves it).

The visual source of truth is `docs/design/home.html`: copy its CSS custom properties, surfaces (`.raised`, `.pressed`), type, rail, icon animations and keyframes verbatim into `src/styles/tokens.css` and the components; port its JavaScript into the modules below. Nothing in the mock that is fake data stays: every number comes from the API.

- [ ] **Step 1: The forest generator as a pure, tested module** `src/lib/forest.ts`:

```ts
export type Leaf = { x: number; y: number; r: number; tone: number; ember: boolean };
export type Branch = { app: string; d: string; width: number; leaves: Leaf[]; restarts: number; status: Status };
export type Tree = { server: ServerId; x: number; trunk: string; roots: string[]; branches: Branch[] };
export function growTree(server: ServerId, x: number, apps: { id: string; name: string; pods: number; restarts: number; status: Status }[]): Tree;
```
Seeded by a hash of `server + app id` (so adding an app does not reshuffle the others); geometry exactly as the mock (`len = 55 + r·45 + pods·3`, leaves `pods × 5`, ember leaves `min(restarts × 6, leaves)` for apps with restarts or status attention/down); apps sorted by id; at most 14 branches (the rest merged into one "+N more" branch) so the lab stays readable.

`test/forest.test.ts`:
```ts
import { describe, it, expect } from "vitest"; import { growTree } from "../src/lib/forest.js";
const apps = [{ id: "lab/app/clinic/api", name: "api", pods: 3, restarts: 0, status: "ok" as const },
              { id: "lab/app/chaos/chaos-api", name: "chaos-api", pods: 1, restarts: 2, status: "attention" as const }];
describe("forest", () => {
  it("is deterministic for the same estate", () => { expect(growTree("lab", 200, apps)).toEqual(growTree("lab", 200, apps)); });
  it("adding an app does not move the others", () => {
    const a = growTree("lab", 200, apps), b = growTree("lab", 200, [...apps, { id: "lab/app/x/y", name: "y", pods: 1, restarts: 0, status: "ok" }]);
    expect(b.branches.find(x => x.app === "api")!.leaves).toEqual(a.branches.find(x => x.app === "api")!.leaves);
  });
  it("only struggling apps get ember leaves", () => {
    const t = growTree("lab", 200, apps);
    expect(t.branches.find(b => b.app === "api")!.leaves.some(l => l.ember)).toBe(false);
    expect(t.branches.find(b => b.app === "chaos-api")!.leaves.filter(l => l.ember).length).toBeGreaterThan(0);
  });
  it("caps branches at 14", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `lab/app/n/a${i}`, name: `a${i}`, pods: 1, restarts: 0, status: "ok" as const }));
    expect(growTree("lab", 200, many).branches).toHaveLength(14);
  });
});
```
(The "does not move the others" rule means per-branch angles come from the branch's own hash, not its index; the mock's index-based fan is replaced by sorting branches by their hash-derived angle within the -160°..-20° fan.)

- [ ] **Step 2: Components** (Svelte 5 runes): `Rail` + `NavIcon` (the eight icons and their hover/active animations from the mock; Home active; the others are disabled links with a "stage 1b" tooltip until their pages exist), `Headline` (date in UTC, title, ember emphasis, detail with count-up for numbers), `NeedsYou` (list of needs; the ember button is shown but disabled with "actions arrive in stage 2"), `Forest` (three trees from `/api/state` entities: `app` entities grouped by server; sway, falling leaves and rising embers as in the mock; station labels: name, `cluster` facts, status word: HEALTHY / SMOULDERING · n restarts / DOWN / NOT CONNECTED (staging) / UNREACHABLE in ember), `Dial` + `HostLoad` (one dial per server from its `node` entity CPU; memory and disk as small text under each), `Timeline` (latest 6 events, player-list rows; status events with ember styling when they go to attention/down). `lib/api.ts`: loads `/api/state`, then `EventSource('/api/stream')` with automatic reconnect; shows "live · n s ago" from the last message, ember "reconnecting" after 10 s.
- [ ] **Step 3: Motion budget.** `lib/motion.ts` exports `reduced` (media query) and the shared easing; every animation honours it. Leaves are drawn once per data change (keyed), only CSS animations run per frame; no `requestAnimationFrame` loops except the count-up.
- [ ] **Step 4: E2E smoke** `e2e/home.spec.ts` (Playwright, against `vite preview` with a mocked `/api/*` from a fixture `CenterState`): the headline text renders; three station labels; at least one ember leaf for the fixture's attention app; with `reducedMotion: "reduce"` no element has a running animation (`document.getAnimations().filter(a => a.playState === "running").length === 0`).
- [ ] **Step 5:** `pnpm --filter web test && pnpm --filter web build && pnpm --filter web e2e` pass.
- [ ] **Step 6: Commit** `feat(web): design system, rail and live home`.

---

### Task 7: Images and CI

**Files:** `apps/agent/Dockerfile`, `apps/center/Dockerfile`, `.github/workflows/ci.yml`, `.github/dependabot.yml`.

- [ ] **Step 1: Dockerfiles** (multi-stage, `node:22-alpine` pinned by digest, `pnpm deploy --prod` into the final stage, `USER 10001`, `ENTRYPOINT ["node","dist/main.js"]`, `HEALTHCHECK` none (Kubernetes probes do it)). The center image runs the web build in its build stage and copies `apps/web/dist` to `/app/web`.
- [ ] **Step 2: CI** — on PR: `pnpm install --frozen-lockfile`, typecheck, `vitest run`, web e2e (Playwright chromium), `docker buildx build --platform linux/arm64` for both (no push). On push to `main`: same, then push `ghcr.io/het101/hetops-control-agent:<sha>` and `…-center:<sha>` (and `:main`), sign both with `cosign sign --yes` (keyless, `id-token: write`), attach an SBOM (`syft`) attestation. Actions pinned by SHA; `permissions: contents: read, packages: write, id-token: write` only on the publish job; runner `ubuntu-24.04-arm`.
- [ ] **Step 3:** push the branch, CI green; on merge, both images appear in GHCR and `cosign verify --certificate-identity-regexp 'https://github.com/Het101/hetops-control/' --certificate-oidc-issuer https://token.actions.githubusercontent.com ghcr.io/het101/hetops-control-center:<sha>` succeeds. Make both GHCR packages public (owner, one click each, the first time).
- [ ] **Step 4: Commit** `ci: test, build, sign and publish arm64 images`.

---

### Task 8: Deploy on hetops-3 (center + ops agent)

**Repo:** `Het101/hetops-k8s-lab`. **Files:** `clusters/ops/apps/control.yaml`, `clusters/ops/control/{kustomization.yaml,namespace.yaml,center.yaml,agent.yaml,rbac.yaml,sealed-*.yaml}`; `clusters/ops/gatus/config.yaml` (one check).

- [ ] **Step 1: Secrets** (sealed on the lab, nothing printed, as in sub-project 2): two random agent tokens (`openssl rand -hex 32`): `ops` token sealed for hetops-3 twice (the ops agent's `agent-token` and the center's `agent-tokens` key `ops`); `lab` token sealed for hetops-3 (center, key `lab`) and for the lab (Task 9). A server certificate for the lab agent (`IP:100.93.151.22`) signed by the ops CA (key on the lab at `~/.secrets/hetops-ops-logs-ca.key`), sealed for the lab (Task 9); the center gets the CA certificate as a ConfigMap. Access: the owner creates the Access application `control` for `control.hetops.dev` (owner-only policy) and gives the **AUD tag** and **team domain** (not secret) for the center's config; adds the tunnel route `control.hetops.dev → http://control-center.control.svc:8080` on the `hetops-3` tunnel.
- [ ] **Step 2: Manifests.** Namespace `control` (no PSS label needed: nothing privileged). `agent.yaml`: Deployment `control-agent` (1 replica, image `ghcr.io/het101/hetops-control-agent:<sha>`, env `SERVER=ops`, `AGENT_TOKEN_FILE=/secrets/token`, no TLS (in-cluster), ServiceAccount `control-agent`, probes on `/healthz`, requests 20m/64Mi limit 192Mi, the container security constraints), Service `control-agent:7443`. `rbac.yaml`: ClusterRole `control-agent-read`: get/list/watch on `nodes`, `pods`, `namespaces`; `deployments`, `statefulsets`, `daemonsets`, `replicasets`; `applications.argoproj.io`; get on `nodes/proxy` (kubelet summary) — nothing else. `center.yaml`: Deployment `control-center` (1 replica, `strategy: Recreate`, image center, env `AGENTS=[{"server":"ops","url":"http://control-agent.control.svc:7443","tokenFile":"/secrets/agents/ops"},{"server":"lab","url":"https://100.93.151.22:7443","tokenFile":"/secrets/agents/lab","caFile":"/ca/ca.crt"}]`, `DB_PATH=/data/events.db`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, PVC `control-data` 2Gi `local-path`, probes, requests 50m/128Mi limit 384Mi), Service `control-center:8080`. `clusters/ops/apps/control.yaml`: Argo app with the retry block used by the other ops apps. Image tags pinned to the merged SHA from Task 7.
- [ ] **Step 3: Gatus** watches the center from inside the cluster (the public URL is behind Access): endpoint `HetOps Control` in group `watchers`, `http://control-center.control.svc:8080/healthz`, conditions `[STATUS] == 200`, the default Telegram alert.
- [ ] **Step 4:** server-side dry run on hetops-3; PR; merge; Argo Synced/Healthy; `kubectl -n control logs deploy/control-center` shows the ops agent connected and the lab agent "unreachable" (Task 9 not yet deployed) — which is correct behaviour; `https://control.hetops.dev` asks for Access, then shows Ops live and Lab "UNREACHABLE" in ember.
- [ ] **Step 5: Commit** (lab repo) `feat(ops): HetOps Control center and ops agent`.

### Task 9: Lab agent and the network path (owner's go-ahead before merge)

**Repo:** `Het101/hetops-k8s-lab`. **Files:** `argo/apps/control-agent.yaml`, `platform/control-agent/{kustomization.yaml,agent.yaml,rbac.yaml,sealed-*.yaml}`, `tailscale/policy.hujson`.

- [ ] **Step 1: Tailnet grant, test first:** in the `tag:ops` test add `"accept": ["tag:lab:7443"]` (keeping its denies) → CI fails; then grant `{"src": ["tag:ops"], "dst": ["tag:lab"], "ip": ["tcp:7443"]}` → passes; merge applies it.
- [ ] **Step 2: Manifests** as the ops agent, plus: `SERVER=lab`, `TLS_CERT_FILE`/`TLS_KEY_FILE` from the sealed certificate, container port 7443 with `hostPort: 7443, hostIP: 100.93.151.22` (Tailscale only, like Gatus and Elasticsearch on hetops-3), the same read-only ClusterRole. Pod-security labels of the namespace match the lab's conventions (Linkerd: not meshed; it talks only to the API server).
- [ ] **Step 3:** dry run on the lab; **ask the owner** in chat; PR; merge.
- [ ] **Step 4: Checks.** From hetops-3: `curl --cacert ca.crt https://100.93.151.22:7443/healthz` → `{"ok":true}`; without the token `/v1/state` → 401. From the internet: `140.245.13.138:7443` closed. The center shows the lab live within 15 s.
- [ ] **Step 5: Commit** (lab repo) `feat(lab): HetOps Control agent`.

### Task 10: Prove stage 1a

- [ ] **The forest is live:** on the lab, `kubectl -n chaos delete pod -l app=chaos-api` (the chaos lab is built for this) → within 10 s the Lab tree's chaos branch shows the restart (ember leaves, rising embers), a `restart`/`status` event appears in the Timeline, and the headline names it; it clears after its 24 h window.
- [ ] **An agent dies:** scale the lab agent to 0 (Argo `root`-style pause on the lab app first) → within 30 s the Lab station reads UNREACHABLE in ember, the headline "We can't see lab."; scale back → recovers without a page reload.
- [ ] **Performance:** Lighthouse (desktop) on `control.hetops.dev` ≥ 90 performance; Chrome performance trace of 10 s on Home: no long tasks over 50 ms after load, 60 fps; reduced motion: no running animations.
- [ ] **Security:** without Access cookie → Cloudflare login; a forged `Cf-Access-Jwt-Assertion` sent straight to the center pod (port-forward) → 403.
- [ ] Journal entries, memory (`hetops-control.md`: stage 1a live), and hetops.dev: a "Control" line on the lab page.
