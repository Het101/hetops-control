# HetOps Control, stage 1b (see everything): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** every page in the rail works and every module from the approved mock shows real data: Timeline, Alerts, Apps, Backups, Security, Topology and Settings pages; on Home the deploy capsules, error budget, log-flow terrain and "who knocks" map. The owner's words: "add everything you can", "good components on dashboards", "none of the buttons are working, settings are not opening".

**Architecture:** unchanged from stage 1a. New sources live in the agent of the server that owns the data; every source emits entities and events in the existing contracts (extended where noted); the web gets a client-side router and one component per page, all built from entities and events, plus a small `/api/series` endpoint for time series (log flow, deploys) that agents expose as `series` entities' facts or a dedicated payload.

**Spec:** [2026-10-30-hetops-control-design.md](../specs/2026-10-30-hetops-control-design.md) (pages, extension model). Stage 1a (foundation) is live; this plan extends it.

## Global Constraints

Everything in stage 1a's Global Constraints still holds (contracts validated both sides; never healthy when blind; secrets never on a command line, in an image, a log or the browser; ember only for "needs you"; animations transform/opacity/stroke only, reduced motion respected; no blocked class names; non-root read-only containers; signed commits as Het Patel, no attribution, subject < 72; one PR per task; journal everything). Plus:
- **Each new source is read-only** and gets its own credentials with the narrowest scope the tool offers; credentials are sealed on the lab with strict scope.
- **Each new source has a contract test on a recording** of the real API (sanitised, grepped for secrets).
- **Pages are real routes** (`/`, `/timeline`, `/alerts`, `/apps`, `/backups`, `/security`, `/topology`, `/settings`) with browser history, deep links and keyboard navigation; the rail's buttons navigate.
- **No mock data in production**: a module with no source yet is not shown.

---

### Task 1: Contracts for series and the new entity kinds

Extend `packages/contracts`: entity kinds `alert`, `site`, `backup`, `deploy`, `slo`, `decision` (CrowdSec ban) with documented facts; a `SeriesSchema` (`{ id, server, unit, points: [t, v][] , stepMs }`) carried in `AgentState.series?: Series[]` and merged by the center into `CenterState.series`. Tests: valid/invalid series, size cap (max 2,000 points per series).

### Task 2: Ops agent sources: Gatus, Elasticsearch log flow, snapshots

- `gatus`: `GET http://gatus.watch.svc:8080/api/v1/endpoints/statuses` → one `site` (or `check`) entity per endpoint (group, last result, uptime 24 h, response time, certificate expiry days); status from its last results. Period 30 s.
- `elasticsearch`: with a new file-realm user `control-reader` (role: `monitor`, `read_slm`, `read` on `logs-lab-*` and `.slm-history-*`), a `date_histogram` of `logs-lab-default` and `logs-lab-security` per 10 min over 24 h → two series; plus cluster health as a `check`. Period 60 s.
- `snapshots`: SLM policies `nightly-all` and `nightly-security` → `backup` entities (last success/failure, next run, snapshot count, indices). Period 5 min.
- RBAC/NetworkPolicy additions on hetops-3 for the agent to reach `watch/gatus` and `logging/ops-logs-es-http`.

### Task 3: Lab agent sources: Alertmanager, error budget, Change Timeline, CrowdSec, Bedrock drift

- `alertmanager`: `GET http://kps-kube-prometheus-stack-alertmanager.monitoring.svc:9093/api/v2/alerts?active=true&silenced=false` → `alert` entities (name, severity, summary, starts, labels subset), excluding `Watchdog`. Period 30 s.
- `slo`: `GET http://chaos-api.chaos.svc:<port>/chaos/status` → one `slo` entity (budget left %, burn rates, frozen) — read the chaos-api source for the field names and port.
- `timeline`: the Change Timeline owner feed on its in-cluster port 8081 (`GET /owner/timeline`) → events (deploys, drift, chaos, alerts), deduplicated by id; period 30 s.
- `crowdsec`: a dedicated read-only bouncer key (`cscli bouncers add hetops-control`, sealed) → `GET /v1/decisions` on `crowdsec-service.crowdsec.svc:8080` → `decision` entities (IP masked to /24 for display, origin, scenario, country from the decision or alert when present, until); and a series of bans per hour.
- `bedrock`: read-only hostPath `/home/ubuntu/.local/state/bedrock/hosts` (files per host: `clean` / drift details) → one `check` per host (lab, staging, ops) with last drift run time; this is how staging and ops drift appear before staging has an agent.
- RBAC/NetworkPolicy changes on the lab for these Services.

### Task 4: Lab agent source: Coolify apps and deploys

A Coolify API token with read-only permission (owner creates it in Coolify → Keys & Tokens, "read" only; handed over in a file, sealed). `GET /api/v1/applications` and deployments per app → `app` entities of kind `deploy`-capable apps (status, fqdn, last deploy at/duration/commit, auto-deploy on/off) and a `deploy` series (count and median duration per day, 14 days). Also detects "a newer commit is not deployed" when the app reports it, as a need. Coolify is reached on the lab host (check how: container network or the host port) — read-only.

### Task 5: Center: series merge and the extended headline

Merge `series` from agents (ageing as entities), `/api/series?id=` with caps; the headline and needs include firing alerts (severity ≥ warning), failed backups (no success in 26 h), spent error budget, apps waiting for a deploy, and drift on any host. Tests per rule.

### Task 6: Web: router, rail that works, Settings

A tiny router (History API) with the eight routes; the rail buttons navigate (active state pressed, `aria-current`), deep links work, unknown routes show a friendly 404 in the house style. **Settings**: agents (server, configured, reachable, version, last error), each source (period, last run, ok/error), the signed-in identity (from the Access JWT email the center returns on `/api/me`), preferences stored in localStorage (reduced motion: system / on / off; compact density), and an "About" block with versions and links to the repo and design. The tooltip stacking bug stays fixed (test).

### Task 7: Web: Home modules from the mock

Deploy capsules (14 days, ember when a deploy waited over 2 min), error budget slider, log-flow terrain (24 h, both streams, gaps visible), "who knocks" dotted map (decisions by country, lab marked white), backups list with last results — the mock's components, real data, same motion. Each module hidden when its source is missing; a module whose source fails shows a "can't read <source>" state, never stale numbers.

### Task 8: Web: Timeline, Alerts, Apps, Backups, Security pages

Each page is a full view in the same design language: filter chips (server, kind, level), search (`/` to focus), list rows in the player style with round action knobs (disabled until stage 2, with an honest tooltip), detail drawers that open on row click showing facts and links (Grafana, Kibana, Argo, Coolify, GitHub). Security page: the "who knocks" map large, recent bans, detections (from Elasticsearch alerts via the ops agent if available, else counts), Falco highlights from the timeline. Empty and error states designed, not blank.

### Task 9: Web: Topology

The transit map from the design exploration, built from data: three lines (lab, staging, ops), stations for their components, edges for the real links (Cloudflare tunnels, Tailscale lab ↔ ops, lab → ops logs, ops → R2 backups, Gatus → sites), each edge coloured by the health of the check that proves it; clicking a station opens its detail drawer.

### Task 10: Roll out and prove

New images (CI), the lab agent and ops agent and center updated by digest in hetops-k8s-lab (two PRs: ops, lab — lab with the owner's go-ahead), new sealed credentials, RBAC and NetworkPolicies; then on the live site: every page loads with real data; each module shows "can't read" when its source is cut (block one Service with a temporary NetworkPolicy on hetops-3); Lighthouse ≥ 90 on Home; screenshots of every page for the journal and for the owner.
