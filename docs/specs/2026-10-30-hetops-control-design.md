# HetOps Control

**Status:** design, 30 Oct 2026. Approved by the owner in conversation (architecture, extension model, visual direction). The home screen reference is [`docs/design/home.html`](../design/home.html): open it in a browser; it is the living mock the UI is built against.

## Why

Everything about the three servers exists, but in eight places: Grafana, Kuma, two Argo CD UIs, Coolify, Gatus (Tailscale only), Kibana, the Change Timeline, Bedrock's drift logs. Nothing shows the three servers side by side, and every action is a different tool. HetOps Control is the one place the owner visits every day: a complete, live picture of what is happening where, and a safe way to act on it.

## The servers it covers

| Server | Role | Reached by |
| --- | --- | --- |
| lab (`my-workspace`, 140.245.13.138, Tailscale 100.93.151.22) | k8s lab, Coolify sites, monitoring | its agent |
| staging (`vm2`, 140.238.224.158) | staging k8s cluster | its agent (stage 3, after vm2 joins the tailnet as `tag:staging`) |
| ops (`hetops-3`, Tailscale 100.89.67.82) | ops cluster: Gatus, Elasticsearch/Kibana, the center itself | its agent |

## Architecture

```
browser ──Cloudflare Access──▶ hetops-3 tunnel ──▶ center (hetops-3, ns control)
                                                     │  SSE to the browser, SQLite for history and audit
                                     ┌───────────────┼──────────────────┐
                               agent (lab)     agent (ops)        agent (staging, stage 3)
                               over Tailscale   in-cluster          over Tailscale
```

- **The center** runs on hetops-3 (it must outlive the lab it watches), in namespace `control`, served at **`control.hetops.dev`** through hetops-3's own Cloudflare tunnel, behind Cloudflare Access (owner only). It verifies the `Cf-Access-Jwt-Assertion` JWT itself (team certs, audience tag) and refuses any request without a valid one: identity is checked, not trusted.
- **One agent per server** holds only that server's local credentials (its Kubernetes API through a read-mostly ServiceAccount, local Prometheus/Alertmanager/Coolify/CrowdSec endpoints, Bedrock's state files). It exposes a narrow, versioned HTTPS API (`/v1/state`, `/v1/stream`, `/v1/actions/<id>`) on its Tailscale address, TLS from the ops CA in git, and a per-agent bearer token (sealed both ends). The center never holds another server's admin credentials: compromising it lets an attacker ask, not command.
- **Actions** are a fixed allow-list of verbs implemented in the agent (`coolify.redeploy`, `argo.sync`, `alert.silence`, …), never arbitrary commands. Each declares its risk; disruptive ones need the target's name typed to confirm. Every action records who (from the Access JWT), what, when, the result, and is written to the Change Timeline beside every deploy and drift.
- **Live:** agents push changes on `/v1/stream` (SSE); the center merges them and streams to the browser. Every entity carries `observedAt`; anything older than three times its source's period shows as stale, never as healthy.

## The extension model (how it grows)

Three contracts in a shared package (`packages/contracts`, TypeScript types plus JSON Schema for everything crossing the network, versioned):

```ts
interface Source  { id: string; period: Duration | "watch"; collect(ctx): Promise<Entity[]> }
interface Action  { id: string; target: EntityKind; params: JSONSchema; risk: "safe" | "disruptive";
                    preview?(input, ctx): Promise<string>; run(input, actor, ctx): Promise<Result> }
interface Entity  { id: string; kind: EntityKind; server: ServerId; name: string;
                    status: "ok" | "attention" | "down" | "unknown"; facts: Record<string, Fact>;
                    links: Link[]; actions: ActionRef[]; observedAt: string; parent?: string }
interface Event   { at: string; server: ServerId; source: string; kind: string; summary: string; actor?: string; entity?: string }
```

The UI is built on entities and events, not per-tool pages: a new source or action appears by itself in the server views, search, the timeline and the "needs you" list, with its button and generated form. Purpose-built views (the forest, the error budget) register against an entity kind. Adding a capability later = one source or action file in an agent + its contract test (recorded real responses) + registration; nothing else changes.

## Visual and interaction design

Reference: `docs/design/home.html` (the approved mock).

- **Surface:** soft-extruded graphite (neumorphic): raised modules (`-6px -6px 14px rgba(255,255,255,.055), 8px 10px 22px rgba(0,0,0,.42)` on `#2a2b2f`), pressed wells for inputs, dial faces and the active nav item.
- **Colour has one meaning:** healthy is quiet silver; **ember** (`#ff9a3c → #f0582a → #c2391a`) means "needs you" and nothing else. Ember buttons glow and breathe.
- **Type:** Fraunces (headlines, big numbers), Plus Jakarta Sans (UI), IBM Plex Mono (data, labels).
- **The forest (home hero):** each server is a tree generated from live data: roots = host, trunk = cluster, branches = apps (thickness by pod count), leaves = pods. Healthy leaves are silver and sway; a struggling app's leaves glow ember, emit rising embers and fall as restarts happen. Seeded by server name so the tree is stable for the same estate.
- **Modules:** host-load instrument dials, deploy capsule bars, error-budget ember slider, log-flow terrain, CrowdSec "who knocks" dotted map, timeline and backup lists in the player-list style with round action knobs.
- **Motion:** animated nav icons (Home smoke, Topology travelling dot, Timeline clock hands, Alerts radio waves, Apps bouncing dots, Backups dropping arrow, Security drawing ring, Settings turning gear); modules float in; dials sweep, capsules rise, terrain draws, numbers count up, map pulses. Only `transform`/`opacity`/stroke animations (GPU-cheap), ease-out curves, 60 fps; all of it off under `prefers-reduced-motion`.
- **Names:** no ids or classes containing policy, cookie, consent, banner, ad, sponsor, promo (Brave's filters hide them).

## Pages

| Page | Shows | Acts (stage) |
| --- | --- | --- |
| Home | headline sentence of the day, Needs you, the forest, the modules above | the Needs-you actions (2) |
| Topology | the three servers and how they connect (tunnels, Tailscale links, lab → ops logs), live state on every edge | — |
| Timeline | one merged feed of every event on all servers, filterable | — |
| Alerts | everything firing: Alertmanager, Gatus, Kibana detections | silence / acknowledge for a time (2) |
| Apps | every Coolify app and Argo app: status, last deploy, duration | redeploy (2), sync / refresh (2), restart a deployment (3) |
| Backups | every backup's last result and history | run now (2), restore drill now (3) |
| Security | detections, CrowdSec bans (the map), Falco, audit highlights | — |
| Server (one per server) | host, cluster, its apps, its tree in detail | drift check (3) |

## Stages

1. **See everything:** repo, contracts, center, web, agents on lab and ops, read-only sources: Kubernetes (nodes, pods, deployments, restarts), Argo CD apps, host load (kubelet summary), Gatus, Alertmanager, Elasticsearch (log flow, SLM history), Coolify (read), CrowdSec decisions, the Change Timeline, Bedrock drift state, backup results. Pages: Home, Timeline, Alerts, Apps, Backups, Security, Server. Deployed and in daily use.
2. **First actions (safe):** `coolify.redeploy`, `argo.sync`/`argo.refresh`, `alert.silence`, `gatus.ack`, `snapshot.now`; the action framework (allow-list, confirm, audit, rate limits).
3. **Staging and deeper control:** vm2 joins the tailnet (`tag:staging`), its agent; `bedrock.drift-check`, `deployment.restart` (disruptive), `chaos.pause/resume`, `restore-drill.run`; Topology page.
4. **Memory:** trends and history views, a morning digest to Telegram.

## Technology

- One repo, `Het101/hetops-control`, a pnpm workspace: `packages/contracts`, `apps/agent`, `apps/center`, `apps/web`.
- Node 22 + TypeScript, Fastify (agent and center), SQLite (`better-sqlite3`) in the center for events, history and the audit log (a `local-path` volume on hetops-3).
- Web: Svelte 5 + Vite (small, fast, first-class transitions), charts hand-built in SVG as in the mock (no chart library), served by the center.
- Tests: Vitest (contracts, sources against recorded fixtures, actions with fakes), Playwright smoke test of the built UI (home renders, reduced-motion works).
- Images built by GitHub Actions on ARM runners, pushed to GHCR, signed with cosign (keyless); deployed by Argo CD: the center and the ops agent from `clusters/ops/control/` in hetops-k8s-lab, the lab agent from `argo/apps/control-agent.yaml`.
- Network: tailnet grant `tag:ops → tag:lab tcp:7443` (center to lab agent), with tests; the lab agent's hostPort bound to 100.93.151.22 only.

## Failure behaviour

- An agent down or unreachable: its server shows **unknown** (grey, with "since"), never stale-green; the headline says so.
- The center down: nothing on the servers changes (agents are passive); Gatus watches the center's health like any other site.
- A source failing inside an agent: only that source's entities go unknown; the agent reports the error in `/v1/state.sources[]`.
- Actions are idempotent where the tool allows, time out at 60 s, and report a result; a failed action is an event like any other.

## Security

- Access: Cloudflare Access (owner-only policy) + JWT verification in the center.
- Agent API: Tailscale ACL, TLS (ops CA), bearer token per agent, allow-listed actions only; RBAC per agent is read-only except the exact verbs its actions need (e.g. `patch applications` for argo.sync, stage 2).
- Secrets: SealedSecrets per cluster; nothing secret in the browser; no secret ever in a command line (the audit log ships).
- Supply chain: pinned base images, cosign-signed images, Dependabot.

## Done when (stage 1)

1. `control.hetops.dev` shows the lab and ops live (staging as "not connected yet" until stage 3), every stage-1 source populated from real data, with nothing stale.
2. The forest reflects the real cluster (apps as branches, pods as leaves, restarts as embers) and changes within 10 s of a pod restarting.
3. Killing the lab agent shows the lab as unknown within 30 s, and recovers by itself.
4. Lighthouse performance ≥ 90 on the home page; animations hold 60 fps on the owner's laptop; reduced motion turns them all off.
5. Every source has a contract test on recorded data; CI green; images signed.

## Cost

Nothing new: GHCR (public images), GitHub Actions (public repo), the existing tunnel and clusters.
