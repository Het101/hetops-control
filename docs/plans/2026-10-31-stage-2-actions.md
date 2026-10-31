# HetOps Control, stage 2 (first actions, safe): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the owner can act from `control.hetops.dev`: `snapshot.now`, `gatus.ack`, `argo.sync`, `argo.refresh`, `alert.silence` and `coolify.redeploy`, each from the button the drawers and lists already show. Every action is offered by name, previewed exactly, confirmed with one click, rate limited, audited and written to the timeline. The owner's words: "Go ahead with next control-center stage".

**Architecture:** an action is a file beside the sources in the agent that owns the target (`apps/agent/src/actions/*.ts`). It is registered like a source and switched on per agent by an explicit allow-list (`ACTIONS=` in the deployment repo). The registry attaches an `ActionRef` to every entity the action applies to and publishes each action's descriptor (its params as JSON Schema from zod) in `/v1/state`. The agent serves `POST /v1/actions/<id>` and `POST /v1/actions/<id>/preview` behind its bearer token. The center adds `POST /api/actions` and `POST /api/actions/preview`. It checks identity from the verified Access JWT, then an allow-list of actors, the same-origin Origin plus a custom header, the target and its offer, the params against the advertised schema, an idempotency key and rate limits. It audits in SQLite, calls the agent with a 60 s limit, and streams the run over SSE. The web renders one confirmation dialog and its form from the descriptor, with no per-action UI code. `gatus.ack` is the one center-side action, because Gatus has nothing to acknowledge (decision 2).

**Tech Stack:** unchanged (Node 22, TypeScript, zod 3.23.8, Fastify 5, `@kubernetes/client-node` 1.4.0, `better-sqlite3`, Svelte 5, Vitest, Playwright). One new dependency, in the agent only: `zod-to-json-schema@3.23.5`. Deployment: Argo CD, Sealed Secrets, a Kubernetes `ValidatingAdmissionPolicy` (GA since 1.30; lab and staging run 1.35).

**Spec:** [2026-10-30-hetops-control-design.md](../specs/2026-10-30-hetops-control-design.md): Architecture (Actions), the extension model (`Action`), Pages ("Acts (stage)": Home Needs-you actions, Alerts silence/acknowledge, Apps redeploy and sync/refresh, Backups run now), Stages (2), Security, Failure behaviour (idempotent where the tool allows, 60 s, a failed action is an event). Stage 1a and 1b are live.

## Decisions (made as the architect; each one is a change or a choice the spec left open)

1. **Argo CD: Kubernetes API, not the Argo CD API.** The agent gets a Role in `argocd` with `get, patch` on `applications`, plus a `ValidatingAdmissionPolicy` bound to its ServiceAccount. The policy refuses every change except the refresh annotation (`normal` or `hard`) and a new sync `operation` to the app's own target revision. A sync operation may not carry `revision`, `revisions`, `source`, `sources`, `manifests`, `resources`, `syncOptions`, `prune: true` or `force`. That is exactly what `argocd app sync --core` writes, and RBAC alone cannot see inside a patch. Without the policy, `patch applications` would let a stolen agent token repoint any app at any repo, and Argo CD applies as cluster-admin. Why not a project-scoped Argo CD API token:
   - it adds a long-lived bearer token, a second secret to steal, where the ServiceAccount token is short-lived and rotated by the kubelet;
   - the lab's `argocd-cm` and `argocd-rbac-cm` are not in git (the lab's Argo CD was installed by hand on 8 Oct), so the account and its RBAC would live outside git;
   - Argo CD projects split our apps (`default`, `control`, `logging`, `mesh`, `monitoring`, `security`), so it needs one token per project or a global account;
   - it needs network access and TLS trust to `argocd-server`.

   The admission policy is in git, verifiable with `--dry-run=server` as the ServiceAccount, and enforced by the API server whatever the agent's code does.
2. **`gatus.ack` is a center-side acknowledgement record, and says so.** Gatus 5.37 (`ghcr.io/twin/gatus:v5.37.0`) has no acknowledge or mute API. Its only write endpoint pushes results for external endpoints, and writing a fake result would be lying. Maintenance windows live in its config file. So `gatus.ack` writes an `acks` row in the center's SQLite: the entity, the status at the time, the actor, an expiry, and an optional note. An acknowledged entity leaves Needs you and the headline until the expiry or until its status changes, whichever comes first. It stays visible on Alerts as "acknowledged by … until …", in silver. Gatus keeps checking and keeps sending its own alerts. The dialog's preview says all of this. It is the one action implemented in the center (`apps/center/src/ack.ts`), because it changes only the center's own view. The agent has a read-only root and no volume to keep a record in.
3. **`Action.targets` is a list** (the spec says `target`). Gatus reports both `site` and `check` entities, and one verb acknowledges both. Each action also has `applies(entity)`, which narrows it further, for example to failing Gatus checks only.
4. **The per-agent allow-list is in git.** `ACTIONS=snapshot.now` on ops, and `ACTIONS=argo.sync,argo.refresh,alert.silence,coolify.redeploy` on the lab. The agent refuses to start when a named action lacks its settings, and unknown names are an error. The code holds the set of possible verbs; the deployment repo decides which ones each server has.
5. **Descriptors travel in the state.** `AgentState.actions?` holds `ActionDescriptor[]`: id, label, description, targets, risk, a preview flag and params as JSON Schema. The center merges them into `CenterState.actions?` with their server. The web renders the form, and the center validates params with the shared `checkParams`. Params use a small JSON Schema subset: a flat object of enums, bounded strings, bounded integers and booleans. A zod meta-schema in contracts (`ParamsJsonSchema`) enforces that subset. An agent test fails if an action's zod schema emits anything else, so web, center and agent never disagree. This avoids a JSON Schema validator dependency, and the agent validates again with zod.
6. **CSRF defence: an exact `Origin` plus a custom header.** The Access cookie `CF_Authorization` is ambient: the browser attaches it to any request to `control.hetops.dev`.
   - `Origin` must equal `PUBLIC_ORIGIN`. Browsers always send `Origin` on a cross-origin POST, and on same-origin `fetch` POSTs too. A missing `Origin` is refused.
   - `X-HetOps-Action: 1` is required. A cross-origin page cannot set a custom header without a CORS preflight, and the center answers no preflight. A plain HTML form or a navigation can never send one.
   - `Sec-Fetch-Site`, when present, must be `same-origin`.
   - The body must be JSON (Fastify's default parser refuses `text/plain` and form bodies with 415).

   SameSite alone is not enough. Cloudflare Access sets the cookie's SameSite, not us. And every `*.hetops.dev` site (the Coolify-hosted ones included) is *same-site*, so SameSite would let them through; the Origin check does not.
7. **Authorisation beyond Access.** `ACTORS` (comma-separated emails, in git) must contain the verified Access email for any action. Empty means actions are off. Access is the first gate (owner-only policy), and this is the second, in our own code. A widened Access policy can then never grant actions by accident.
8. **Live progress over the existing stream.** `POST /api/actions` answers `202 {run}` once the request is validated, audited and started. Progress and the result arrive as `{type:"action", run}` on `/api/stream`, next to the two `action` events (request and result) that the timeline shows. The tools are asynchronous anyway: Argo's sync, Coolify's build and the SLM snapshot all finish later. The result says "started", and the existing sources show the finish.
9. **ES: a separate `control-operator` file-realm user with only `manage_slm`.** `POST _slm/policy/<id>/_execute` requires `manage_slm`, and no narrower privilege runs a policy. Calling `PUT _snapshot/<repo>/<name>` with `create_snapshot` would be narrower, but that snapshot is not the policy's run: SLM history, `last_success` and retention would not count it, and the Backups page reads exactly those. The snapshot itself runs with the security headers of whoever last PUT the policy (the setup Job), not as control-operator. The known ceiling is that `manage_slm` could also delete a policy. Mitigations:
   - the credentials exist only in the ops agent;
   - the only call the code makes is `_execute`;
   - the policies are re-PUT by the setup Job from git;
   - `control-reader` stays the identity for every read.
10. **Coolify: a second token with the `deploy` ability only.** The read token stays as it is. The deploy token cannot read applications, which is proven at rollout with a 403. Coolify tokens are team-scoped, so per-application scoping is not available.
11. **Alertmanager: no NetworkPolicy change.** `monitoring` has no NetworkPolicy, the agent already reaches `:9093` for alerts, and policies are L4, so POST rides the same allowance. Rollout verifies `kubectl get networkpolicy -n monitoring` is empty. A silence matches every label of the alert exactly (`isEqual`, never regex), so it mutes that alert and nothing else, capped at 72 h.
12. **Idempotency.** The web makes one UUID per opened dialog and sends it as `Idempotency-Key`. The center's audit table uses it as the primary key, so a repeat returns the recorded run (200) without acting again, and the same key on a different request is a 409. The agent passes it on, and each action checks the tool's own state first:
    - SLM: a policy with `in_progress` returns that snapshot.
    - Argo: an `operationState.phase` of `Running` returns "already running".
    - Coolify: a newest deployment that is `queued` or `in_progress` returns it.
    - Alertmanager: an active silence whose comment carries `[hetops-control <key>]` is returned instead of creating another.
    - Refresh and ack are idempotent by nature.
13. **Rate limits** live in memory in the center:
    - one run in flight per target;
    - per action and target, 3 per 10 min;
    - per action, 12 per 10 min;
    - previews, 60 per minute.

    A refusal is a 429 with `Retry-After`. The agent adds its own one-in-flight lock per target.
14. **Timeouts.** The center gives the agent 60 s. Past that the run fails with "no answer in 60 s; the result is unknown, check <target>", which is honest because the tool may still have acted. The agent gives an action 55 s, so its own answer usually arrives first. A run still `running` when the center starts again is closed as failed: "the center restarted before the agent answered; the result is unknown".

## Global Constraints

Everything in stage 1a's and 1b's Global Constraints still holds. Copied here because every task inherits them:

- Node 22 LTS, TypeScript `strict: true`, ESM. Every network payload is validated with its zod schema on both sides; types come from `z.infer`.
- Entity `status` is exactly `"ok" | "attention" | "down" | "unknown"`; never healthy when blind.
- **Secrets never in a command line, image, log or the browser.** They are never printed, and never passed as arguments to `kubectl exec`: a check that needs a secret reads it inside the pod from its mounted file, with the script sent on stdin (`kubectl exec -i … -- node --input-type=module -`). Tokens move over ssh stdin straight into `kubeseal`.
- **No class or id names containing policy, cookie, consent, banner, ad, sponsor or promo** (Brave's filters hide them). Treat "ad" as a substring: no `header`, `badge`, `loading`, `shadow` or `already` in a class or id.
- **Ember means "needs you", and nothing else.** An enabled action button is ember only when its entity needs you. The dialog's confirm button is raised silver. A failed action's toast is ember, because it needs you; a running or succeeded one is silver.
- **Motion off under reduced motion.** Only transform, opacity and stroke animations, as CSS keyframes, which the global reduced-motion rule in `tokens.css` switches off. No Svelte JS transitions, since that rule cannot stop them.
- Containers stay non-root (uid 10001), with a read-only root, no privilege escalation, all capabilities dropped and `RuntimeDefault` seccomp.
- **Commits are signed as Het Patel <patel.x.het@gmail.com>** (`git commit -S`, never `--no-gpg-sign`) with no AI attribution of any kind and a subject under 72 characters. One branch and PR per task. Push with the Het101 token (`export GH_TOKEN=$(gh auth token --user Het101)`; `git -c credential.helper= -c "credential.helper=!f(){ echo username=Het101; echo password=$GH_TOKEN; }; f" push -u origin <branch>`). hetops-control PRs may be self-merged when green. **hetops-k8s-lab PRs that change a live cluster wait for the owner's "merge".**
- **Every action:** sits on the agent's `ACTIONS` allow-list, declares its risk, is idempotent where the tool allows, finishes or fails within 60 s, writes an audit row and two timeline events with the actor from the Access JWT, and has a contract test on a recorded real response.
- **Least privilege per agent:** each write credential is separate from the read one and as narrow as the tool allows, sealed for its own namespace only.
- **Journal:** every infrastructure change and its exact commands go into `C:\Users\HetPatel\Personal\HetOps\journal-pending.md` the same session; mistakes are also noted for Part 11.

## Owner steps (all in one place; each is repeated in its task)

| # | When | What |
| --- | --- | --- |
| O1 | before Task 11 | Open `control.hetops.dev` → Settings and tell me the email under **Signed in as**. It goes into `ACTORS` in git (it is already public in your commits). |
| O2 | Task 11 | Say "merge" for the ops PR in hetops-k8s-lab (control-operator user, ops agent and center). |
| O3 | after Task 11 | On Backups, open **nightly-all** → **Snapshot now** → read the preview → confirm. That is the first audited action through the real Access identity. |
| O4 | before Task 12 | In Coolify, create a **deploy-only** token and save it to `~/.secrets/coolify-deploy-token` (exact clicks and command in Task 12). |
| O5 | Task 12 | Say "merge" for the lab PR. The go-ahead also covers two recordings: one redeploy of `hetops-dns`, and a throwaway silence on an alert name that does not exist, deleted at once. |
| O6 | after Task 12 | Press **Refresh** on one Argo app, **Redeploy** on one Coolify app, and **Silence** (1 h) on a firing alert if one is firing. |
| O7 | Task 13 | Say "merge" for the staging PR, then press **Refresh** on one staging Argo app. |

## Rollout order

Ops first: the center, `snapshot.now` and `gatus.ack` (Task 11). Then the lab: `argo.*`, `alert.silence` and `coolify.redeploy` (Task 12). Then staging: `argo.*` (Task 13). The code tasks (1–10) merge to hetops-control `main` first; their images are what the rollout pins by digest. An agent without `ACTIONS` behaves exactly as today, so the code can merge before any rollout.

## File structure

```text
packages/contracts/src/action.ts           NEW  Action, descriptors, params subset + checkParams, requests, results, runs, acks
packages/contracts/src/{agent-api,center-api,index}.ts   AgentState.actions, CenterState.actions/acks, CenterMessage "action"
packages/contracts/test/actions.test.ts    NEW
apps/agent/src/actions/index.ts            NEW  describeAction, buildActions (the ACTIONS allow-list), actionRunner
apps/agent/src/actions/snapshot.ts         NEW  snapshot.now (ES SLM _execute)
apps/agent/src/actions/argo.ts             NEW  argo.sync, argo.refresh
apps/agent/src/actions/silence.ts          NEW  alert.silence
apps/agent/src/actions/coolify.ts          NEW  coolify.redeploy
apps/agent/src/{registry,server,main}.ts, src/sources/elasticsearch.ts (basicAuth shared)
apps/agent/test/{actions,snapshot-action,argo-actions,silence-action,coolify-action}.test.ts   NEW
apps/agent/test/fixtures/{es-slm-execute,argo-app,alertmanager-silences,alertmanager-silence-created,coolify-deploy}.json   NEW
apps/center/src/actions.ts                 NEW  Actions (validate, authorise, limit, audit, call, publish), decorate, centerState
apps/center/src/ack.ts                     NEW  gatus.ack (center-side)
apps/center/src/{events-db,store,agents,headline,server,config,main}.ts
apps/center/test/{actions,ack}.test.ts     NEW; events-db, server, config tests extended
apps/web/src/lib/actions.ts                NEW  offer, fields, defaults, preview, start (pure)
apps/web/src/lib/action-state.svelte.ts    NEW  the open dialog, the catalog, the runs
apps/web/src/components/{ActionDialog,Toasts}.svelte   NEW
apps/web/src/components/{Knob,NeedsYou,Drawer}.svelte, pages/{Home,Apps,Alerts,Backups}.svelte, App.svelte, lib/api.ts, styles/pages.css
apps/web/test/actions.test.ts, apps/web/e2e/actions.spec.ts   NEW
hetops-k8s-lab: clusters/ops/logging/{roles.yml, elasticsearch.yaml, kustomization.yaml, sealed-user-control-operator.yaml}
                clusters/ops/control/{agent.yaml, center.yaml, kustomization.yaml, sealed-es-operator.yaml}
                platform/control-agent/{rbac.yaml, argo-guard.yaml, agent.yaml, kustomization.yaml, sealed-agent-coolify-deploy.yaml}
                argo/project-control.yaml
                clusters/staging/control/{rbac.yaml, argo-guard.yaml, agent.yaml, kustomization.yaml}
```

---

### Task 1: Contracts for actions

**Files:**
- Create: `packages/contracts/src/action.ts`, `packages/contracts/test/actions.test.ts`
- Modify: `packages/contracts/src/agent-api.ts`, `packages/contracts/src/center-api.ts`, `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `EntityKindSchema`, `LinkSchema`, `ServerIdSchema`, `StatusSchema`, `Entity`, `ServerId` from `entity.ts`.
- Produces (exported from `@hetops-control/contracts`): `RiskSchema`/`Risk`; `ParamsJsonSchema`/`ParamsJson`; `Params = Record<string, string|number|boolean>`; `checkParams(schema: ParamsJson, input: unknown): {ok:true; params: Params} | {ok:false; error: string}`; `ActionDescriptorSchema`/`ActionDescriptor` (`{id, label, description, targets: EntityKind[], risk, preview: boolean, params: ParamsJson}`); `ActionRequestSchema` (agent body `{target, params, actor, requestId}`); `ActionCallSchema` (center body `{action, target, params, confirm?}`); `ActionPreviewSchema` (`{text}`); `ActionResultSchema`/`ActionResult` (`{ok, summary, ref?, already?, links?}`); `ActionRunSchema`/`ActionRun`; `AckSchema`/`Ack`; `ActionContext`; `interface Action<P>`; `AgentState.actions?`; `CenterState.actions?` (descriptor + `server`), `CenterState.acks?`; `CenterMessage` gains `{type:"action", run}`.

- [ ] **Step 1: Write the failing test** `packages/contracts/test/actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ActionDescriptorSchema, ActionRunSchema, AgentStateSchema, CenterMessageSchema, CenterStateSchema, ParamsJsonSchema, checkParams, type ParamsJson } from "../src/index.js";

const schema: ParamsJson = { type: "object", additionalProperties: false, properties: {
  hours: { type: "string", enum: ["1", "4", "24"], default: "4", description: "For how long" },
  note: { type: "string", maxLength: 20 },
  times: { type: "integer", minimum: 1, maximum: 3 },
  hard: { type: "boolean", default: false } }, required: ["times"] };

describe("action params", () => {
  it("accepts what zod-to-json-schema emits for the supported shapes, with its $schema key", () => {
    expect(ParamsJsonSchema.parse({ ...schema, $schema: "http://json-schema.org/draft-07/schema#" }).properties.hours).toEqual(schema.properties.hours);
  });
  it("refuses keywords the form and checkParams do not implement, and free strings without a bound", () => {
    expect(ParamsJsonSchema.safeParse({ ...schema, properties: { x: { type: "string", maxLength: 9, pattern: "^a" } } }).success).toBe(false);
    expect(ParamsJsonSchema.safeParse({ ...schema, properties: { x: { type: "string" } }, required: [] }).success).toBe(false);
    expect(ParamsJsonSchema.safeParse({ ...schema, properties: { x: { type: "array" } }, required: [] }).success).toBe(false);
    expect(ParamsJsonSchema.safeParse({ ...schema, additionalProperties: true }).success).toBe(false);
    expect(ParamsJsonSchema.safeParse({ ...schema, required: ["nope"] }).success).toBe(false);
  });
  it("checkParams fills defaults, keeps valid values and refuses the rest", () => {
    expect(checkParams(schema, { times: 2 })).toEqual({ ok: true, params: { hours: "4", times: 2, hard: false } });
    expect(checkParams(schema, { times: 2, note: "hi", hard: true, hours: "24" })).toEqual({ ok: true, params: { hours: "24", note: "hi", times: 2, hard: true } });
    for (const bad of [{}, { times: 4 }, { times: 1.5 }, { times: 1, hours: "2" }, { times: 1, note: "x".repeat(21) }, { times: 1, hard: "yes" }, { times: 1, extra: 1 }, [], null, "x"])
      expect(checkParams(schema, bad).ok).toBe(false);
  });
});

describe("action contracts", () => {
  const d = { id: "argo.sync", label: "Sync", description: "Asks Argo CD to sync.", targets: ["argo-app"], risk: "safe", preview: true,
    params: { type: "object", properties: {}, additionalProperties: false } };
  const run = { id: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", action: "argo.sync", label: "Sync", server: "lab", target: "lab/argo-app/clinic",
    targetName: "clinic", actor: "het@hetops.dev", params: {}, state: "running", at: "2026-10-31T10:00:00.000Z" };
  it("descriptors: ids are verb.noun, targets are entity kinds, risk is safe or disruptive", () => {
    expect(ActionDescriptorSchema.parse(d)).toEqual(d);
    expect(ActionDescriptorSchema.safeParse({ ...d, id: "rm -rf" }).success).toBe(false);
    expect(ActionDescriptorSchema.safeParse({ ...d, targets: ["planet"] }).success).toBe(false);
    expect(ActionDescriptorSchema.safeParse({ ...d, risk: "spicy" }).success).toBe(false);
  });
  it("agent and center states carry descriptors optionally (old agents still validate)", () => {
    const s = { server: "lab", version: "1", generatedAt: "2026-10-31T10:00:00Z", entities: [], sources: [] };
    expect(AgentStateSchema.parse(s).actions).toBeUndefined();
    expect(AgentStateSchema.parse({ ...s, actions: [d] }).actions).toHaveLength(1);
    const v = { status: "ok", reachable: true, configured: true, since: "2026-10-31T10:00:00Z" };
    const c = { generatedAt: "2026-10-31T10:00:00Z", servers: { lab: v, staging: v, ops: v }, entities: [], series: [] };
    expect(CenterStateSchema.parse({ ...c, actions: [{ ...d, server: "lab" }], acks: [] }).actions![0]!.server).toBe("lab");
  });
  it("a run streams as an action message; its actor is an email-shaped string, its id a UUID", () => {
    expect(CenterMessageSchema.parse({ type: "action", run }).type).toBe("action");
    expect(ActionRunSchema.safeParse({ ...run, id: "1" }).success).toBe(false);
    expect(ActionRunSchema.safeParse({ ...run, actor: "nobody" }).success).toBe(false);
    expect(ActionRunSchema.parse({ ...run, actor: "dev@local" }).actor).toBe("dev@local");   // CONTROL_DEV's identity
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run packages/contracts`
Expected: FAIL, `ParamsJsonSchema` (and the others) not exported.

- [ ] **Step 3: Implement** `packages/contracts/src/action.ts`:

```ts
import { z } from "zod";
import { EntityKindSchema, LinkSchema, ServerIdSchema, StatusSchema, type Entity, type EntityKind, type ServerId } from "./entity.js";

export const RiskSchema = z.enum(["safe", "disruptive"]);
export type Risk = z.infer<typeof RiskSchema>;

/**
 * The JSON Schema subset an action's params may use: a flat object of enums, bounded strings, bounded integers and booleans,
 * as zod-to-json-schema emits them. The web renders a form from it and the center validates with checkParams; the agent's
 * test refuses any action whose zod schema emits more, so the three never disagree.
 */
const help = { description: z.string().max(200).optional() };
const ParamPropSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), enum: z.array(z.string().max(64)).min(1).max(16).optional(), minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().max(500).optional(), default: z.string().optional(), ...help }).strict(),
  z.object({ type: z.literal("integer"), minimum: z.number().int(), maximum: z.number().int(), default: z.number().int().optional(), ...help }).strict(),
  z.object({ type: z.literal("boolean"), default: z.boolean().optional(), ...help }).strict(),
]);
export const ParamsJsonSchema = z.object({
  $schema: z.string().optional(), type: z.literal("object"),
  properties: z.record(z.string().regex(/^[a-z][A-Za-z0-9]{0,31}$/), ParamPropSchema),
  required: z.array(z.string()).optional(), additionalProperties: z.literal(false),
}).strict().superRefine((s, ctx) => {
  if (Object.keys(s.properties).length > 8) ctx.addIssue({ code: "custom", path: ["properties"], message: "at most 8 params" });
  for (const [k, p] of Object.entries(s.properties))
    if (p.type === "string" && !p.enum && p.maxLength === undefined) ctx.addIssue({ code: "custom", path: ["properties", k], message: "a free string needs maxLength" });
  for (const r of s.required ?? []) if (!Object.hasOwn(s.properties, r)) ctx.addIssue({ code: "custom", path: ["required"], message: `${r} is not a property` });
});
export type ParamsJson = z.infer<typeof ParamsJsonSchema>;
export type ParamValue = string | number | boolean;
export type Params = Record<string, ParamValue>;

/** Validates input against an advertised params schema: defaults filled, unknown keys refused. */
export function checkParams(schema: ParamsJson, input: unknown): { ok: true; params: Params } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "params must be an object" };
  const given = input as Record<string, unknown>, out: Params = {};
  for (const k of Object.keys(given)) if (!Object.hasOwn(schema.properties, k)) return { ok: false, error: `unknown param ${k}` };
  for (const [k, p] of Object.entries(schema.properties)) {
    const v = given[k] ?? p.default;
    if (v === undefined) { if (schema.required?.includes(k)) return { ok: false, error: `${k} is required` }; continue; }
    if (p.type === "string") {
      if (typeof v !== "string") return { ok: false, error: `${k} must be text` };
      if (p.enum && !p.enum.includes(v)) return { ok: false, error: `${k} must be one of ${p.enum.join(", ")}` };
      if (p.maxLength !== undefined && v.length > p.maxLength) return { ok: false, error: `${k} is longer than ${p.maxLength}` };
      if (p.minLength !== undefined && v.length < p.minLength) return { ok: false, error: `${k} is shorter than ${p.minLength}` };
    } else if (p.type === "integer") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < p.minimum || v > p.maximum) return { ok: false, error: `${k} must be a whole number from ${p.minimum} to ${p.maximum}` };
    } else if (typeof v !== "boolean") return { ok: false, error: `${k} must be yes or no` };
    out[k] = v as ParamValue;
  }
  return { ok: true, params: out };
}

// an Access email, or CONTROL_DEV's "dev@local" (zod's email() wants a dotted domain)
const ActorSchema = z.string().max(254).regex(/^[^@\s]+@[^@\s]+$/);
const ParamValuesSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

export const ActionDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z]+\.[a-z][a-z-]*$/), label: z.string().min(1).max(40), description: z.string().max(300),
  targets: z.array(EntityKindSchema).min(1), risk: RiskSchema, preview: z.boolean(), params: ParamsJsonSchema });
export type ActionDescriptor = z.infer<typeof ActionDescriptorSchema>;

/** The center → agent body of POST /v1/actions/<id> and /v1/actions/<id>/preview. */
export const ActionRequestSchema = z.object({ target: z.string().min(1).max(256), params: z.record(z.unknown()), actor: ActorSchema, requestId: z.string().uuid() }).strict();
export type ActionRequest = z.infer<typeof ActionRequestSchema>;
/** The browser → center body of POST /api/actions and /api/actions/preview. `confirm` is the typed target name (disruptive only). */
export const ActionCallSchema = z.object({ action: z.string().min(1).max(64), target: z.string().min(1).max(256),
  params: z.record(z.unknown()).default({}), confirm: z.string().max(256).optional() }).strict();
export type ActionCall = z.infer<typeof ActionCallSchema>;
export const ActionPreviewSchema = z.object({ text: z.string().min(1).max(1000) });
export const ActionResultSchema = z.object({ ok: z.boolean(), summary: z.string().min(1).max(300), ref: z.string().max(200).optional(),
  already: z.boolean().optional(), links: z.array(LinkSchema).max(4).optional() });
export type ActionResult = z.infer<typeof ActionResultSchema>;

/** One request, as audited and streamed: running, then succeeded or failed. */
export const ActionRunSchema = z.object({
  id: z.string().uuid(), action: z.string(), label: z.string(), server: ServerIdSchema, target: z.string(), targetName: z.string(),
  actor: ActorSchema, params: ParamValuesSchema, state: z.enum(["running", "succeeded", "failed"]),
  at: z.string().datetime(), finishedAt: z.string().datetime().optional(), result: ActionResultSchema.optional(), error: z.string().max(300).optional() });
export type ActionRun = z.infer<typeof ActionRunSchema>;

/** A center-side acknowledgement (gatus.ack): holds while the entity keeps `status` and until `until`. */
export const AckSchema = z.object({ entity: z.string(), server: ServerIdSchema, status: StatusSchema, actor: ActorSchema,
  at: z.string().datetime(), until: z.string().datetime(), note: z.string().max(200).optional() });
export type Ack = z.infer<typeof AckSchema>;

export type ActionContext = { server: ServerId; now: () => Date; actor: string; requestId: string; signal: AbortSignal };
/** An agent-side verb. Its zod params are published as JSON Schema; `applies` picks the entities that offer it. */
export interface Action<P extends Params = Params> {
  id: string; label: string; description: string; targets: EntityKind[]; risk: Risk;
  params: z.ZodType<P, z.ZodTypeDef, unknown>;
  applies(e: Entity): boolean;
  preview?(target: Entity, params: P, ctx: ActionContext): Promise<string>;
  run(target: Entity, params: P, ctx: ActionContext): Promise<ActionResult>;
}
```

In `agent-api.ts`, import `ActionDescriptorSchema` from `./action.js` and add to `AgentStateSchema`:

```ts
  actions: z.array(ActionDescriptorSchema).max(32).optional(),
```

In `center-api.ts`, import `AckSchema, ActionDescriptorSchema, ActionRunSchema` from `./action.js`. Add to `CenterStateSchema` (optional, so an older center or web keeps parsing):

```ts
  actions: z.array(ActionDescriptorSchema.extend({ server: ServerIdSchema })).optional(),
  acks: z.array(AckSchema).optional(),
```

and a third member of `CenterMessageSchema`:

```ts
  z.object({ type: z.literal("action"), run: ActionRunSchema }),
```

In `index.ts` add `export * from "./action.js";`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm vitest run packages/contracts && pnpm typecheck`
Expected: PASS (the new file and the existing contract tests). If the center's or the web's `switch` on message types now misses `"action"`, that is Tasks 9 and 10; `typecheck` must still pass, because neither switches exhaustively today.

- [ ] **Step 5: Commit**

```bash
git switch -c feat/action-contracts origin/main
git add packages/contracts
git commit -S -m "feat(contracts): actions, params subset, runs and acks"
```

---

### Task 2: Agent action framework

**Files:**
- Create: `apps/agent/src/actions/index.ts`, `apps/agent/test/actions.test.ts`
- Modify: `apps/agent/package.json` (dependencies `zod: 3.23.8`, `zod-to-json-schema: 3.23.5`), `apps/agent/src/registry.ts`, `apps/agent/src/server.ts`, `apps/agent/src/main.ts`

**Interfaces:**
- Consumes: `Action`, `ActionDescriptor`, `ActionRequestSchema`, `ActionPreviewSchema`, `ActionResultSchema`, `ParamsJsonSchema` (Task 1).
- Produces:
  - `describeAction(a: Action<any>): ActionDescriptor`
  - `buildActions(env?: NodeJS.ProcessEnv, make?: Record<string, (env) => Action<any>>): Action<any>[]`. It throws on an unknown or unconfigured name. Tasks 3–6 add their entries to `MAKERS`.
  - `actionRunner(reg: Registry, actions: Action<any>[], opts?: { limitMs?: number }): Runner`
  - `type Runner = (id: string, body: unknown, mode: "preview" | "run") => Promise<{ code: number; body: unknown }>`
  - `new Registry(server, sources, now?, actions?)`, which now attaches refs and publishes `state().actions`
  - `buildServer(reg, token, { https?, run?: Runner })`

- [ ] **Step 1: Add the dependencies**

Run: `pnpm --filter @hetops-control/agent add zod@3.23.8 zod-to-json-schema@3.23.5`
Expected: `package.json` and `pnpm-lock.yaml` change; nothing else.

- [ ] **Step 2: Write the failing test** `apps/agent/test/actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { AgentStateSchema, type Action } from "@hetops-control/contracts";
import { Registry } from "../src/registry.js"; import { buildServer } from "../src/server.js";
import { actionRunner, buildActions, describeAction } from "../src/actions/index.js";

const t0 = new Date("2026-10-31T10:00:00Z");
const ent = (name: string) => ({ id: `lab/app/${name}`, kind: "app" as const, server: "lab" as const, name, status: "ok" as const, facts: {}, links: [], actions: [], observedAt: t0.toISOString() });
const src = { id: "fake", periodMs: 10_000, async collect() { return { entities: [ent("x"), ent("y")] }; } };
const ran: unknown[] = [];
const poke: Action<{ times: number }> = {
  id: "test.poke", label: "Poke", description: "Pokes x.", targets: ["app"], risk: "safe",
  params: z.object({ times: z.number().int().min(1).max(3).default(1).describe("How often") }).strict(),
  applies: e => e.name === "x",
  async preview(t, p) { return `Pokes ${t.name} ${p.times} time(s).`; },
  async run(t, p, ctx) { ran.push([t.id, p, ctx.actor, ctx.requestId]); return { ok: true, summary: `poked ${t.name}` }; },
};
const hang: Action<Record<string, never>> = { ...poke, id: "test.hang", params: z.object({}).strict(), run: () => new Promise(() => {}) } as never;
const body = (over: object = {}) => ({ target: "lab/app/x", params: {}, actor: "het@hetops.dev", requestId: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", ...over });

async function setup(limitMs?: number) {
  const reg = new Registry("lab", [src], () => t0, [poke, hang]); await reg.runOnce("fake");
  const app = buildServer(reg, "s3cret", { run: actionRunner(reg, [poke, hang], limitMs ? { limitMs } : {}) });
  const post = (url: string, payload: unknown, auth = "Bearer s3cret") => app.inject({ method: "POST", url, payload: payload as object, headers: { authorization: auth } });
  return { reg, app, post };
}

describe("agent actions", () => {
  it("offers an action only on the entities it applies to, and publishes its descriptor", async () => {
    const { reg } = await setup();
    const s = AgentStateSchema.parse(reg.state());
    expect(s.entities.find(e => e.name === "x")!.actions).toEqual([{ id: "test.poke", label: "Poke", risk: "safe" }, { id: "test.hang", label: "Poke", risk: "safe" }]);
    expect(s.entities.find(e => e.name === "y")!.actions).toEqual([]);
    expect(s.actions!.find(a => a.id === "test.poke")!.params.properties.times).toEqual({ type: "integer", minimum: 1, maximum: 3, default: 1, description: "How often" });
  });
  it("needs the bearer token", async () => {
    const { post } = await setup();
    expect((await post("/v1/actions/test.poke", body(), "Bearer nope")).statusCode).toBe(401);
  });
  it("previews and runs with the actor and request id, after validating everything", async () => {
    const { post } = await setup(); ran.length = 0;
    expect((await post("/v1/actions/test.poke/preview", body({ params: { times: 2 } }))).json()).toEqual({ text: "Pokes x 2 time(s)." });
    const r = await post("/v1/actions/test.poke", body());
    expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ ok: true, summary: "poked x" });
    expect(ran).toEqual([["lab/app/x", { times: 1 }, "het@hetops.dev", "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10"]]);
    expect((await post("/v1/actions/test.nope", body())).statusCode).toBe(404);
    expect((await post("/v1/actions/test.poke", body({ target: "lab/app/y" }))).statusCode).toBe(422);   // not offered on y
    expect((await post("/v1/actions/test.poke", body({ target: "lab/app/zz" }))).statusCode).toBe(422);
    expect((await post("/v1/actions/test.poke", body({ params: { times: 9 } }))).statusCode).toBe(422);
    expect((await post("/v1/actions/test.poke", body({ actor: "nobody" }))).statusCode).toBe(400);
    expect(ran).toHaveLength(1);
  });
  it("one run per target at a time, and a hung action fails at the limit instead of hanging", async () => {
    const { post } = await setup(50);
    const first = post("/v1/actions/test.hang", body());
    await new Promise(r => setTimeout(r, 10));   // let the first request reach its handler and take the lock
    expect((await post("/v1/actions/test.poke", body())).statusCode).toBe(409);
    expect((await first).json()).toEqual({ ok: false, summary: "timed out after 0.05 s; the result is unknown" });
  });
  it("buildActions: only what ACTIONS names, each with its settings", () => {
    const make = { "test.poke": () => poke };
    expect(buildActions({}, make)).toEqual([]);
    expect(buildActions({ ACTIONS: " test.poke " }, make)).toEqual([poke]);
    expect(() => buildActions({ ACTIONS: "test.nope" }, make)).toThrow("unknown action test.nope in ACTIONS");
  });
  it("every params schema stays inside the subset the web and center understand", () => {
    expect(describeAction(poke).params.additionalProperties).toBe(false);
    const wild = { ...poke, params: z.object({ x: z.string().regex(/a/) }) };
    expect(() => describeAction(wild as never)).toThrow();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm vitest run apps/agent/test/actions.test.ts`
Expected: FAIL, cannot find `../src/actions/index.js`.

- [ ] **Step 4: Implement** `apps/agent/src/actions/index.ts`:

```ts
import { zodToJsonSchema } from "zod-to-json-schema";
import { ActionPreviewSchema, ActionRequestSchema, ActionResultSchema, ParamsJsonSchema, type Action, type ActionDescriptor } from "@hetops-control/contracts";
import type { Registry } from "../registry.js";

/** The descriptor published in /v1/state: the zod params become JSON Schema, refused if outside the shared subset. */
export const describeAction = (a: Action<any>): ActionDescriptor => ({
  id: a.id, label: a.label, description: a.description, targets: a.targets, risk: a.risk, preview: !!a.preview,
  params: ParamsJsonSchema.parse(zodToJsonSchema(a.params, { target: "jsonSchema7", $refStrategy: "none" })),
});

type Maker = (env: NodeJS.ProcessEnv) => Action<any>;
/** Every verb this agent can offer; Tasks 3-6 add theirs. Which ones run is the deployment's choice (ACTIONS). */
export const MAKERS: Record<string, Maker> = {};
/** Reads a setting an action needs; a missing one stops the agent at start, never at the owner's click. */
export const need = (env: NodeJS.ProcessEnv, key: string, id: string) => { const v = env[key]; if (!v) throw new Error(`${id} needs ${key}`); return v; };

/** The allow-list: ACTIONS names the verbs (comma-separated). Unknown names are an error, not a silent skip. */
export function buildActions(env: NodeJS.ProcessEnv = process.env, make: Record<string, Maker> = MAKERS): Action<any>[] {
  const ids = (env.ACTIONS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return [...new Set(ids)].map(id => {
    const m = make[id];
    if (!m) throw new Error(`unknown action ${id} in ACTIONS`);
    return m(env);
  });
}

export type Runner = (id: string, body: unknown, mode: "preview" | "run") => Promise<{ code: number; body: unknown }>;
const LIMIT_MS = 55_000;   // under the center's 60 s, so the agent's own answer arrives first

/** Validates a request against the live state (the target must exist and offer the action), then previews or runs it. */
export function actionRunner(reg: Registry, actions: Action<any>[], opts: { limitMs?: number } = {}): Runner {
  const limitMs = opts.limitMs ?? LIMIT_MS;
  const busy = new Set<string>();   // targets with a run in flight; released when the run settles, even after a timeout
  return async (id, raw, mode) => {
    const a = actions.find(x => x.id === id);
    if (!a) return { code: 404, body: { error: `no action ${id} on this agent` } };
    const req = ActionRequestSchema.safeParse(raw);
    if (!req.success) return { code: 400, body: { error: "bad request" } };
    const target = reg.state().entities.find(e => e.id === req.data.target);
    if (!target?.actions.some(r => r.id === id)) return { code: 422, body: { error: `${id} is not offered for ${req.data.target}` } };
    const p = a.params.safeParse(req.data.params);
    if (!p.success) return { code: 422, body: { error: `params: ${p.error.issues.map(i => `${i.path.join(".") || "(root)"} ${i.code}`).join("; ")}` } };
    if (mode === "run" && busy.has(target.id)) return { code: 409, body: { error: `an action on ${target.name} is still running` } };
    const ac = new AbortController();
    const ctx = { server: target.server, now: () => new Date(), actor: req.data.actor, requestId: req.data.requestId, signal: ac.signal };
    const work: Promise<unknown> = mode === "preview"
      ? (a.preview ? a.preview(target, p.data, ctx) : Promise.resolve(a.description)).then(text => ActionPreviewSchema.parse({ text }))
      : a.run(target, p.data, ctx).then(r => ActionResultSchema.parse(r));
    if (mode === "run") { busy.add(target.id); void work.then(() => busy.delete(target.id), () => busy.delete(target.id)); }
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new Error(`timed out after ${limitMs / 1000} s; the result is unknown`)); }, limitMs); });
      return { code: 200, body: await Promise.race([work, timeout]) };
    } catch (e) {
      // the message only (the http helper never puts a body or a header in it); a failed run is a result, a failed preview an error
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      return mode === "run" ? { code: 200, body: { ok: false, summary: msg } } : { code: 502, body: { error: msg } };
    } finally { clearTimeout(timer); }
  };
}
```

In `registry.ts`:
- Add `import type { Action, ActionDescriptor } from "@hetops-control/contracts"; import { describeAction } from "./actions/index.js";`
- Change the constructor to `constructor(private server: ServerId, private sources: Source[], private now: () => Date = () => new Date(), private actions: Action<any>[] = [])` and set `this.descriptors = actions.map(describeAction);`. Declare the field `private descriptors: ActionDescriptor[];`. The descriptors are computed once, so a bad schema fails at start.
- At the end of `state()`, replace the return with:

```ts
    // each entity offers the actions that apply to it; the source never has to know which verbs this agent runs
    const offer = (e: Entity): Entity => {
      const refs = this.actions.filter(a => a.targets.includes(e.kind) && a.applies(e)).map(a => ({ id: a.id, label: a.label, risk: a.risk }));
      return refs.length ? { ...e, actions: [...e.actions, ...refs] } : e;
    };
    return { server: this.server, version: process.env.VERSION ?? "dev", generatedAt: this.now().toISOString(),
      entities: entities.sort(byId).map(offer), sources: reports, series: series.sort(byId),
      ...(this.descriptors.length ? { actions: this.descriptors } : {}) };
```

In `server.ts`, change the signature to `buildServer(reg: Registry, token: string, opts: { https?: { cert: string; key: string }; run?: Runner } = {})`. Import `type Runner` from `./actions/index.js`. Add after the `/v1/state` route:

```ts
  // the allow-listed verbs; bodies are small (a target, a few params)
  const act = (mode: "preview" | "run") => async (req: { params: unknown; body: unknown; log: { info(o: object, m: string): void } }, rep: { code(n: number): { send(b: unknown): unknown } }) => {
    const id = (req.params as { id: string }).id;
    if (!opts.run) return rep.code(404).send({ error: "this agent offers no actions" });
    const out = await opts.run(id, req.body, mode);
    const b = req.body as { target?: unknown; actor?: unknown } | undefined;
    if (mode === "run") req.log.info({ action: id, target: b?.target, actor: b?.actor, code: out.code, ok: (out.body as { ok?: unknown })?.ok }, "action");
    return rep.code(out.code).send(out.body);
  };
  app.post("/v1/actions/:id", { bodyLimit: 16_384 }, act("run"));
  app.post("/v1/actions/:id/preview", { bodyLimit: 16_384 }, act("preview"));
```

In `main.ts`:

```ts
import { actionRunner, buildActions } from "./actions/index.js";
const cfg = loadConfig();
const actions = buildActions();          // throws on an unknown or unconfigured name: the pod fails to start, visibly
const reg = new Registry(cfg.server, buildSources(realKube()), undefined, actions);
reg.start();
const app = buildServer(reg, cfg.token, { ...(cfg.https ? { https: cfg.https } : {}), run: actionRunner(reg, actions) });
```

- [ ] **Step 5: Run the agent tests and typecheck**

Run: `pnpm vitest run apps/agent && pnpm typecheck`
Expected: PASS, including every stage-1 agent test (an agent without `ACTIONS` publishes no `actions` key and no refs).

- [ ] **Step 6: Commit**

```bash
git switch -c feat/agent-actions origin/main   # after Task 1 merged
git add apps/agent pnpm-lock.yaml
git commit -S -m "feat(agent): allow-listed actions with refs, preview and run"
```

---

### Task 3: `snapshot.now` (ops agent, ES SLM execute)

**Files:**
- Create: `apps/agent/src/actions/snapshot.ts`, `apps/agent/test/snapshot-action.test.ts`, `apps/agent/test/fixtures/es-slm-execute.json`
- Modify: `apps/agent/src/sources/elasticsearch.ts` (export `basicAuth`), `apps/agent/src/actions/index.ts` (register)

**Interfaces:**
- Consumes: `EsReader.slm()` (existing), `json()` from `sources/http.ts`, `MAKERS`, `need` (Task 2).
- Produces: `interface EsOperator { execute(policy: string): Promise<any> }`, `realEsOperator(base: string, authDir: string): EsOperator`, `snapshotNow(reader: EsReader, op: EsOperator): Action<{}>`, `basicAuth(authDir: string): { authorization: string }`. Settings: `ES_URL`, `ES_AUTH_DIR` (reader), `ES_OPERATOR_DIR` (operator).

- [ ] **Step 1: The fixture.** `test/fixtures/es-slm-execute.json` holds Elasticsearch 9.5's `_execute` answer, as its API reference documents it. Task 11 replaces it with the recording from hetops-3, and the test must still pass:

```json
{ "snapshot_name": "nightly-all-2026.10.31-k7q2zrwjsv-1vy3k7l8bqg" }
```

- [ ] **Step 2: Write the failing test** `apps/agent/test/snapshot-action.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { snapshotNow, type EsOperator } from "../src/actions/snapshot.js";
import { describeAction } from "../src/actions/index.js";
// es-slm.json: recorded on hetops-3 (stage 1b Task 2), GET _slm/policy; es-slm-execute.json: POST _slm/policy/<id>/_execute
import slm from "./fixtures/es-slm.json"; import executed from "./fixtures/es-slm-execute.json";

const backup = (name: string, source = "snapshots"): Entity => ({ id: `ops/backup/${name}`, kind: "backup", server: "ops", name, status: "ok", facts: {}, links: [], actions: [], observedAt: "2026-10-31T10:00:00Z", source });
const ctx = { server: "ops" as const, now: () => new Date("2026-10-31T10:00:00Z"), actor: "het@hetops.dev", requestId: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", signal: new AbortController().signal };
const setup = (policies: any = slm) => {
  const calls: string[] = [];
  const op: EsOperator = { execute: async p => { calls.push(p); return executed; } };
  return { calls, a: snapshotNow({ slm: async () => policies, health: async () => ({}), flow: async () => ({}) }, op) };
};

describe("snapshot.now (recorded)", () => {
  it("is offered on the SLM policies only, with no params", () => {
    const { a } = setup();
    expect(a.applies(backup("nightly-all"))).toBe(true);
    expect(a.applies(backup("nightly-all", "kubernetes"))).toBe(false);
    expect(describeAction(a).params.properties).toEqual({});
  });
  it("previews exactly what the policy will snapshot, where to, and that the schedule still runs", async () => {
    const text = await setup().a.preview!(backup("nightly-security"), {}, ctx);
    expect(text).toContain("logs-lab-security, .internal.alerts-security.alerts-*");
    expect(text).toContain("the r2 repository");
    expect(text).toContain("01:45 UTC");
    expect(text).not.toContain("already running");
  });
  it("runs the policy once and returns the snapshot's name", async () => {
    const { a, calls } = setup();
    expect(await a.run(backup("nightly-all"), {}, ctx)).toEqual({ ok: true, ref: executed.snapshot_name,
      summary: `${executed.snapshot_name} started; the Backups page shows it once it finishes` });
    expect(calls).toEqual(["nightly-all"]);
  });
  it("returns the snapshot in progress instead of starting a second one", async () => {
    const busy = structuredClone(slm) as any;
    busy["nightly-all"].in_progress = { name: "nightly-all-2026.10.31-running", uuid: "u", state: "STARTED", start_time_millis: 1761904800000 };
    const { a, calls } = setup(busy);
    expect(await a.run(backup("nightly-all"), {}, ctx)).toMatchObject({ ok: true, already: true, ref: "nightly-all-2026.10.31-running" });
    expect(await a.preview!(backup("nightly-all"), {}, ctx)).toContain("already running");
    expect(calls).toEqual([]);
  });
  it("refuses a policy that no longer exists, and an answer without a name", async () => {
    await expect(setup().a.run(backup("gone"), {}, ctx)).rejects.toThrow("no SLM policy gone");
    const op: EsOperator = { execute: async () => ({}) };
    const a = snapshotNow({ slm: async () => slm, health: async () => ({}), flow: async () => ({}) }, op);
    await expect(a.run(backup("nightly-all"), {}, ctx)).rejects.toThrow("did not name the snapshot");
  });
});
```

Run `pnpm vitest run apps/agent/test/snapshot-action.test.ts`. Expected: FAIL (module missing). If `"01:45 UTC"` does not match the fixture's `next_execution_millis`, read the fixture's value and use the time it encodes; the schedule (`0 45 1 * * ?`) says 01:45.

- [ ] **Step 3: Implement.** In `sources/elasticsearch.ts`, lift the header builder out of `realEs` so both identities share it:

```ts
/** The Authorization header for a file-realm user whose username and password are files in authDir (read on every call). */
export const basicAuth = (authDir: string) => {
  const [u, p] = ["username", "password"].map(f => readFileSync(join(authDir, f), "utf8").trim());
  return { authorization: `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}` };
};
```

and in `realEs` replace `const auth = () => {…}` with `const auth = () => basicAuth(authDir);`.

`apps/agent/src/actions/snapshot.ts`:

```ts
import { z } from "zod";
import type { Action } from "@hetops-control/contracts";
import { basicAuth, type EsReader } from "../sources/elasticsearch.js";
import { json } from "../sources/http.js";

/** The one call control-operator makes (role control_operator: cluster manage_slm). Reads stay with control-reader. */
export interface EsOperator { execute(policy: string): Promise<any> }
export const realEsOperator = (base: string, authDir: string): EsOperator => ({
  execute: policy => json(`${base}/_slm/policy/${encodeURIComponent(policy)}/_execute`, { method: "POST", headers: basicAuth(authDir) }),
});

const Params = z.object({}).strict();
const hhmm = (ms: unknown) => (typeof ms === "number" && Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(11, 16)} UTC` : "its next scheduled time");

export function snapshotNow(reader: EsReader, op: EsOperator): Action<z.infer<typeof Params>> {
  const policy = async (name: string) => {
    const all = await reader.slm();
    const p = all && typeof all === "object" ? (all as Record<string, any>)[name] : undefined;
    if (!p) throw new Error(`no SLM policy ${name}`);
    return p;
  };
  return {
    id: "snapshot.now", label: "Snapshot now", targets: ["backup"], risk: "safe",
    description: "Runs the snapshot policy once, now, exactly as its schedule would.",
    params: Params,
    applies: e => e.source === "snapshots",
    async preview(t) {
      const p = await policy(t.name);
      const indices = (p.policy?.config?.indices ?? []).join(", ") || "every index";
      const busy = p.in_progress?.name ? ` ${p.in_progress.name} is already running, so this returns it instead of starting another.` : "";
      return `Takes a snapshot of ${indices} into the ${p.policy?.repository ?? "policy's"} repository now, as policy ${t.name}. `
        + `The scheduled run at ${hhmm(p.next_execution_millis)} still happens, and retention (${p.policy?.retention?.expire_after ?? "none"}) applies to this one too.${busy}`;
    },
    async run(t) {
      const p = await policy(t.name);
      if (p.in_progress?.name) return { ok: true, already: true, ref: String(p.in_progress.name), summary: `${p.in_progress.name} is already running` };
      const r = await op.execute(t.name);
      if (typeof r?.snapshot_name !== "string") throw new Error("Elasticsearch did not name the snapshot");
      return { ok: true, ref: r.snapshot_name, summary: `${r.snapshot_name} started; the Backups page shows it once it finishes` };
    },
  };
}
```

Register it in `actions/index.ts` (imports at the top):

```ts
import { realEs } from "../sources/elasticsearch.js";
import { realEsOperator, snapshotNow } from "./snapshot.js";
const origin = (v: string) => new URL(v).origin;
export const MAKERS: Record<string, Maker> = {
  "snapshot.now": env => snapshotNow(realEs(origin(need(env, "ES_URL", "snapshot.now")), env.ES_AUTH_DIR ?? "/secrets/es"),
    realEsOperator(origin(need(env, "ES_URL", "snapshot.now")), need(env, "ES_OPERATOR_DIR", "snapshot.now"))),
};
```

Add to `actions.test.ts`: `it("snapshot.now needs ES_URL and ES_OPERATOR_DIR", () => { expect(() => buildActions({ ACTIONS: "snapshot.now" })).toThrow("snapshot.now needs ES_URL"); expect(() => buildActions({ ACTIONS: "snapshot.now", ES_URL: "https://es:9200" })).toThrow("needs ES_OPERATOR_DIR"); expect(buildActions({ ACTIONS: "snapshot.now", ES_URL: "https://es:9200", ES_OPERATOR_DIR: "/x" })[0]!.id).toBe("snapshot.now"); });`

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run apps/agent && pnpm typecheck`
Expected: PASS (the elasticsearch source tests still pass on `basicAuth`).

- [ ] **Step 5: Commit**

```bash
git add apps/agent
git commit -S -m "feat(agent): snapshot.now runs an SLM policy once"
```

---

### Task 4: `argo.sync` and `argo.refresh`

**Files:**
- Create: `apps/agent/src/actions/argo.ts`, `apps/agent/test/argo-actions.test.ts`, `apps/agent/test/fixtures/argo-app.json`
- Modify: `apps/agent/src/actions/index.ts` (register)

**Interfaces:**
- Consumes: `@kubernetes/client-node` (`KubeConfig`, `CustomObjectsApi`, `setHeaderOptions`, `PatchStrategy`), `MAKERS` (Task 2).
- Produces:
  - `interface ArgoApps { get(name: string): Promise<any>; patch(name: string, body: object): Promise<unknown> }`
  - `realArgo(): ArgoApps`
  - `argoSync(api: ArgoApps): Action<{}>`, which sends exactly `{"operation":{"initiatedBy":{"username":"<actor> (hetops-control)"},"sync":{"syncStrategy":{"hook":{}}}}}`
  - `argoRefresh(api: ArgoApps): Action<{hard: boolean}>`, which sends exactly `{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"normal"|"hard"}}}`

  The admission policy in Tasks 12 and 13 allows exactly these two shapes.

- [ ] **Step 1: Record the fixture on the lab (read-only).** One Application as Argo CD stores it, without managed fields:

```bash
ssh ubuntu@140.245.13.138 'kubectl get application cert-manager -n argocd -o json | python3 -c "
import json, sys
a = json.load(sys.stdin); m = a[\"metadata\"]
m.pop(\"managedFields\", None)
(m.get(\"annotations\") or {}).pop(\"kubectl.kubernetes.io/last-applied-configuration\", None)
print(json.dumps(a, indent=1))"' > apps/agent/test/fixtures/argo-app.json
grep -n -i -E "token|password|secret|bearer" apps/agent/test/fixtures/argo-app.json   # expect nothing (repo URLs are public)
```

- [ ] **Step 2: Write the failing test** `apps/agent/test/argo-actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { argoRefresh, argoSync, type ArgoApps } from "../src/actions/argo.js";
import { describeAction } from "../src/actions/index.js";
// Recorded on the lab, 31 Oct 2026: kubectl get application cert-manager -n argocd -o json (managedFields removed)
import rec from "./fixtures/argo-app.json";

const app = (name = "cert-manager", source = "argo"): Entity => ({ id: `lab/argo-app/${name}`, kind: "argo-app", server: "lab", name, status: "attention",
  facts: {}, links: [], actions: [], observedAt: "2026-10-31T10:00:00Z", source });
const ctx = { server: "lab" as const, now: () => new Date("2026-10-31T10:00:00Z"), actor: "het@hetops.dev", requestId: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", signal: new AbortController().signal };
const fake = (obj: any = rec) => { const patches: [string, object][] = []; const api: ArgoApps = { get: async () => obj, patch: async (n, b) => { patches.push([n, b]); return obj; } }; return { api, patches }; };

describe("argo.sync (recorded)", () => {
  it("is offered on Argo CD apps, with no params", () => {
    const a = argoSync(fake().api);
    expect(a.applies(app())).toBe(true); expect(a.applies(app("x", "kubernetes"))).toBe(false);
    expect(describeAction(a).params.properties).toEqual({});
  });
  it("previews the revision, repo and path from the app itself, and says nothing is pruned", async () => {
    const text = await argoSync(fake().api).preview!(app(), {}, ctx);
    const src = (rec as any).spec.source ?? (rec as any).spec.sources[0];
    expect(text).toContain(String(src.targetRevision)); expect(text).toContain(String(src.repoURL));
    expect(text).toContain("Nothing is pruned");
  });
  it("starts a sync with exactly the patch the admission policy allows", async () => {
    const { api, patches } = fake();
    expect(await argoSync(api).run(app(), {}, ctx)).toEqual({ ok: true, summary: "sync of cert-manager started" });
    expect(patches).toEqual([["cert-manager", { operation: { initiatedBy: { username: "het@hetops.dev (hetops-control)" }, sync: { syncStrategy: { hook: {} } } } }]]);
  });
  it("does not start a second sync while one runs", async () => {
    const running = structuredClone(rec) as any; running.status.operationState = { ...(running.status.operationState ?? {}), phase: "Running" };
    const { api, patches } = fake(running);
    expect(await argoSync(api).run(app(), {}, ctx)).toEqual({ ok: true, already: true, summary: "a sync of cert-manager is already running" });
    expect(patches).toEqual([]);
  });
  it("refuses a name that is not a Kubernetes name", async () => {
    await expect(argoSync(fake().api).run(app("../x"), {}, ctx)).rejects.toThrow("not an Argo CD application name");
  });
});

describe("argo.refresh", () => {
  it("annotates normal or hard, nothing else", async () => {
    const { api, patches } = fake(); const a = argoRefresh(api);
    expect(describeAction(a).params.properties.hard).toMatchObject({ type: "boolean", default: false });
    expect(await a.run(app(), { hard: false }, ctx)).toEqual({ ok: true, summary: "refresh of cert-manager requested" });
    expect(await a.run(app(), { hard: true }, ctx)).toEqual({ ok: true, summary: "hard refresh of cert-manager requested" });
    expect(patches.map(p => p[1])).toEqual([{ metadata: { annotations: { "argocd.argoproj.io/refresh": "normal" } } }, { metadata: { annotations: { "argocd.argoproj.io/refresh": "hard" } } }]);
    expect(await a.preview!(app(), { hard: false }, ctx)).toContain("Nothing in the cluster changes");
  });
});
```

Run it: FAIL (module missing).

- [ ] **Step 3: Implement** `apps/agent/src/actions/argo.ts`:

```ts
import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import type { Action, Entity } from "@hetops-control/contracts";

// Argo CD Applications through the Kubernetes API (the agent's Role: get, patch in argocd). RBAC cannot see inside a patch,
// so the ValidatingAdmissionPolicy in hetops-k8s-lab (control-agent-argo-actions) allows only the two shapes sent below.
export interface ArgoApps { get(name: string): Promise<any>; patch(name: string, body: object): Promise<unknown> }

export function realArgo(): ArgoApps {
  let api: k8s.CustomObjectsApi | undefined;
  const c = () => { if (!api) { const kc = new k8s.KubeConfig(); kc.loadFromDefault(); api = kc.makeApiClient(k8s.CustomObjectsApi); } return api; };
  const where = { group: "argoproj.io", version: "v1alpha1", namespace: "argocd", plural: "applications" };
  return {
    get: name => c().getNamespacedCustomObject({ ...where, name }),
    // a JSON merge patch: only the keys sent change
    patch: (name, body) => c().patchNamespacedCustomObject({ ...where, name, body, fieldManager: "hetops-control" },
      k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch)),
  };
}

const NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const nameOf = (e: Entity) => { if (!NAME.test(e.name) || e.name.length > 253) throw new Error("not an Argo CD application name"); return e.name; };
const running = (a: any) => a?.status?.operationState?.phase === "Running";
const Sync = z.object({}).strict();
const Refresh = z.object({ hard: z.boolean().default(false).describe("Also drop Argo CD's cached manifests (a hard refresh)") }).strict();

export function argoSync(api: ArgoApps): Action<z.infer<typeof Sync>> {
  return {
    id: "argo.sync", label: "Sync", targets: ["argo-app"], risk: "safe",
    description: "Asks Argo CD to sync the application to the revision in git, as its Sync button does, without pruning.",
    params: Sync, applies: e => e.source === "argo",
    async preview(t) {
      const a = await api.get(nameOf(t)); const src = a?.spec?.source ?? a?.spec?.sources?.[0] ?? {};
      return `Syncs ${t.name} on ${t.server} to ${src.targetRevision ?? "HEAD"} of ${src.repoURL ?? "its repository"}${src.path ? ` (${src.path})` : ""}. `
        + `Now: ${a?.status?.sync?.status ?? "Unknown"}, ${a?.status?.health?.status ?? "Unknown"}. `
        + "Nothing is pruned: anything removed from git stays until Argo CD's own automated sync prunes it."
        + (running(a) ? " A sync is already running, so this changes nothing." : "");
    },
    async run(t, _p, ctx) {
      const name = nameOf(t);
      if (running(await api.get(name))) return { ok: true, already: true, summary: `a sync of ${name} is already running` };
      await api.patch(name, { operation: { initiatedBy: { username: `${ctx.actor} (hetops-control)` }, sync: { syncStrategy: { hook: {} } } } });
      return { ok: true, summary: `sync of ${name} started` };
    },
  };
}

export function argoRefresh(api: ArgoApps): Action<z.infer<typeof Refresh>> {
  return {
    id: "argo.refresh", label: "Refresh", targets: ["argo-app"], risk: "safe",
    description: "Asks Argo CD to compare the application with git now instead of at its next poll. Changes nothing in the cluster.",
    params: Refresh, applies: e => e.source === "argo",
    async preview(t, p) {
      return `Refreshes ${t.name} on ${t.server}: Argo CD re-reads git${p.hard ? " without its manifest cache (hard)" : ""} and updates the sync status. Nothing in the cluster changes.`;
    },
    async run(t, p) {
      const name = nameOf(t);
      await api.patch(name, { metadata: { annotations: { "argocd.argoproj.io/refresh": p.hard ? "hard" : "normal" } } });
      return { ok: true, summary: `${p.hard ? "hard " : ""}refresh of ${name} requested` };
    },
  };
}
```

Register in `actions/index.ts`. The two verbs share one lazy client:

```ts
import { argoRefresh, argoSync, realArgo } from "./argo.js";
let argo: ReturnType<typeof realArgo> | undefined;
// in MAKERS:
  "argo.sync": () => argoSync(argo ??= realArgo()),
  "argo.refresh": () => argoRefresh(argo ??= realArgo()),
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm vitest run apps/agent && pnpm typecheck`
Expected: PASS. If `setHeaderOptions` or `PatchStrategy` is not re-exported from the package root in 1.4.0, typecheck fails. They are defined in `dist/middleware.d.ts` and `dist/patch.d.ts`; check `dist/index.d.ts` and import from where it re-exports them, which keeps the same names.

- [ ] **Step 5: Commit**

```bash
git add apps/agent
git commit -S -m "feat(agent): argo.sync and argo.refresh through the Kubernetes API"
```

---

### Task 5: `alert.silence`

**Files:**
- Create: `apps/agent/src/actions/silence.ts`, `apps/agent/test/silence-action.test.ts`, `apps/agent/test/fixtures/alertmanager-silences.json`, `apps/agent/test/fixtures/alertmanager-silence-created.json`
- Modify: `apps/agent/src/actions/index.ts` (register)

**Interfaces:**
- Consumes: `json()` (http.ts), the alert entity id `<server>/alert/<fingerprint>` (sources/alertmanager.ts), `MAKERS`, `need`.
- Produces: `interface Silences { alerts(): Promise<any[]>; list(): Promise<any[]>; create(s: object): Promise<any> }`, `realSilences(base: string): Silences`, `alertSilence(api: Silences): Action<{hours: "1"|"4"|"12"|"24"|"72"; note?: string}>`. Setting: `ALERTMANAGER_URL`.

- [ ] **Step 1: Record the read side on the lab (read-only).** `GET /api/v2/silences` through the API server's service proxy:

```bash
ssh ubuntu@140.245.13.138 'kubectl get --raw "/api/v1/namespaces/monitoring/services/kps-kube-prometheus-stack-alertmanager:9093/proxy/api/v2/silences"' \
  | python3 -m json.tool > apps/agent/test/fixtures/alertmanager-silences.json
```

If the lab has no silences, the file is `[]`, and the test below adds its own row in Alertmanager's `gettableSilence` shape. `alertmanager-silence-created.json` starts as the v2 API's documented `postSilences` answer. Task 12 replaces it with the recording:

```json
{ "silenceID": "2f6a9a6e-3c1e-4c55-9d1c-6c1a1d0f6a10" }
```

- [ ] **Step 2: Write the failing test** `apps/agent/test/silence-action.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { alertSilence, type Silences } from "../src/actions/silence.js";
import { describeAction } from "../src/actions/index.js";
// alertmanager-alerts.json: recorded on the lab (stage 1b Task 3); silences: GET /api/v2/silences (31 Oct); created: POST /api/v2/silences
import alerts from "./fixtures/alertmanager-alerts.json"; import listed from "./fixtures/alertmanager-silences.json"; import created from "./fixtures/alertmanager-silence-created.json";

const first = (alerts as any[])[0];
const alert = (fp = first.fingerprint, source = "alertmanager"): Entity => ({ id: `lab/alert/${fp}`, kind: "alert", server: "lab", name: first.labels.alertname,
  status: "attention", facts: {}, links: [], actions: [], observedAt: "2026-10-31T10:00:00Z", source });
const KEY = "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10";
const ctx = { server: "lab" as const, now: () => new Date("2026-10-31T10:00:00Z"), actor: "het@hetops.dev", requestId: KEY, signal: new AbortController().signal };
const fake = (silences: any[] = listed as any[]) => { const made: any[] = []; const api: Silences = { alerts: async () => alerts as any[], list: async () => silences, create: async s => { made.push(s); return created; } }; return { api, made }; };

describe("alert.silence (recorded)", () => {
  it("is offered on Alertmanager alerts; hours are a choice, capped at 72, the note is bounded", () => {
    const a = alertSilence(fake().api);
    expect(a.applies(alert())).toBe(true); expect(a.applies(alert(first.fingerprint, "gatus"))).toBe(false);
    expect(describeAction(a).params.properties).toEqual({
      hours: { type: "string", enum: ["1", "4", "12", "24", "72"], default: "4", description: "For how long, in hours" },
      note: { type: "string", maxLength: 200, description: "Why (kept with the silence in Alertmanager)" } });
  });
  it("silences exactly this alert: every label, equal, never a regex, with the actor and the request key", async () => {
    const { api, made } = fake();
    const r = await alertSilence(api).run(alert(), { hours: "4", note: "known, fixing" }, ctx);
    expect(r).toEqual({ ok: true, ref: created.silenceID, summary: `${first.labels.alertname} silenced for 4 h, until 14:00 UTC` });
    const labels = Object.keys(first.labels).sort();
    expect(made[0].matchers.map((m: any) => m.name)).toEqual(labels);
    expect(made[0].matchers.every((m: any) => m.isEqual === true && m.isRegex === false && m.value === String(first.labels[m.name]))).toBe(true);
    expect(made[0]).toMatchObject({ startsAt: "2026-10-31T10:00:00.000Z", endsAt: "2026-10-31T14:00:00.000Z", createdBy: "het@hetops.dev",
      comment: `known, fixing [hetops-control ${KEY}]` });
  });
  it("returns the silence it already made under the same request key", async () => {
    const mine = { id: "a1", status: { state: "active" }, comment: `x [hetops-control ${KEY}]`, createdBy: "het@hetops.dev", startsAt: "2026-10-31T10:00:00Z", endsAt: "2026-10-31T14:00:00Z", matchers: [], updatedAt: "2026-10-31T10:00:00Z" };
    const { api, made } = fake([...(listed as any[]), mine]);
    expect(await alertSilence(api).run(alert(), { hours: "4" }, ctx)).toEqual({ ok: true, already: true, ref: "a1", summary: "already silenced until 14:00 UTC" });
    expect(made).toEqual([]);
  });
  it("refuses an alert that stopped firing; the preview lists the exact matchers", async () => {
    const { api } = fake();
    await expect(alertSilence(api).run(alert("0000000000000000"), { hours: "1" }, ctx)).rejects.toThrow("no longer firing");
    expect(await alertSilence(api).preview!(alert(), { hours: "1" }, ctx)).toContain(`alertname="${first.labels.alertname}"`);
  });
});
```

Run it: FAIL (module missing).

- [ ] **Step 3: Implement** `apps/agent/src/actions/silence.ts`:

```ts
import { z } from "zod";
import type { Action, Entity } from "@hetops-control/contracts";
import { json } from "../sources/http.js";

// Alertmanager's API v2 (kps-kube-prometheus-stack-alertmanager.monitoring:9093). It has no auth of its own; the NetworkPolicy-free
// monitoring namespace already lets the agent in for the alerts source.
export interface Silences { alerts(): Promise<any[]>; list(): Promise<any[]>; create(s: object): Promise<any> }
export const realSilences = (base: string): Silences => ({
  alerts: () => json(`${base}/api/v2/alerts?active=true`),   // silenced ones too: the alert may already be muted
  list: () => json(`${base}/api/v2/silences`),
  create: s => json(`${base}/api/v2/silences`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) }),
});

const Params = z.object({
  hours: z.enum(["1", "4", "12", "24", "72"]).default("4").describe("For how long, in hours"),
  note: z.string().max(200).optional().describe("Why (kept with the silence in Alertmanager)"),
}).strict();
const HOUR = 3_600_000;
const tag = (key: string) => `[hetops-control ${key}]`;
const hhmm = (at: Date | string) => `${new Date(at).toISOString().slice(11, 16)} UTC`;
const matchers = (labels: Record<string, unknown>) => Object.keys(labels).sort().map(name => ({ name, value: String(labels[name]), isRegex: false, isEqual: true }));

export function alertSilence(api: Silences): Action<z.infer<typeof Params>> {
  const firing = async (e: Entity) => {
    const fp = e.id.slice(e.id.lastIndexOf("/") + 1);
    const a = (await api.alerts()).find(x => x?.fingerprint === fp);
    if (!a?.labels || typeof a.labels !== "object") throw new Error(`${e.name} is no longer firing`);
    return a.labels as Record<string, unknown>;
  };
  return {
    id: "alert.silence", label: "Silence", targets: ["alert"], risk: "safe",
    description: "Silences exactly this alert in Alertmanager for a set time: it keeps being evaluated, and notifications stop until the silence ends.",
    params: Params, applies: e => e.source === "alertmanager",
    async preview(t, p, ctx) {
      const m = matchers(await firing(t)).map(x => `${x.name}="${x.value}"`).join(", ");
      const end = new Date(ctx.now().getTime() + Number(p.hours) * HOUR);
      return `Creates a silence in the ${t.server} Alertmanager for ${p.hours} h, until ${hhmm(end)}, matching exactly {${m}}. `
        + "Only this alert is muted; an alert with any other label still notifies.";
    },
    async run(t, p, ctx) {
      const mine = (await api.list()).find(s => s?.status?.state === "active" && String(s.comment ?? "").includes(tag(ctx.requestId)));
      if (mine) return { ok: true, already: true, ref: String(mine.id), summary: `already silenced until ${hhmm(mine.endsAt)}` };
      const labels = await firing(t), start = ctx.now(), end = new Date(start.getTime() + Number(p.hours) * HOUR);
      const r = await api.create({ matchers: matchers(labels), startsAt: start.toISOString(), endsAt: end.toISOString(), createdBy: ctx.actor,
        comment: `${p.note?.trim() || "Silenced from HetOps Control"} ${tag(ctx.requestId)}` });
      if (typeof r?.silenceID !== "string") throw new Error("Alertmanager did not return a silence id");
      return { ok: true, ref: r.silenceID, summary: `${t.name} silenced for ${p.hours} h, until ${hhmm(end)}` };
    },
  };
}
```

Register: `"alert.silence": env => alertSilence(realSilences(origin(need(env, "ALERTMANAGER_URL", "alert.silence")))),` with `import { alertSilence, realSilences } from "./silence.js";`.

- [ ] **Step 4: Run the tests.** Run: `pnpm vitest run apps/agent && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent
git commit -S -m "feat(agent): alert.silence mutes exactly one alert"
```

---

### Task 6: `coolify.redeploy`

**Files:**
- Create: `apps/agent/src/actions/coolify.ts`, `apps/agent/test/coolify-action.test.ts`, `apps/agent/test/fixtures/coolify-deploy.json`
- Modify: `apps/agent/src/actions/index.ts` (register)

**Interfaces:**
- Consumes: `CoolifyReader`, `realCoolify` (sources/coolify.ts, the read token), `json()`, `MAKERS`, `need`.
- Produces: `interface CoolifyDeployer { deploy(uuid: string): Promise<any> }`, `realCoolifyDeployer(base: string, tokenFile: string)`, `coolifyRedeploy(reader: CoolifyReader, deployer: CoolifyDeployer): Action<{}>`. Settings: `COOLIFY_URL`, `COOLIFY_TOKEN_FILE` (read), `COOLIFY_DEPLOY_TOKEN_FILE` (deploy).

- [ ] **Step 1: Confirm the endpoint on the running Coolify (read-only).** It must accept POST and check the `deploy` ability:

```bash
ssh ubuntu@140.245.13.138 'docker exec coolify grep -n -E "/deploy\b|ability:deploy" /var/www/html/routes/api.php'
```

Expected: a route for `/deploy` that `match`es `get` and `post`, with middleware `api.ability:deploy`. If it is GET-only in this beta, use `GET` in `realCoolifyDeployer` and record that in the journal; nothing else changes.

`test/fixtures/coolify-deploy.json` starts as Coolify's documented answer. Task 12 replaces it with the recording:

```json
{ "deployments": [ { "message": "Application hetops-dns deployment queued.", "resource_uuid": "y4edofq4pzebjid6hyksdl8z", "deployment_uuid": "q0x8c4kq2b9n7m5v3z1w6t8r" } ] }
```

- [ ] **Step 2: Write the failing test** `apps/agent/test/coolify-action.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { coolifyRedeploy, type CoolifyDeployer } from "../src/actions/coolify.js";
import type { CoolifyReader } from "../src/sources/coolify.js";
import { describeAction } from "../src/actions/index.js";
// coolify.json: recorded on the lab (stage 1b Task 4); coolify-deploy.json: POST /api/v1/deploy?uuid=…&force=false
import rec from "./fixtures/coolify.json"; import deployed from "./fixtures/coolify-deploy.json";

const DNS = "y4edofq4pzebjid6hyksdl8z";
const app = (uuid = DNS, source = "coolify"): Entity => ({ id: `lab/app/coolify/${uuid}`, kind: "app", server: "lab", name: "hetops-dns", status: "ok",
  facts: { branch: { value: "main" }, repository: { value: "Het101/hetops-dns" }, lastDeployDuration: { value: 41, unit: "s" } }, links: [], actions: [], observedAt: "2026-10-31T10:00:00Z", source });
const ctx = { server: "lab" as const, now: () => new Date("2026-10-31T10:00:00Z"), actor: "het@hetops.dev", requestId: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", signal: new AbortController().signal };
const setup = (newest?: object) => {
  const asked: string[] = [];
  const reader: CoolifyReader = { applications: async () => rec.applications, deployments: async (uuid, take) =>
    (newest ? [newest] : ((rec.deployments as any)[uuid]?.deployments ?? [])).slice(0, take) };
  const deployer: CoolifyDeployer = { deploy: async uuid => { asked.push(uuid); return deployed; } };
  return { asked, a: coolifyRedeploy(reader, deployer) };
};

describe("coolify.redeploy (recorded)", () => {
  it("is offered on Coolify apps only, with no params", () => {
    const { a } = setup();
    expect(a.applies(app())).toBe(true); expect(a.applies(app(DNS, "kubernetes"))).toBe(false);
    expect(describeAction(a).params.properties).toEqual({});
  });
  it("queues one deploy and returns its id", async () => {
    const { a, asked } = setup({ deployment_uuid: "old", status: "finished" });
    expect(await a.run(app(), {}, ctx)).toEqual({ ok: true, ref: deployed.deployments[0]!.deployment_uuid, summary: "deploy of hetops-dns queued; the Apps page shows it when it finishes" });
    expect(asked).toEqual([DNS]);
  });
  it("returns the queued or running deploy instead of a second one", async () => {
    for (const status of ["queued", "in_progress"]) {
      const { a, asked } = setup({ deployment_uuid: "busy1", status });
      expect(await a.run(app(), {}, ctx)).toMatchObject({ ok: true, already: true, ref: "busy1" });
      expect(asked).toEqual([]);
    }
  });
  it("previews the source and the expected time; refuses an id that is not Coolify's", async () => {
    const { a } = setup({ deployment_uuid: "old", status: "finished" });
    const text = await a.preview!(app(), {}, ctx);
    expect(text).toContain("Het101/hetops-dns (main)"); expect(text).toContain("about 41 s");
    await expect(a.run(app("../../x"), {}, ctx)).rejects.toThrow("not a Coolify application id");
  });
  it("a refusal from Coolify is an error with its message", async () => {
    const reader: CoolifyReader = { applications: async () => [], deployments: async () => [] };
    const a = coolifyRedeploy(reader, { deploy: async () => ({ message: "Unauthenticated." }) });
    await expect(a.run(app(), {}, ctx)).rejects.toThrow("Coolify did not queue a deployment");
  });
});
```

Run it: FAIL (module missing).

- [ ] **Step 3: Implement** `apps/agent/src/actions/coolify.ts`:

```ts
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Action, Entity } from "@hetops-control/contracts";
import type { CoolifyReader } from "../sources/coolify.js";
import { json } from "../sources/http.js";

/** The deploy-only token (Coolify Keys & Tokens, ability "deploy"): it can queue a deploy and cannot read anything. */
export interface CoolifyDeployer { deploy(uuid: string): Promise<any> }
export const realCoolifyDeployer = (base: string, tokenFile: string): CoolifyDeployer => ({
  deploy: uuid => json(`${base}/api/v1/deploy?uuid=${encodeURIComponent(uuid)}&force=false`,
    { method: "POST", headers: { accept: "application/json", authorization: `Bearer ${readFileSync(tokenFile, "utf8").trim()}` } }),
});

const Params = z.object({}).strict();
const uuidOf = (e: Entity) => { const u = e.id.slice(e.id.lastIndexOf("/") + 1); if (!/^[a-z0-9]{8,64}$/.test(u)) throw new Error("not a Coolify application id"); return u; };
const ACTIVE = new Set(["queued", "in_progress"]);

export function coolifyRedeploy(reader: CoolifyReader, deployer: CoolifyDeployer): Action<z.infer<typeof Params>> {
  const active = async (uuid: string) => { const [d] = (await reader.deployments(uuid, 1)) ?? []; return d && ACTIVE.has(String(d.status)) ? d : undefined; };
  return {
    id: "coolify.redeploy", label: "Redeploy", targets: ["app"], risk: "safe",
    description: "Asks Coolify to build and deploy the application again from its branch, as its Redeploy button does (the build cache is kept).",
    params: Params, applies: e => e.source === "coolify",
    async preview(t) {
      const busy = await active(uuidOf(t)), f = t.facts;
      const from = f.repository?.value ? `${f.repository.value}${f.branch?.value ? ` (${f.branch.value})` : ""}` : "its source";
      return `Builds ${t.name} from ${from} and replaces the running container when the build finishes, about ${f.lastDeployDuration?.value ?? "?"} s like the last deploy.`
        + (f.undeployedCommit?.value ? ` That includes ${String(f.undeployedCommit.value).slice(0, 7)}, which is waiting.` : "")
        + (busy ? ` A deploy is already ${busy.status === "queued" ? "queued" : "running"}, so this returns it instead of starting another.` : "");
    },
    async run(t) {
      const uuid = uuidOf(t), busy = await active(uuid);
      if (busy) return { ok: true, already: true, ref: String(busy.deployment_uuid), summary: `a deploy of ${t.name} is already ${busy.status === "queued" ? "queued" : "running"}` };
      const r = await deployer.deploy(uuid), d = r?.deployments?.[0];
      if (typeof d?.deployment_uuid !== "string") throw new Error(`Coolify did not queue a deployment: ${String(d?.message ?? r?.message ?? "no answer").slice(0, 160)}`);
      return { ok: true, ref: d.deployment_uuid, summary: `deploy of ${t.name} queued; the Apps page shows it when it finishes` };
    },
  };
}
```

Register:

```ts
import { realCoolify } from "../sources/coolify.js"; import { coolifyRedeploy, realCoolifyDeployer } from "./coolify.js";
  "coolify.redeploy": env => {
    const base = origin(need(env, "COOLIFY_URL", "coolify.redeploy"));
    return coolifyRedeploy(realCoolify(base, env.COOLIFY_TOKEN_FILE ?? "/secrets/coolify/token"), realCoolifyDeployer(base, need(env, "COOLIFY_DEPLOY_TOKEN_FILE", "coolify.redeploy")));
  },
```

Add to `actions.test.ts`: `it("every known verb builds with its settings and publishes a valid descriptor", () => { const env = { ACTIONS: "snapshot.now,argo.sync,argo.refresh,alert.silence,coolify.redeploy", ES_URL: "https://es:9200", ES_OPERATOR_DIR: "/x", ALERTMANAGER_URL: "http://am:9093", COOLIFY_URL: "http://10.0.0.11:8000", COOLIFY_DEPLOY_TOKEN_FILE: "/x" }; expect(buildActions(env).map(describeAction).map(d => d.id)).toEqual(env.ACTIONS.split(",")); });`

- [ ] **Step 4: Run the whole suite.** Run: `pnpm vitest run && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit, push, PR (Tasks 3–6 may share this one PR if you work them in sequence; each is its own commit).**

```bash
git add apps/agent
git commit -S -m "feat(agent): coolify.redeploy with a deploy-only token"
```

---

### Task 7: Center audit tables (actions and acks)

**Files:**
- Modify: `apps/center/src/events-db.ts`, `apps/center/test/events-db.test.ts`

**Interfaces:**
- Consumes: `ActionRun`, `ActionRunSchema`, `Ack`, `AckSchema` (Task 1).
- Produces these `EventsDb` methods: `addRun(r: ActionRun): boolean` (false when the id exists), `finishRun(r: ActionRun): void` (only a `running` row changes), `run(id: string): ActionRun | undefined`, `abandonRunning(at: string): number`, `addAck(a: Ack): void` and `acks(nowIso: string): Ack[]` (unexpired only, oldest first). `prune()` still touches only `events`: the audit is durable.

- [ ] **Step 1: Write the failing tests** (append to `events-db.test.ts`):

```ts
import type { ActionRun } from "@hetops-control/contracts";
const run: ActionRun = { id: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", action: "argo.sync", label: "Sync", server: "lab", target: "lab/argo-app/clinic", targetName: "clinic",
  actor: "het@hetops.dev", params: { hard: false }, state: "running", at: "2026-10-31T10:00:00.000Z" };
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), "center-")); return { dir, path: join(dir, "events.db") }; };

describe("audit", () => {
  it("records a run once per id, finishes it once, and keeps it across a reopen and a prune", () => {
    const { dir, path } = tmp(); let db = new EventsDb(path);
    try {
      expect(db.addRun(run)).toBe(true); expect(db.addRun({ ...run, actor: "x@y.z" })).toBe(false);
      db.finishRun({ ...run, state: "succeeded", finishedAt: "2026-10-31T10:00:02.000Z", result: { ok: true, summary: "sync of clinic started" } });
      db.finishRun({ ...run, state: "failed", error: "late" });   // only a running row changes
      db.prune(0); db.close(); db = new EventsDb(path);
      expect(db.run(run.id)).toEqual({ ...run, state: "succeeded", finishedAt: "2026-10-31T10:00:02.000Z", result: { ok: true, summary: "sync of clinic started" } });
      expect(db.run("00000000-0000-4000-8000-000000000000")).toBeUndefined();
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it("closes runs the center restarted on as failed, result unknown", () => {
    const { dir, path } = tmp(); const db = new EventsDb(path);
    try {
      db.addRun(run); expect(db.abandonRunning("2026-10-31T10:05:00.000Z")).toBe(1);
      expect(db.run(run.id)).toMatchObject({ state: "failed", finishedAt: "2026-10-31T10:05:00.000Z", error: "the center restarted before the agent answered; the result is unknown" });
      expect(db.abandonRunning("2026-10-31T10:06:00.000Z")).toBe(0);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it("keeps acks and returns only the unexpired", () => {
    const { dir, path } = tmp(); const db = new EventsDb(path);
    try {
      const ack = { entity: "ops/site/blog", server: "ops" as const, status: "down" as const, actor: "het@hetops.dev", at: "2026-10-31T10:00:00.000Z", until: "2026-10-31T14:00:00.000Z" };
      db.addAck(ack); db.addAck({ ...ack, entity: "ops/check/x", until: "2026-10-31T11:00:00.000Z", note: "known" });
      expect(db.acks("2026-10-31T10:30:00.000Z").map(a => a.entity)).toEqual(["ops/site/blog", "ops/check/x"]);
      expect(db.acks("2026-10-31T12:00:00.000Z")).toEqual([ack]);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
```

Run `pnpm vitest run apps/center/test/events-db.test.ts`. Expected: FAIL (`addRun` is not a function).

- [ ] **Step 2: Implement** in `events-db.ts`. Import `AckSchema, ActionRunSchema, type Ack, type ActionRun` and add after the events table:

```ts
const RUN_COLS = ["id", "at", "actor", "server", "action", "label", "target", "targetName", "params", "state", "finishedAt", "result", "error"] as const;
const ACK_COLS = ["entity", "server", "status", "actor", "at", "until", "note"] as const;
const noNulls = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null));
```

In the constructor:

```ts
    // the audit: one row per action request (the Idempotency-Key is its id), and the center-side acknowledgements; never pruned
    this.db.exec(`CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, server TEXT NOT NULL, action TEXT NOT NULL,
        label TEXT NOT NULL, target TEXT NOT NULL, targetName TEXT NOT NULL, params TEXT NOT NULL, state TEXT NOT NULL, finishedAt TEXT, result TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS acks(entity TEXT NOT NULL, server TEXT NOT NULL, status TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, until TEXT NOT NULL, note TEXT);
      CREATE INDEX IF NOT EXISTS acks_until ON acks(until);`);
    this.insRun = this.db.prepare(`INSERT OR IGNORE INTO actions(${RUN_COLS.join(",")}) VALUES (${RUN_COLS.map(c => "@" + c).join(",")})`);
    this.endRun = this.db.prepare("UPDATE actions SET state=@state, finishedAt=@finishedAt, result=@result, error=@error WHERE id=@id AND state='running'");
    this.getRun = this.db.prepare(`SELECT ${RUN_COLS.join(",")} FROM actions WHERE id = ?`);
    this.abandon = this.db.prepare("UPDATE actions SET state='failed', finishedAt=?, error='the center restarted before the agent answered; the result is unknown' WHERE state='running'");
    this.insAck = this.db.prepare(`INSERT INTO acks(${ACK_COLS.join(",")}) VALUES (${ACK_COLS.map(c => "@" + c).join(",")})`);
    this.getAcks = this.db.prepare(`SELECT ${ACK_COLS.join(",")} FROM acks WHERE until > ? ORDER BY at, rowid`);
```

(declare the six `private …: Database.Statement;` fields), and the methods:

```ts
  addRun(r: ActionRun): boolean {
    const v = ActionRunSchema.parse(r);
    return this.insRun.run({ ...v, params: JSON.stringify(v.params), finishedAt: v.finishedAt ?? null, result: v.result ? JSON.stringify(v.result) : null, error: v.error ?? null }).changes === 1;
  }
  finishRun(r: ActionRun): void {
    const v = ActionRunSchema.parse(r);
    this.endRun.run({ id: v.id, state: v.state, finishedAt: v.finishedAt ?? null, result: v.result ? JSON.stringify(v.result) : null, error: v.error ?? null });
  }
  run(id: string): ActionRun | undefined {
    const row = this.getRun.get(id) as Record<string, string | null> | undefined;
    if (!row) return undefined;
    return ActionRunSchema.parse(noNulls({ ...row, params: JSON.parse(row.params!), result: row.result ? JSON.parse(row.result) : null }));
  }
  /** At start: a run still "running" lost its answer with the old process. */
  abandonRunning(at: string): number { return this.abandon.run(at).changes; }
  addAck(a: Ack): void { const v = AckSchema.parse(a); this.insAck.run({ ...v, note: v.note ?? null }); }
  acks(nowIso: string): Ack[] { return (this.getAcks.all(nowIso) as Record<string, string | null>[]).map(r => AckSchema.parse(noNulls(r))); }
```

- [ ] **Step 3: Run the tests.** Run: `pnpm vitest run apps/center && pnpm typecheck`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git switch -c feat/center-actions origin/main   # after Tasks 1-6 merged
git add apps/center
git commit -S -m "feat(center): durable audit of action runs and acks"
```

---

### Task 8: Center actions service and `gatus.ack`

**Files:**
- Create: `apps/center/src/actions.ts`, `apps/center/src/ack.ts`, `apps/center/test/actions.test.ts`
- Modify: `apps/center/src/store.ts` (descriptors in the snapshot, `announce`), `apps/center/src/agents.ts` (`post`), `apps/center/src/headline.ts` (skip acked)

**Interfaces:**
- Consumes: `EventsDb` (Task 7), `Store`, `headline`, `checkParams`, `ActionCallSchema`, `ActionPreviewSchema`, `ActionResultSchema` (Task 1).
- Produces:
  - `class ActionError extends Error { code: number; retryAfter?: number }`
  - `type AgentCall = (server, path, body, signal) => Promise<{status: number; body: unknown}>`
  - `type LocalAction = { descriptor: ActionDescriptor; applies(e: Entity): boolean; preview(t: Entity, p: Params, now: Date): string; run(t: Entity, p: Params, ctx: {actor: string; now: Date}): ActionResult }`
  - `decorate(s: CenterState, acks: Ack[], local: LocalAction[], now: number): CenterState`
  - `centerState(store: Store, db: Pick<EventsDb, "acks">, local: LocalAction[], now?: number): CenterState & { headline: Headline }`
  - `class Actions` with `preview(raw: unknown, actor: string): Promise<{text: string}>` and `start(raw: unknown, actor: string, key: string | undefined): { run: ActionRun; replay: boolean }`
  - `gatusAck(db: Pick<EventsDb, "addAck">): LocalAction`
  - `Store.announce(run: ActionRun)`
  - `AgentLink.post(path, body, signal)`

- [ ] **Step 1: Write the failing test** `apps/center/test/actions.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import type { ActionDescriptor, ActionRun, AgentState, Entity, Event, ServerId } from "@hetops-control/contracts";
import { Store } from "../src/store.js"; import { EventsDb } from "../src/events-db.js";
import { Actions, ActionError, centerState, type AgentCall } from "../src/actions.js"; import { gatusAck } from "../src/ack.js";

const OWNER = "het@hetops.dev";
const empty = { type: "object" as const, properties: {}, additionalProperties: false as const };
const D = (id: string, risk: "safe" | "disruptive" = "safe", params: ActionDescriptor["params"] = empty): ActionDescriptor =>
  ({ id, label: id.split(".")[1]!, description: "d", targets: ["argo-app", "alert"], risk, preview: true, params });
const silence = D("alert.silence", "safe", { type: "object", additionalProperties: false, properties: { hours: { type: "string", enum: ["1", "4"], default: "4" } } });
const cleanups: (() => void)[] = []; afterEach(() => { cleanups.splice(0).forEach(f => f()); });

function setup(o: { call?: AgentCall; timeoutMs?: number; actors?: string[]; limits?: ConstructorParameters<typeof Actions>[0]["limits"] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "center-act-")); const db = new EventsDb(join(dir, "e.db"));
  const now = new Date(); const at = now.toISOString();
  const store = new Store(() => now, ["lab", "ops"]);
  const ent = (id: string, kind: Entity["kind"], name: string, refs: string[], source: string, status: Entity["status"] = "ok"): Entity => ({ id, kind, server: id.split("/")[0] as ServerId,
    name, status, facts: {}, links: [], observedAt: at, source, actions: refs.map(r => ({ id: r, label: r.split(".")[1]!, risk: r === "test.wipe" ? "disruptive" : "safe" })) });
  const state = (server: ServerId, entities: Entity[], actions: ActionDescriptor[]): AgentState => ({ server, version: "t", generatedAt: at, entities, actions,
    sources: [...new Set(entities.map(e => e.source!))].map(id => ({ id, periodMs: 30_000, ok: true, lastRunAt: at })) });
  store.apply("lab", state("lab", [ent("lab/argo-app/clinic", "argo-app", "clinic", ["argo.sync", "test.wipe"], "argo"),
    ent("lab/argo-app/web", "argo-app", "web", ["argo.sync"], "argo"), ent("lab/alert/abc", "alert", "KubeQuota", ["alert.silence"], "alertmanager")],
    [D("argo.sync"), D("test.wipe", "disruptive"), silence]));
  store.apply("ops", state("ops", [ent("ops/site/blog", "site", "blog", [], "gatus", "down")], []));
  const calls: { server: string; path: string; body: any }[] = [];
  const call: AgentCall = o.call ?? (async (server, path, body) => { calls.push({ server, path, body });
    return path.endsWith("/preview") ? { status: 200, body: { text: "will sync clinic" } } : { status: 200, body: { ok: true, summary: "sync of clinic started" } }; });
  const published: { run?: ActionRun; event?: Event }[] = [];
  const local = [gatusAck(db)];
  const actions = new Actions({ state: () => centerState(store, db, local, now.getTime()), db, local, call, actors: o.actors ?? [OWNER],
    publish: m => published.push(m), now: () => now, ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}), ...(o.limits ? { limits: o.limits } : {}) });
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { actions, db, calls, published, store, local, now };
}
const key = () => crypto.randomUUID();
const settle = () => new Promise(r => setTimeout(r, 10));
const code = (f: () => unknown) => { try { f(); } catch (e) { return e instanceof ActionError ? e.code : -1; } return 0; };
const sync = { action: "argo.sync", target: "lab/argo-app/clinic", params: {} };

describe("center actions", () => {
  it("only the identities in ACTORS may act, and nobody when it is empty", () => {
    expect(code(() => setup({ actors: ["someone@else.dev"] }).actions.start(sync, OWNER, key()))).toBe(403);
    expect(code(() => setup({ actors: [] }).actions.start(sync, OWNER, key()))).toBe(403);
  });
  it("runs an offered action: one agent call with actor and key, an audit row, two action events, streamed runs", async () => {
    const { actions, calls, db, published } = setup(); const k = key();
    const { run, replay } = actions.start(sync, OWNER, k);
    expect(replay).toBe(false); expect(run).toMatchObject({ id: k, state: "running", actor: OWNER, targetName: "clinic", server: "lab" });
    await settle();
    expect(calls).toEqual([{ server: "lab", path: "/v1/actions/argo.sync", body: { target: "lab/argo-app/clinic", params: {}, actor: OWNER, requestId: k } }]);
    expect(db.run(k)).toMatchObject({ state: "succeeded", result: { ok: true, summary: "sync of clinic started" } });
    const evs = published.flatMap(p => (p.event ? [p.event] : []));
    expect(evs.map(e => [e.kind, e.actor, e.entity, e.source])).toEqual([["action", OWNER, "lab/argo-app/clinic", "control"], ["action", OWNER, "lab/argo-app/clinic", "control"]]);
    expect(evs[0]!.summary).toBe(`${OWNER} asked: sync clinic (lab)`); expect(evs[1]!.summary).toBe("sync clinic (lab): sync of clinic started");
    expect(published.flatMap(p => (p.run ? [p.run.state] : []))).toEqual(["running", "succeeded"]);
    expect(db.recent(5).filter(e => e.kind === "action")).toHaveLength(2);
  });
  it("checks target, offer, params and reachability before asking anyone", async () => {
    const { actions, calls } = setup();
    expect(code(() => actions.start({ ...sync, target: "lab/argo-app/nope" }, OWNER, key()))).toBe(404);
    expect(code(() => actions.start({ ...sync, action: "alert.silence" }, OWNER, key()))).toBe(422);        // not offered on clinic
    expect(code(() => actions.start({ action: "alert.silence", target: "lab/alert/abc", params: { hours: "9" } }, OWNER, key()))).toBe(422);
    expect(code(() => actions.start({ ...sync, extra: 1 }, OWNER, key()))).toBe(400);
    expect(code(() => actions.start(sync, OWNER, "not-a-uuid"))).toBe(400);
    expect(code(() => actions.start(sync, OWNER, undefined))).toBe(400);
    await settle(); expect(calls).toEqual([]);
  });
  it("refuses to act on a server it cannot see", () => {
    const { actions, store } = setup(); store.markUnreachable("lab", new Date());
    expect(code(() => actions.start(sync, OWNER, key()))).toBe(409);
  });
  it("replays a repeated Idempotency-Key without acting again, and refuses it for another request", async () => {
    const { actions, calls } = setup(); const k = key();
    actions.start(sync, OWNER, k); await settle();
    expect(actions.start(sync, OWNER, k)).toMatchObject({ replay: true, run: { id: k, state: "succeeded" } });
    expect(code(() => actions.start({ ...sync, target: "lab/argo-app/web" }, OWNER, k))).toBe(409);
    expect(calls).toHaveLength(1);
  });
  it("a disruptive action needs the target's name typed", async () => {
    const { actions } = setup(); const wipe = { action: "test.wipe", target: "lab/argo-app/clinic", params: {} };
    expect(code(() => actions.start(wipe, OWNER, key()))).toBe(422);
    expect(code(() => actions.start({ ...wipe, confirm: "Clinic" }, OWNER, key()))).toBe(422);
    expect(actions.start({ ...wipe, confirm: "clinic" }, OWNER, key()).run.state).toBe("running");
  });
  it("one run in flight per target; rate limits per action and target, and per action", async () => {
    let release!: () => void; const gate = new Promise<void>(r => (release = r));
    const slow: AgentCall = async () => { await gate; return { status: 200, body: { ok: true, summary: "ok" } }; };
    const { actions } = setup({ call: slow, limits: { target: { max: 2, ms: 600_000 }, action: { max: 3, ms: 600_000 }, preview: { max: 60, ms: 60_000 } } });
    actions.start(sync, OWNER, key());
    expect(code(() => actions.start(sync, OWNER, key()))).toBe(409);                  // clinic is busy
    release(); await settle();
    actions.start(sync, OWNER, key()); await settle();                                  // 2nd on clinic
    let err: unknown; try { actions.start(sync, OWNER, key()); } catch (e) { err = e; }  // 3rd on clinic: limited
    expect(err).toMatchObject({ code: 429 }); expect((err as ActionError).retryAfter).toBeGreaterThan(0);
    actions.start({ ...sync, target: "lab/argo-app/web" }, OWNER, key()); await settle();   // 3rd sync overall
    expect(code(() => actions.start({ action: "argo.sync", target: "lab/argo-app/web", params: {} }, OWNER, key()))).toBe(429);   // per-action cap
  });
  it("gives the agent timeoutMs, then fails the run as unknown", async () => {
    const { actions, db } = setup({ call: (_s, _p, _b, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(signal.reason))), timeoutMs: 30 });
    const k = key(); actions.start(sync, OWNER, k); await new Promise(r => setTimeout(r, 80));
    expect(db.run(k)).toMatchObject({ state: "failed", error: "no answer in 0.03 s; the result is unknown, check clinic" });
  });
  it("an agent refusal is a failed run carrying the agent's message", async () => {
    const { actions, db } = setup({ call: async () => ({ status: 409, body: { error: "an action on clinic is still running" } }) });
    const k = key(); actions.start(sync, OWNER, k); await settle();
    expect(db.run(k)).toMatchObject({ state: "failed", error: "an action on clinic is still running" });
  });
  it("previews through the agent, rate limited", async () => {
    const { actions, calls } = setup({ limits: { target: { max: 3, ms: 1 }, action: { max: 12, ms: 1 }, preview: { max: 1, ms: 60_000 } } });
    expect(await actions.preview(sync, OWNER)).toEqual({ text: "will sync clinic" });
    expect(calls[0]!.path).toBe("/v1/actions/argo.sync/preview");
    await expect(actions.preview(sync, OWNER)).rejects.toMatchObject({ code: 429 });
  });
});

describe("gatus.ack (center-side)", () => {
  it("is offered on a failing Gatus check, takes it off Needs you, and lapses when its status changes", async () => {
    const { actions, store, db, local, now } = setup();
    const s0 = centerState(store, db, local, now.getTime());
    expect(s0.entities.find(e => e.id === "ops/site/blog")!.actions.map(a => a.id)).toEqual(["gatus.ack"]);
    expect(s0.headline.needs.some(n => n.entity === "ops/site/blog")).toBe(true);
    expect(await actions.preview({ action: "gatus.ack", target: "ops/site/blog", params: { hours: 2 } }, OWNER)).toMatchObject({ text: expect.stringContaining("Gatus keeps checking") });
    actions.start({ action: "gatus.ack", target: "ops/site/blog", params: { hours: 2, note: "DNS move" } }, OWNER, key()); await settle();
    const s1 = centerState(store, db, local, now.getTime());
    expect(s1.acks).toMatchObject([{ entity: "ops/site/blog", status: "down", actor: OWNER, note: "DNS move" }]);
    expect(s1.headline.needs.some(n => n.entity === "ops/site/blog")).toBe(false);
    expect(s1.entities.find(e => e.id === "ops/site/blog")!.actions).toEqual([]);   // nothing to press twice
    const at = now.toISOString();
    store.apply("ops", { server: "ops", version: "t", generatedAt: at, sources: [{ id: "gatus", periodMs: 30_000, ok: true, lastRunAt: at }],
      entities: [{ id: "ops/site/blog", kind: "site", server: "ops", name: "blog", status: "attention", facts: {}, links: [], actions: [], observedAt: at, source: "gatus" }] });
    const s2 = centerState(store, db, local, now.getTime());
    expect(s2.acks).toEqual([]); expect(s2.headline.needs.some(n => n.entity === "ops/site/blog")).toBe(true);
  });
});
```

Run `pnpm vitest run apps/center/test/actions.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 2: Store and AgentLink.** In `store.ts`, import `type ActionRun`. In `snapshot()`, collect each reachable agent's descriptors, and add `actions` to the returned object:

```ts
    const actions = [...this.links].flatMap(([server, link]) => (link.reachable ? link.state?.actions ?? [] : []).map(a => ({ ...a, server })));
    return { generatedAt: new Date(now).toISOString(), servers, entities: entities.map(a => a.entity), series, actions };
```

and add:

```ts
  /** An action run moved (started, finished): straight to the stream, never debounced. */
  announce(run: ActionRun): void { this.emit({ type: "action", run }); }
```

In `agents.ts`, add to `AgentLink`:

```ts
  /** One action call on this agent's link (same token, same CA); the caller owns the timeout through `signal`. */
  async post(path: string, body: unknown, signal: AbortSignal): Promise<{ status: number; body: unknown }> {
    const res = await fetch(this.url + path, { method: "POST", signal, dispatcher: this.dispatcher,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: safeJson(await res.text()) };
  }
```

`this.dispatcher` is created in `start()`, so `post` must only be called on a started link; `main.ts` starts every link before it listens.

In `headline.ts`, at the top of `headline()`: `const acked = new Set((s.acks ?? []).map(a => a.entity));`. In the entity loop, add `if (acked.has(e.id)) continue;` after the status check.

- [ ] **Step 3: `apps/center/src/ack.ts`:**

```ts
import type { Entity, ParamsJson } from "@hetops-control/contracts";
import type { EventsDb } from "./events-db.js";
import type { LocalAction } from "./actions.js";

// Gatus 5.37 has no acknowledge or mute API (its only write is external-endpoint results, which would fake a check), so the
// acknowledgement is the center's own record: the check leaves Needs you until `until` or until its status changes.
const HOUR = 3_600_000;
const PARAMS: ParamsJson = { type: "object", additionalProperties: false, properties: {
  hours: { type: "integer", minimum: 1, maximum: 24, default: 4, description: "For how long, in hours" },
  note: { type: "string", maxLength: 200, description: "Why (shown beside it)" } } };
const hhmm = (d: Date) => `${d.toISOString().slice(11, 16)} UTC`;
const failing = (e: Entity) => e.status === "attention" || e.status === "down";

export function gatusAck(db: Pick<EventsDb, "addAck">): LocalAction {
  return {
    descriptor: { id: "gatus.ack", label: "Acknowledge", targets: ["site", "check"], risk: "safe", preview: true, params: PARAMS,
      description: "Takes a failing Gatus check off Needs you for a while. Gatus keeps checking and alerting; only this center stops asking." },
    applies: e => e.source === "gatus" && failing(e),
    preview: (t, p, now) => `Takes ${t.name} off Needs you for ${p.hours} h (until ${hhmm(new Date(now.getTime() + Number(p.hours) * HOUR))}) `
      + `or until it stops being ${t.status}, whichever comes first. Gatus keeps checking it and still sends its own alerts; nothing on ${t.server} changes.`,
    run: (t, p, { actor, now }) => {
      const until = new Date(now.getTime() + Number(p.hours) * HOUR);
      db.addAck({ entity: t.id, server: t.server, status: t.status, actor, at: now.toISOString(), until: until.toISOString(),
        ...(typeof p.note === "string" && p.note.trim() ? { note: p.note.trim() } : {}) });
      return { ok: true, summary: `${t.name} acknowledged until ${hhmm(until)}` };
    },
  };
}
```

- [ ] **Step 4: `apps/center/src/actions.ts`:**

```ts
import { ActionCallSchema, ActionPreviewSchema, ActionResultSchema, checkParams, ServerIdSchema,
  type Ack, type ActionDescriptor, type ActionResult, type ActionRun, type CenterState, type Entity, type Event, type Params, type ServerId } from "@hetops-control/contracts";
import type { EventsDb } from "./events-db.js";
import type { Store } from "./store.js";
import { headline, type Headline } from "./headline.js";

export class ActionError extends Error { constructor(public code: number, message: string, public retryAfter?: number) { super(message); } }
export type AgentCall = (server: ServerId, path: string, body: unknown, signal: AbortSignal) => Promise<{ status: number; body: unknown }>;
/** An action the center runs itself (only gatus.ack): it changes the center's own records, never a server. */
export type LocalAction = { descriptor: ActionDescriptor; applies(e: Entity): boolean;
  preview(t: Entity, p: Params, now: Date): string; run(t: Entity, p: Params, ctx: { actor: string; now: Date }): ActionResult };

export const TIMEOUT_MS = 60_000;
export const LIMITS = { target: { max: 3, ms: 600_000 }, action: { max: 12, ms: 600_000 }, preview: { max: 60, ms: 60_000 } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Adds the center's own offers and the live acks to a snapshot; an ack lapses at `until` or when its entity's status moves. */
export function decorate(s: CenterState, acks: Ack[], local: LocalAction[], now: number): CenterState {
  const live = acks.filter(a => Date.parse(a.until) > now && s.entities.some(e => e.id === a.entity && e.status === a.status));
  const acked = new Set(live.map(a => a.entity));
  const entities = s.entities.map(e => {
    const refs = acked.has(e.id) ? [] : local.filter(l => l.descriptor.targets.includes(e.kind) && l.applies(e))
      .map(l => ({ id: l.descriptor.id, label: l.descriptor.label, risk: l.descriptor.risk }));
    return refs.length ? { ...e, actions: [...e.actions, ...refs] } : e;
  });
  const mine = ServerIdSchema.options.flatMap(server => local.map(l => ({ ...l.descriptor, server })));
  return { ...s, entities, acks: live, actions: [...(s.actions ?? []), ...mine] };
}
export const centerState = (store: Store, db: Pick<EventsDb, "acks">, local: LocalAction[], now = Date.now()): CenterState & { headline: Headline } => {
  const s = decorate(store.snapshot(), db.acks(new Date(now).toISOString()), local, now);
  return { ...s, headline: headline(s) };
};

/** Sliding windows in memory: a restart forgets them, which only ever loosens a limit for one window. */
class Windows {
  private hits = new Map<string, number[]>();
  wait(key: string, max: number, ms: number, now: number): number {
    const h = (this.hits.get(key) ?? []).filter(t => now - t < ms); this.hits.set(key, h);
    return h.length < max ? 0 : Math.max(1, Math.ceil((h[0]! + ms - now) / 1000));
  }
  hit(key: string, now: number) { this.hits.get(key)!.push(now); }
}
const errorOf = (r: { status: number; body: unknown }) => {
  const e = (r.body as { error?: unknown } | undefined)?.error;
  return typeof e === "string" ? e.slice(0, 300) : `the agent answered HTTP ${r.status}`;
};
const said = (p: Params) => { const kv = Object.entries(p).filter(([, v]) => v !== "").map(([k, v]) => `${k} ${typeof v === "string" ? JSON.stringify(v) : v}`); return kv.length ? ` with ${kv.join(", ")}`.slice(0, 120) : ""; };

type Deps = { state: () => CenterState; db: Pick<EventsDb, "add" | "addRun" | "finishRun" | "run">; call: AgentCall; local: LocalAction[];
  publish: (m: { run?: ActionRun; event?: Event }) => void; actors: string[]; now?: () => Date; timeoutMs?: number; limits?: typeof LIMITS };

export class Actions {
  private inflight = new Set<string>(); private windows = new Windows();
  private now: () => Date; private timeoutMs: number; private limits: typeof LIMITS; private actors: Set<string>;
  constructor(private o: Deps) {
    this.now = o.now ?? (() => new Date()); this.timeoutMs = o.timeoutMs ?? TIMEOUT_MS; this.limits = o.limits ?? LIMITS;
    this.actors = new Set(o.actors.map(a => a.trim().toLowerCase()).filter(Boolean));
  }

  /** Everything checked before any agent is asked: identity, body, target, reachability, the offer, the params. */
  private resolve(raw: unknown, actor: string) {
    if (!this.actors.has(actor.toLowerCase())) throw new ActionError(403, "this identity may not act");
    const c = ActionCallSchema.safeParse(raw);
    if (!c.success) throw new ActionError(400, "bad request");
    const s = this.o.state();
    const target = s.entities.find(e => e.id === c.data.target);
    if (!target) throw new ActionError(404, "no such target");
    if (!s.servers[target.server].reachable) throw new ActionError(409, `${target.server} is not reachable; nothing was asked`);
    const ref = target.actions.find(r => r.id === c.data.action);
    if (!ref) throw new ActionError(422, `${c.data.action} is not offered for ${target.name}`);
    const local = this.o.local.find(l => l.descriptor.id === ref.id);
    const d = local?.descriptor ?? s.actions?.find(a => a.server === target.server && a.id === ref.id);
    if (!d) throw new ActionError(422, `${target.server}'s agent does not describe ${ref.id}`);
    const p = checkParams(d.params, c.data.params);
    if (!p.ok) throw new ActionError(422, p.error);
    return { call: c.data, target, d, params: p.params, local };
  }

  async preview(raw: unknown, actor: string): Promise<{ text: string }> {
    const r = this.resolve(raw, actor), now = this.now().getTime(), L = this.limits.preview;
    const retry = this.windows.wait("preview", L.max, L.ms, now);
    if (retry) throw new ActionError(429, `too many previews; try again in ${retry} s`, retry);
    this.windows.hit("preview", now);
    if (r.local) return { text: r.local.preview(r.target, r.params, this.now()) };
    const res = await this.o.call(r.target.server, `/v1/actions/${encodeURIComponent(r.d.id)}/preview`,
      { target: r.target.id, params: r.params, actor, requestId: crypto.randomUUID() }, AbortSignal.timeout(this.timeoutMs));
    const body = ActionPreviewSchema.safeParse(res.body);
    if (res.status !== 200 || !body.success) throw new ActionError(502, errorOf(res));
    return body.data;
  }

  /** Validates, audits and starts; the result follows on the stream. A repeated key returns the recorded run. */
  start(raw: unknown, actor: string, key: string | undefined): { run: ActionRun; replay: boolean } {
    if (!key || !UUID.test(key)) throw new ActionError(400, "an Idempotency-Key (a UUID) is required");
    const earlier = this.o.db.run(key.toLowerCase());
    const r = this.resolve(raw, actor);
    if (earlier) {
      if (earlier.actor !== actor || earlier.action !== r.d.id || earlier.target !== r.target.id) throw new ActionError(409, "that Idempotency-Key belongs to another request");
      return { run: earlier, replay: true };
    }
    if (r.d.risk === "disruptive" && r.call.confirm !== r.target.name) throw new ActionError(422, `type ${r.target.name} to confirm`);
    if (this.inflight.has(r.target.id)) throw new ActionError(409, `an action on ${r.target.name} is still running`);
    const now = this.now().getTime(), kT = `${r.d.id}|${r.target.id}`, kA = r.d.id;
    const retry = Math.max(this.windows.wait(kT, this.limits.target.max, this.limits.target.ms, now), this.windows.wait(kA, this.limits.action.max, this.limits.action.ms, now));
    if (retry) throw new ActionError(429, `rate limited; try again in ${retry} s`, retry);
    this.windows.hit(kT, now); this.windows.hit(kA, now);
    const run: ActionRun = { id: key.toLowerCase(), action: r.d.id, label: r.d.label, server: r.target.server, target: r.target.id, targetName: r.target.name,
      actor, params: r.params, state: "running", at: new Date(now).toISOString() };
    if (!this.o.db.addRun(run)) return { run: this.o.db.run(run.id)!, replay: true };   // the same key raced in
    this.say(run, `${actor} asked: ${run.label.toLowerCase()} ${run.targetName} (${run.server})${said(run.params)}`);
    this.inflight.add(run.target);
    void this.execute(run, r.local).finally(() => this.inflight.delete(run.target));
    return { run, replay: false };
  }

  private async execute(run: ActionRun, local: LocalAction | undefined) {
    let result: ActionResult | undefined, error: string | undefined;
    try {
      if (local) {
        const target = this.o.state().entities.find(e => e.id === run.target);
        if (!target) throw new Error(`${run.targetName} is gone`);
        result = local.run(target, run.params, { actor: run.actor, now: this.now() });
      } else {
        const res = await this.o.call(run.server, `/v1/actions/${encodeURIComponent(run.action)}`,
          { target: run.target, params: run.params, actor: run.actor, requestId: run.id }, AbortSignal.timeout(this.timeoutMs));
        const body = ActionResultSchema.safeParse(res.body);
        if (res.status === 200 && body.success) result = body.data; else error = errorOf(res);
      }
    } catch (e) {
      error = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
        ? `no answer in ${this.timeoutMs / 1000} s; the result is unknown, check ${run.targetName}` : (e instanceof Error ? e.message : String(e)).slice(0, 300);
    }
    const ok = !!result?.ok;
    const done: ActionRun = { ...run, state: ok ? "succeeded" : "failed", finishedAt: this.now().toISOString(),
      ...(result ? { result } : {}), ...(error ? { error } : !ok && result ? { error: result.summary } : {}) };
    try { this.o.db.finishRun(done); } catch (e) { console.error(`audit: ${e instanceof Error ? e.message : String(e)}`); }
    this.say(done, `${run.label.toLowerCase()} ${run.targetName} (${run.server}): ${result?.summary ?? error}`, ok ? undefined : "attention");
  }

  private say(run: ActionRun, summary: string, level?: "attention") {
    const event: Event = { at: this.now().toISOString(), server: run.server, source: "control", kind: "action", actor: run.actor, entity: run.target,
      summary: summary.slice(0, 300), ...(level ? { level } : {}) };
    try { this.o.db.add(event); } catch (e) { console.error(`events db: ${e instanceof Error ? e.message : String(e)}`); }
    this.o.publish({ run, event });
  }
}
```

The test expects the request event to read `het@hetops.dev asked: sync clinic (lab)` and the result `sync clinic (lab): sync of clinic started`. The test descriptor's label is `"sync"` (from `D`); with real labels ("Sync") the code lower-cases it.

- [ ] **Step 5: Run the tests.** Run: `pnpm vitest run apps/center && pnpm typecheck`. Expected: PASS, including `headline.test.ts` (no acks means no change) and `store.test.ts`. If a store test compares the whole snapshot, add `actions: []` to its expectation.

- [ ] **Step 6: Commit**

```bash
git add apps/center
git commit -S -m "feat(center): validated, limited, audited actions and gatus.ack"
```

---

### Task 9: Center HTTP: routes, CSRF defence, config and wiring

**Files:**
- Modify: `apps/center/src/server.ts`, `apps/center/src/config.ts`, `apps/center/src/main.ts`, `apps/center/test/server.test.ts`, `apps/center/test/config.test.ts`

**Interfaces:**
- Consumes: `Actions`, `ActionError`, `centerState`, `LocalAction` (Task 8), `gatusAck`.
- Produces:
  - `POST /api/actions/preview` → `200 {text}`
  - `POST /api/actions` → `202 {run}`, or `200 {run}` on a replay
  - errors are `{error}` with 400, 403, 404, 409, 422, 429 (with `Retry-After`) or 502
  - `GET /api/state` and the stream now carry `actions` and `acks`, and the stream forwards `{type:"action"}` immediately
  - `actionsConfig(env): { origin: string; actors: string[] }`
  - `buildCenter({ …, db: Pick<EventsDb, "recent" | "acks">, actions?, origin?, local? })`

- [ ] **Step 1: Write the failing tests.** In `server.test.ts`, change the helper so the db stub has acks: `db: { recent, acks: () => [] } as never`. Make the same change in the `/api/me` test's inline `buildCenter` call. Then append:

```ts
import { ActionError } from "../src/actions.js";
const ORIGIN = "https://control.hetops.dev";
const stubActions = (over: Partial<{ start: unknown; preview: unknown }> = {}) => ({
  start: vi.fn(() => ({ run: { id: "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", state: "running" }, replay: false })),
  preview: vi.fn(async () => ({ text: "will sync" })), ...over }) as never;
const act = (app: { inject: Function }, headers: Record<string, string> = {}, url = "/api/actions") => app.inject({ method: "POST", url,
  payload: { action: "argo.sync", target: "lab/argo-app/clinic", params: {} },
  headers: { origin: ORIGIN, "x-hetops-action": "1", "sec-fetch-site": "same-origin", "idempotency-key": "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10", ...headers } });

describe("center actions http", () => {
  const build = (actions = stubActions()) => { const app = buildCenter({ store: new Store(), db: { recent: () => [], acks: () => [] } as never, access: ok, webRoot: "/nope", logger: false, actions, origin: ORIGIN }); apps.push(app); return { app, actions }; };
  it("starts an action from the page itself and hands over the Access email and the key", async () => {
    const { app, actions } = build(); const r = await act(app);
    expect(r.statusCode).toBe(202); expect(r.json().run.state).toBe("running");
    expect((actions as any).start).toHaveBeenCalledWith({ action: "argo.sync", target: "lab/argo-app/clinic", params: {} }, "t@x.dev", "6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10");
  });
  it("refuses anything that is not the page itself: no or another Origin, no custom header, a cross-site fetch", async () => {
    const { app, actions } = build();
    for (const h of [{ origin: "" }, { origin: "https://evil.hetops.dev" }, { origin: "https://control.hetops.dev.evil.dev" }, { "x-hetops-action": "" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }])
      expect((await act(app, h)).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/actions", payload: "action=argo.sync", headers: { origin: ORIGIN, "x-hetops-action": "1", "content-type": "application/x-www-form-urlencoded" } })).statusCode).toBe(415);
    expect((actions as any).start).not.toHaveBeenCalled();
  });
  it("needs Access before anything", async () => {
    const app = buildCenter({ store: new Store(), db: { recent: () => [], acks: () => [] } as never, access: no, webRoot: "/nope", logger: false, actions: stubActions(), origin: ORIGIN }); apps.push(app);
    expect((await act(app)).statusCode).toBe(403);
  });
  it("maps ActionError to its status, with Retry-After on 429; a replay is 200", async () => {
    const limited = build(stubActions({ start: vi.fn(() => { throw new ActionError(429, "rate limited; try again in 42 s", 42); }) }));
    const r = await act(limited.app); expect(r.statusCode).toBe(429); expect(r.headers["retry-after"]).toBe("42"); expect(r.json()).toEqual({ error: "rate limited; try again in 42 s" });
    const replay = build(stubActions({ start: vi.fn(() => ({ run: { id: "x" }, replay: true })) }));
    expect((await act(replay.app)).statusCode).toBe(200);
  });
  it("previews behind the same checks", async () => {
    const { app } = build();
    expect((await act(app, {}, "/api/actions/preview")).json()).toEqual({ text: "will sync" });
    expect((await act(app, { origin: "https://evil.dev" }, "/api/actions/preview")).statusCode).toBe(403);
  });
  it("without an Actions service, actions are off", async () => {
    const app = buildCenter({ store: new Store(), db: { recent: () => [], acks: () => [] } as never, access: ok, webRoot: "/nope", logger: false }); apps.push(app);
    expect((await act(app)).statusCode).toBe(403);
  });
});
```

In `config.test.ts`:

```ts
import { actionsConfig } from "../src/config.js";
it("actionsConfig: an https origin and lower-cased actors; dev defaults to loopback", () => {
  expect(actionsConfig({ PUBLIC_ORIGIN: "https://control.hetops.dev/", ACTORS: " Het@HetOps.dev , " })).toEqual({ origin: "https://control.hetops.dev", actors: ["het@hetops.dev"] });
  expect(actionsConfig({})).toEqual({ origin: "", actors: [] });                                   // actions off
  expect(() => actionsConfig({ PUBLIC_ORIGIN: "http://control.hetops.dev", ACTORS: "a@b.c" })).toThrow("PUBLIC_ORIGIN must be https");
  expect(actionsConfig({ CONTROL_DEV: "1", HOST: "127.0.0.1", PORT: "8080" }).origin).toBe("http://127.0.0.1:8080");
});
```

Run: `pnpm vitest run apps/center`. Expected: FAIL.

- [ ] **Step 2: Implement.** In `config.ts`:

```ts
/** Who may act and from which page. Empty ACTORS = actions off; PUBLIC_ORIGIN is the only Origin a POST may come from. */
export function actionsConfig(env = process.env): { origin: string; actors: string[] } {
  const actors = (env.ACTORS ?? "").split(",").map(a => a.trim().toLowerCase()).filter(Boolean);
  if (env.CONTROL_DEV === "1") return { origin: (env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${env.PORT ?? 8080}`).replace(/\/+$/, ""), actors: actors.length ? actors : ["dev@local"] };
  if (!env.PUBLIC_ORIGIN) return { origin: "", actors: [] };
  const u = new URL(env.PUBLIC_ORIGIN);
  if (u.protocol !== "https:") throw new Error("PUBLIC_ORIGIN must be https");
  return { origin: u.origin, actors };
}
```

In `server.ts`, extend the options type with `db: Pick<EventsDb, "recent" | "acks">; actions?: Pick<Actions, "start" | "preview">; origin?: string; local?: LocalAction[]`. Replace `const state = …` with `const state = () => centerState(store, db, o.local ?? []);` (imports from `./actions.js`). In the stream listener, change `if (m.type === "event") send(m);` to `if (m.type !== "state") send(m); // events and action runs go out at once`. Add the routes before the SPA handler:

```ts
  // CSRF: the Access cookie is ambient, so a POST must prove it comes from our own page. The Origin must be exactly ours (a sibling
  // *.hetops.dev site is same-site, so SameSite would not stop it); the custom header cannot be sent cross-origin without a
  // preflight, which we never answer; Sec-Fetch-Site, when the browser sends it, must agree. Bodies are JSON only (else 415).
  const fromOurPage = (h: Record<string, string | string[] | undefined>) => !!o.origin && h.origin === o.origin && h["x-hetops-action"] === "1"
    && (h["sec-fetch-site"] === undefined || h["sec-fetch-site"] === "same-origin");
  const failed = (rep: FastifyReply, e: unknown) => {
    if (e instanceof ActionError) { if (e.retryAfter) rep.header("retry-after", String(e.retryAfter)); return rep.code(e.code).send({ error: e.message }); }
    app.log.error({ err: e instanceof Error ? e.message : String(e) }, "action failed"); return rep.code(500).send({ error: "internal error" });
  };
  app.post("/api/actions/preview", { bodyLimit: 16_384 }, async (req, rep) => {
    if (!o.actions || !fromOurPage(req.headers)) return rep.code(403).send({ error: "forbidden" });
    try { return await o.actions.preview(req.body, who.get(req)!); } catch (e) { return failed(rep, e); }
  });
  app.post("/api/actions", { bodyLimit: 16_384 }, async (req, rep) => {
    if (!o.actions || !fromOurPage(req.headers)) return rep.code(403).send({ error: "forbidden" });
    const k = req.headers["idempotency-key"];
    try { const { run, replay } = o.actions.start(req.body, who.get(req)!, typeof k === "string" ? k : undefined); return rep.code(replay ? 200 : 202).send({ run }); }
    catch (e) { return failed(rep, e); }
  });
```

(import `type FastifyReply` from `fastify`.)

In `main.ts`:

```ts
import { actionsConfig } from "./config.js";
import { Actions, ActionError, centerState } from "./actions.js";
import { gatusAck } from "./ack.js";
// …after db is opened:
db.abandonRunning(new Date().toISOString());
const links = new Map(cfg.agents.map(a => [a.server, new AgentLink(a.server, a.url, a.token, a.ca)]));
for (const l of links.values()) l.start(store, db);
const ac = actionsConfig(); const local = [gatusAck(db)];
const actions = new Actions({ state: () => centerState(store, db, local), db, local, actors: ac.actors,
  call: (server, path, body, signal) => { const l = links.get(server); if (!l) throw new ActionError(409, `${server} has no agent`); return l.post(path, body, signal); },
  publish: ({ run, event }) => { if (event) store.record(event); if (run) store.announce(run); } });
const app = buildCenter({ store, db, local, actions, origin: ac.origin, webRoot: process.env.WEB_ROOT ?? "/app/web", version: process.env.VERSION ?? "dev",
  access: acc.dev ? (async () => ({ email: "dev@local" })) : ((jwt) => verifyAccess(jwt, acc)) });
```

The shutdown loop becomes `for (const l of links.values()) l.stop();`.

- [ ] **Step 3: Run everything.** Run: `pnpm vitest run && pnpm typecheck`. Expected: PASS.

- [ ] **Step 4: Run it locally against a fake agent.** Start the center with `CONTROL_DEV=1 HOST=127.0.0.1 PORT=8080 AGENTS='[]'` and confirm:
  - `curl -s -X POST localhost:8080/api/actions -H 'content-type: application/json' -d '{}'` returns 403 (no Origin);
  - the same call with `-H 'origin: http://127.0.0.1:8080' -H 'x-hetops-action: 1' -H 'idempotency-key: 6f1c2a52-8c2e-4c43-9a43-1f2f5d3c9b10'` returns 404 (no such target), which shows the guard let it through to validation.

- [ ] **Step 5: Commit**

```bash
git add apps/center
git commit -S -m "feat(center): action routes behind Access, Origin and a custom header"
```

---

### Task 10: Web: the confirmation dialog, knobs that act, live progress

**Files:**
- Create: `apps/web/src/lib/actions.ts`, `apps/web/src/lib/action-state.svelte.ts`, `apps/web/src/components/ActionDialog.svelte`, `apps/web/src/components/Toasts.svelte`, `apps/web/test/actions.test.ts`, `apps/web/e2e/actions.spec.ts`
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/App.svelte`, `apps/web/src/components/{Knob,NeedsYou,Drawer}.svelte`, `apps/web/src/pages/{Home,Apps,Alerts,Backups}.svelte`, `apps/web/src/styles/pages.css`

**Interfaces:**
- Consumes: `CenterState.actions/acks`, `CenterMessage` `action`, `ActionRun`, `checkParams` (Task 1); the center routes (Task 9).
- Produces:
  - `offer(e, id | undefined, list): Offer | undefined`
  - `fields(schema): Field[]`
  - `defaults(schema): Params`
  - `preview(e, action, params): Promise<string>`
  - `start(e, action, params, key, confirm?): Promise<ActionRun>`
  - the runes state `ui.open`, `catalog.list` and `runs.list`, with `track(run)` and `dismiss(id)`
  - `Handlers.action(run)`
  - `<Knob entity action? label warm?>`, and `<NeedsYou needs entities>`

- [ ] **Step 1: Write the failing unit test** `apps/web/test/actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { defaults, fields, offer, type Descriptor } from "../src/lib/actions.js";

const silence: Descriptor = { server: "lab", id: "alert.silence", label: "Silence", description: "d", targets: ["alert"], risk: "safe", preview: true,
  params: { type: "object", additionalProperties: false, properties: {
    hours: { type: "string", enum: ["1", "4"], default: "4", description: "For how long, in hours" }, note: { type: "string", maxLength: 200 },
    times: { type: "integer", minimum: 1, maximum: 3 }, hardRefresh: { type: "boolean", default: false } } } };
const alert: Entity = { id: "lab/alert/abc", kind: "alert", server: "lab", name: "KubeQuota", status: "attention", facts: {}, links: [],
  actions: [{ id: "alert.silence", label: "Silence", risk: "safe" }], observedAt: "2026-10-31T10:00:00Z" };

describe("action forms", () => {
  it("turns the params schema into fields", () => {
    expect(fields(silence.params)).toEqual([
      { key: "hours", label: "Hours", help: "For how long, in hours", kind: "choice", options: ["1", "4"] },
      { key: "note", label: "Note", kind: "text", max: 200 },
      { key: "times", label: "Times", kind: "number", min: 1, max: 3 },
      { key: "hardRefresh", label: "Hard refresh", kind: "toggle" }]);
    expect(defaults(silence.params)).toEqual({ hours: "4", hardRefresh: false });
  });
  it("offers an action only when the entity carries it and its own server describes it", () => {
    expect(offer(alert, "alert.silence", [silence])).toEqual({ ref: alert.actions[0], descriptor: silence });
    expect(offer(alert, undefined, [silence])?.ref.id).toBe("alert.silence");                // the first one
    expect(offer(alert, "alert.silence", [{ ...silence, server: "ops" }])).toBeUndefined();  // another server's descriptor
    expect(offer({ ...alert, actions: [] }, "alert.silence", [silence])).toBeUndefined();
  });
});
```

Run: `pnpm --filter web test`. Expected: FAIL (module missing).

- [ ] **Step 2: `apps/web/src/lib/actions.ts`** (pure, so Vitest runs it without Svelte):

```ts
import { ActionPreviewSchema, ActionRunSchema, type ActionDescriptor, type ActionRef, type ActionRun, type Entity, type Params, type ParamsJson, type ServerId } from "@hetops-control/contracts";

export type Descriptor = ActionDescriptor & { server: ServerId };
export type Offer = { ref: ActionRef; descriptor: Descriptor };
/** An action is pressable when the entity offers it and its own server describes it (an older agent may offer neither). */
export function offer(e: Entity, id: string | undefined, list: Descriptor[]): Offer | undefined {
  const ref = id ? e.actions.find(r => r.id === id) : e.actions[0];
  const descriptor = ref && list.find(d => d.server === e.server && d.id === ref.id);
  return ref && descriptor ? { ref, descriptor } : undefined;
}

export type Field = { key: string; label: string; help?: string } & ({ kind: "choice"; options: string[] } | { kind: "text"; max: number } | { kind: "number"; min: number; max: number } | { kind: "toggle" });
const words = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, c => c.toUpperCase());
export const fields = (s: ParamsJson): Field[] => Object.entries(s.properties).map(([key, p]) => {
  const base = { key, label: words(key), ...(p.description ? { help: p.description } : {}) };
  if (p.type === "boolean") return { ...base, kind: "toggle" as const };
  if (p.type === "integer") return { ...base, kind: "number" as const, min: p.minimum, max: p.maximum };
  return p.enum ? { ...base, kind: "choice" as const, options: p.enum } : { ...base, kind: "text" as const, max: p.maxLength ?? 200 };
});
export const defaults = (s: ParamsJson): Params => Object.fromEntries(Object.entries(s.properties).flatMap(([k, p]) => (p.default === undefined ? [] : [[k, p.default]])));

// the center wants the page's own Origin (the browser sets it) and this header, which no other site can send without a preflight
async function post(path: string, body: unknown, key?: string): Promise<unknown> {
  const r = await fetch(path, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", accept: "application/json", "x-hetops-action": "1", ...(key ? { "idempotency-key": key } : {}) } });
  const j = await r.json().catch(() => ({})) as { error?: unknown };
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : `HTTP ${r.status}`);
  return j;
}
export const preview = async (e: Entity, action: string, params: Params) => ActionPreviewSchema.parse(await post("/api/actions/preview", { action, target: e.id, params })).text;
export async function start(e: Entity, action: string, params: Params, key: string, confirm?: string): Promise<ActionRun> {
  const j = await post("/api/actions", { action, target: e.id, params, ...(confirm ? { confirm } : {}) }, key) as { run?: unknown };
  return ActionRunSchema.parse(j.run);
}
```

`apps/web/src/lib/action-state.svelte.ts`:

```ts
import type { ActionRun, Entity } from "@hetops-control/contracts";
import type { Descriptor, Offer } from "./actions.js";

/** The one open action dialog, the descriptors the center advertises, and the latest runs (the toasts). */
export const ui = $state<{ open?: Offer & { entity: Entity } }>({});
export const catalog = $state<{ list: Descriptor[] }>({ list: [] });
export const runs = $state<{ list: ActionRun[] }>({ list: [] });
export function track(r: ActionRun) {
  const held = runs.list.find(x => x.id === r.id);
  if (held && held.state !== "running" && r.state === "running") return;   // a late POST answer never undoes the streamed result
  runs.list = [r, ...runs.list.filter(x => x.id !== r.id)].slice(0, 4);
}
export const dismiss = (id: string) => { runs.list = runs.list.filter(x => x.id !== id); };
```

In `lib/api.ts`, import `ActionRunSchema, type ActionRun`. Add `z.object({ type: z.literal("action"), run: ActionRunSchema })` to `MessageSchema`. Add `action: (r: ActionRun) => void;` to `Handlers`. In `es.onmessage`, after the event line: `if (msg.type === "action") return on.action(msg.run);`.

- [ ] **Step 3: Components.** `components/ActionDialog.svelte`:

```svelte
<script lang="ts">
  import { checkParams } from "@hetops-control/contracts";
  import { track, ui } from "../lib/action-state.svelte.js";
  import { defaults, fields, preview, start } from "../lib/actions.js";

  // one confirming dialog for every action: the form comes from the descriptor, the text from the agent's own preview
  let dlg = $state<HTMLDialogElement>();
  let values = $state<Record<string, string | number | boolean>>({});
  let text = $state<string>(), error = $state<string>(), busy = $state(false), typed = $state("");
  let key = "";
  const o = $derived(ui.open);
  $effect(() => {
    if (!o || !dlg || dlg.open) return;
    values = defaults(o.descriptor.params); typed = ""; error = undefined; text = undefined; key = crypto.randomUUID();
    dlg.showModal();
  });
  // the preview follows the params, so what the dialog says is exactly what will be asked
  $effect(() => {
    if (!o) return;
    const p = checkParams(o.descriptor.params, $state.snapshot(values));
    text = undefined;
    if (!p.ok) { error = p.error; return; }
    error = undefined;
    const t = setTimeout(() => preview(o.entity, o.ref.id, p.params).then(x => (text = x), e => (error = (e as Error).message)), 200);
    return () => clearTimeout(t);
  });
  const disruptive = $derived(o?.descriptor.risk === "disruptive");
  const ready = $derived(!!o && !!text && !error && !busy && (!disruptive || typed === o.entity.name));
  async function confirm() {
    if (!o || !ready) return;
    const p = checkParams(o.descriptor.params, $state.snapshot(values)); if (!p.ok) return;
    busy = true;
    try { track(await start(o.entity, o.ref.id, p.params, key, disruptive ? typed : undefined)); dlg?.close(); }
    catch (e) { error = (e as Error).message; }
    finally { busy = false; }
  }
</script>

<dialog bind:this={dlg} class="act-dlg raised" aria-labelledby="act-h" onclose={() => (ui.open = undefined)}>
  {#if o}
    <form onsubmit={e => { e.preventDefault(); void confirm(); }}>
      <span class="kicker">{disruptive ? "DISRUPTIVE" : "SAFE"} · {o.entity.server.toUpperCase()}</span>
      <h2 id="act-h">{o.descriptor.label} {o.entity.name}</h2>
      {#each fields(o.descriptor.params) as f (f.key)}
        <div class="fld">
          {#if f.kind === "choice"}
            <span class="fld-l" id={`f-${f.key}`}>{f.label}</span>
            <div class="chips" role="radiogroup" aria-labelledby={`f-${f.key}`}>
              {#each f.options as v (v)}<label class="chip" class:on={values[f.key] === v}><input type="radio" name={f.key} value={v} bind:group={values[f.key]} />{v}</label>{/each}
            </div>
          {:else if f.kind === "toggle"}
            <label class="fld-l"><input type="checkbox" checked={values[f.key] === true} onchange={e => (values[f.key] = e.currentTarget.checked)} /> {f.label}</label>
          {:else if f.kind === "number"}
            <label class="fld-l">{f.label} <input class="pressed" type="number" min={f.min} max={f.max} bind:value={values[f.key]} /></label>
          {:else}
            <label class="fld-l">{f.label} <input class="pressed" type="text" maxlength={f.max} bind:value={values[f.key]} /></label>
          {/if}
          {#if f.help}<small>{f.help}</small>{/if}
        </div>
      {/each}
      <p class="what" aria-live="polite">{text ?? (error ? "" : `Asking ${o.entity.server} what will happen…`)}</p>
      {#if error}<p class="err" role="alert">{error}</p>{/if}
      {#if disruptive}
        <label class="fld-l">Type <b>{o.entity.name}</b> to confirm <input class="pressed" autocomplete="off" spellcheck="false" bind:value={typed} /></label>
      {/if}
      <div class="btns">
        <button type="button" class="back raised" onclick={() => dlg?.close()}>Cancel</button>
        <!-- silver, not ember: confirming is the owner's choice, not something that needs them -->
        <button type="submit" class="go raised" disabled={!ready}>{busy ? "Asking…" : o.descriptor.label}</button>
      </div>
    </form>
  {/if}
</dialog>
```

`components/Toasts.svelte`:

```svelte
<script lang="ts">
  import { dismiss, runs } from "../lib/action-state.svelte.js";
  // a success leaves after 8 s; a failure needs you, so it stays (ember) until dismissed
  $effect(() => {
    const done = runs.list.filter(r => r.state === "succeeded").map(r => r.id);
    if (!done.length) return;
    const t = setTimeout(() => done.forEach(dismiss), 8000);
    return () => clearTimeout(t);
  });
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each runs.list as r (r.id)}
    <div class="toast raised" class:warm={r.state === "failed"} data-state={r.state}>
      <span class="toast-dot" aria-hidden="true"></span>
      <span class="toast-t">{r.label} {r.targetName}<small>{r.server} · {r.state === "running" ? "asking…" : r.result?.summary ?? r.error ?? r.state}</small></span>
      {#if r.state !== "running"}<button type="button" class="toast-x" aria-label="Dismiss" onclick={() => dismiss(r.id)}>×</button>{/if}
    </div>
  {/each}
</div>
```

`components/Knob.svelte` (replaces the not-wired knob):

```svelte
<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import { catalog, ui } from "../lib/action-state.svelte.js";
  import { offer } from "../lib/actions.js";
  // a round action knob: it acts when its entity offers the action; otherwise it stays focusable, dimmed, and says why
  let { entity, action, label, warm = false }: { entity: Entity; action?: string; label: string; warm?: boolean } = $props();
  const o = $derived(offer(entity, action, catalog.list));
  const why = $derived(o ? label : `${label}: not offered for this one`);
</script>

<button type="button" class="knob act" class:ember={warm && !!o} class:raised={!warm || !o} aria-disabled={o ? undefined : "true"} title={why} aria-label={why}
  onclick={e => { e.stopPropagation(); if (o) ui.open = { entity, ...o }; }}>
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
```

`components/NeedsYou.svelte` (the primary action of each need):

```svelte
<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import type { Headline } from "../lib/api.js";
  import { catalog, ui } from "../lib/action-state.svelte.js";
  import { offer } from "../lib/actions.js";
  let { needs, entities }: { needs: Headline["needs"]; entities: Entity[] } = $props();
  const act = (n: Headline["needs"][number]) => {
    const e = entities.find(x => x.id === n.entity), o = e && n.action ? offer(e, n.action.id, catalog.list) : undefined;
    return e && o ? { entity: e, ...o } : undefined;
  };
</script>

<div class="needs pressed">
  <h3 class:calm={!needs.length}>NEEDS YOU · {needs.length}</h3>
  {#each needs as n, i (i)}
    {@const a = act(n)}
    <div class="need"><div class="txt">{n.text}<small>{n.detail}</small></div>
      <!-- aria-disabled, not disabled: a need without an action stays focusable so keyboard users hear why -->
      <button type="button" class="ember-btn" aria-disabled={a ? undefined : "true"}
        title={a ? `${a.ref.label} ${a.entity.name}` : "No action for this one here: open its page to look"}
        aria-label={a ? `${a.ref.label} ${a.entity.name}` : `${n.text}: no action to take here`} onclick={() => { if (a) ui.open = a; }}>
        <svg viewBox="0 0 24 24" fill="#2a1408" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button></div>
  {:else}
    <div class="need-none">Nothing is waiting on you.</div>
  {/each}
</div>
```

The call sites:
- `Home.svelte`: `<NeedsYou needs={estate.headline.needs} entities={estate.entities} />`.
- `Drawer.svelte`: the acts row becomes `{#each entity.actions as a (a.id)}<span class="act-l"><Knob {entity} action={a.id} label={`${a.label} ${entity.name}`} warm={needsYou(entity.status)} />{a.label}<small>{a.risk}</small></span>{/each}`.
- `Apps.svelte`: Argo `<Knob entity={e} action="argo.sync" label={`Sync ${e.name}`} {warm} />`; Coolify `<Knob entity={e} action="coolify.redeploy" label={`Redeploy ${e.name}`} {warm} />`.
- `Backups.svelte`: `<Knob entity={e} action="snapshot.now" label={`Snapshot ${e.name} now`} {warm} />`.
- `Alerts.svelte`, per row:
  ```svelte
  {@const ack = estate?.acks?.find(k => k.entity === a.entity.id)}
  {@const warm = a.severity !== "info" && !ack}
  …
  {#if ack}<small class="ack-note">acknowledged by {ack.actor} until {hhmm(ack.until)} UTC{ack.note ? ` · ${ack.note}` : ""}</small>{/if}
  …
  <Knob entity={a.entity} label={`${a.entity.actions[0]?.label ?? "Silence"} ${a.entity.name}`} {warm} />
  ```
  The `ack-note` small sits inside the row's `.t` span.

`App.svelte`:
- import `ActionDialog`, `Toasts`, `catalog` and `track`;
- in the `state` handler add `catalog.list = s.actions ?? [];`;
- add the handler `action: r => track(r),`;
- render `<ActionDialog /><Toasts />` once, after `</main>`.

`styles/pages.css` (CSS keyframes only, which `tokens.css`'s reduced-motion rule switches off):

```css
/* the action dialog: the drawer's surface, centred, narrower */
.act-dlg{border:0;border-radius:22px;padding:26px 28px;width:min(520px,calc(100vw - 32px));color:var(--ink);background:var(--bg)}
.act-dlg::backdrop{background:rgba(10,10,12,.55)}
.act-dlg h2{font:600 26px/1.15 "Fraunces";margin:6px 0 16px}
.act-dlg .fld{display:grid;gap:6px;margin:0 0 14px}
.act-dlg .fld-l{font-size:13px;display:flex;gap:10px;align-items:center}
.act-dlg .fld small{color:var(--ink-3);font:500 11px "IBM Plex Mono"}
.act-dlg input.pressed{border:0;border-radius:10px;padding:8px 10px;color:var(--ink);font:500 13px "Plus Jakarta Sans";flex:1}
.act-dlg .chips input{position:absolute;opacity:0;pointer-events:none}
.act-dlg .what{font-size:14px;line-height:1.55;color:var(--ink-2);min-height:3.1em}
.act-dlg .err{color:var(--ember-2);font-size:13px}
.act-dlg .btns{display:flex;justify-content:flex-end;gap:10px;margin-top:8px}
.act-dlg .go{border:0;border-radius:999px;padding:9px 18px;color:var(--ink);font:600 13px "Plus Jakarta Sans";cursor:pointer}
.act-dlg .go:disabled{opacity:.45;cursor:not-allowed}
.act-dlg .go:focus-visible,.act-dlg .chip:focus-within{outline:2px solid var(--quiet);outline-offset:2px}
/* toasts: bottom right, newest on top; a failure is ember (it needs you), the rest silver */
.toasts{position:fixed;right:16px;bottom:16px;display:grid;gap:10px;z-index:30;width:min(360px,calc(100vw - 32px))}
.toast{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;animation:toast-in .35s var(--ease) both}
.toast-t{flex:1;font-size:13px;display:grid}
.toast-t small{color:var(--ink-3);font:500 11px "IBM Plex Mono"}
.toast-dot{width:9px;height:9px;border-radius:50%;background:var(--quiet)}
.toast[data-state="running"] .toast-dot{animation:toast-pulse 1.2s ease-in-out infinite}
.toast.warm .toast-dot{background:var(--ember-2);box-shadow:0 0 10px rgba(242,88,42,.6)}
.toast.warm small{color:var(--ember-1)}
.toast-x{border:0;background:none;color:var(--ink-3);font-size:18px;cursor:pointer}
.ack-note{color:var(--ink-3)}
@keyframes toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes toast-pulse{50%{opacity:.35}}
```

If a token named above (`--bg`, `--quiet`, `--ease`, `--ember-1/2`, `--ink-2/3`) differs in `tokens.css`, use the existing name the drawer uses for the same role. Do not add new colours.

- [ ] **Step 4: Write the e2e** `apps/web/e2e/actions.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import type { ActionRun, Entity } from "@hetops-control/contracts";
import { fixtureState, mockApi } from "./fixture.js";

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-30T07:42:00.000Z")); });
const at = "2026-10-30T07:42:00.000Z";
const params = { type: "object" as const, properties: {}, additionalProperties: false as const };

function withSync(risk: "safe" | "disruptive" = "safe") {
  const s = structuredClone(fixtureState);
  const app = s.entities.find(e => e.kind === "argo-app" && e.server === "lab") as Entity;
  Object.assign(app, { status: "attention", statusReason: "OutOfSync for 14 min", actions: [{ id: "argo.sync", label: "Sync", risk }] });
  app.facts.sync = { value: "OutOfSync" };
  s.actions = [{ server: "lab", id: "argo.sync", label: "Sync", description: "Asks Argo CD to sync.", targets: ["argo-app"], risk, preview: true, params }];
  s.headline = { ...s.headline, needs: [{ entity: app.id, server: "lab", text: `${app.name} on lab`, detail: "OutOfSync for 14 min", action: app.actions[0] }] };
  return { s, app };
}
async function wire(page: Page, app: Entity) {
  const sent: { kind: string; headers: Record<string, string>; body: any }[] = [];
  await page.route("**/api/actions/preview", r => { sent.push({ kind: "preview", headers: r.request().headers(), body: r.request().postDataJSON() });
    return r.fulfill({ json: { text: `Syncs ${app.name} on lab to main. Nothing is pruned.` } }); });
  await page.route("**/api/actions", async r => {
    const headers = r.request().headers(); sent.push({ kind: "run", headers, body: r.request().postDataJSON() });
    const run: ActionRun = { id: headers["idempotency-key"]!, action: "argo.sync", label: "Sync", server: "lab", target: app.id, targetName: app.name,
      actor: "het@hetops.dev", params: {}, state: "running", at };
    // the stream's next connection (retry 100 ms) carries the result, as the center would
    await page.unroute("**/api/stream");
    await page.route("**/api/stream", rr => rr.fulfill({ contentType: "text/event-stream",
      body: `retry: 100\ndata: ${JSON.stringify({ type: "action", run: { ...run, state: "succeeded", finishedAt: at, result: { ok: true, summary: `sync of ${app.name} started` } } })}\n\n` }));
    return r.fulfill({ status: 202, json: { run } });
  });
  return sent;
}

test("a safe action: the exact preview, one confirming click, live progress and the result", async ({ page }) => {
  const { s, app } = withSync(); await mockApi(page, s); const sent = await wire(page, app);
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  const dlg = page.getByRole("dialog", { name: `Sync ${app.name}` });
  await expect(dlg).toContainText(`Syncs ${app.name} on lab to main. Nothing is pruned.`);
  await dlg.getByRole("button", { name: "Sync", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator(".toast")).toContainText(app.name);
  await expect(page.locator(".toast")).toContainText(`sync of ${app.name} started`, { timeout: 10_000 });
  const run = sent.find(x => x.kind === "run")!;
  expect(run.headers["x-hetops-action"]).toBe("1");
  expect(run.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(run.body).toEqual({ action: "argo.sync", target: app.id, params: {} });
});

test("cancel asks nothing", async ({ page }) => {
  const { s, app } = withSync(); await mockApi(page, s); const sent = await wire(page, app);
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(sent.filter(x => x.kind === "run")).toEqual([]);
});

test("a disruptive action needs the target's name typed", async ({ page }) => {
  const { s, app } = withSync("disruptive"); await mockApi(page, s); const sent = await wire(page, app);
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  const dlg = page.getByRole("dialog"); const go = dlg.getByRole("button", { name: "Sync", exact: true });
  await expect(dlg).toContainText("Nothing is pruned.");
  await expect(go).toBeDisabled();
  await dlg.getByRole("textbox").fill(app.name.toUpperCase()); await expect(go).toBeDisabled();
  await dlg.getByRole("textbox").fill(app.name); await go.click();
  await expect(dlg).toBeHidden();
  expect(sent.find(x => x.kind === "run")!.body.confirm).toBe(app.name);
});

test("Needs you opens the same dialog; a knob without an offer stays dimmed and opens nothing", async ({ page }) => {
  const { s, app } = withSync(); await mockApi(page, s); await wire(page, app);
  await page.goto("/");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  await expect(page.getByRole("dialog", { name: `Sync ${app.name}` })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/apps");   // the fixture's other Argo apps offer nothing
  const knob = page.locator(".knob.act[aria-disabled='true']").first();
  await expect(knob).toHaveAttribute("aria-label", /not offered for this one/);
  await knob.click(); await expect(page.getByRole("dialog")).toBeHidden();
});

test("reduced motion: toasts appear without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { s, app } = withSync(); await mockApi(page, s); await wire(page, app);
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sync", exact: true }).click();
  await expect(page.locator(".toast")).toBeVisible();
  expect(await page.locator(".toast").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
});
```

- [ ] **Step 5: Run unit, e2e, typecheck and build**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build && pnpm --filter web e2e`
Expected: PASS, every existing e2e included. The pages' `Knob` now takes `entity`; any other call site the compiler flags gets the same change.

- [ ] **Step 6: Check the copy and names by hand.**
  - `git grep -n -E 'class="[^"]*(policy|cookie|consent|banner|ad|sponsor|promo)' apps/web/src` finds nothing new. Read every hit for "ad" as a substring.
  - In the dev server with `prefers-reduced-motion: reduce`, nothing moves.
  - Ember shows only on a needing entity's knob, on Needs you, and on a failed toast.

- [ ] **Step 7: Commit, push, PR, and merge when green**

```bash
git switch -c feat/web-actions origin/main   # after Tasks 7-9 merged
git add apps/web
git commit -S -m "feat(web): confirm dialog, acting knobs and live action toasts"
```

---

### Task 11: Roll out on ops: center, `snapshot.now`, `gatus.ack`

**Repo:** `C:/Users/HetPatel/Personal/HetOps/hetops-k8s-lab`, branch `feat/control-actions-ops` from `origin/main`. Use a worktree; the local `main` there has unrelated edits.

**Files:**
- Modify: `clusters/ops/logging/roles.yml`, `clusters/ops/logging/elasticsearch.yaml`, `clusters/ops/logging/kustomization.yaml`, `clusters/ops/control/agent.yaml`, `clusters/ops/control/center.yaml`, `clusters/ops/control/kustomization.yaml`
- Create: `clusters/ops/logging/sealed-user-control-operator.yaml`, `clusters/ops/control/sealed-es-operator.yaml`

- [ ] **Step 1: OWNER STEP O1.** Ask: "On control.hetops.dev → Settings, which email is under Signed in as?" Put it in `ACTORS` below; until then the center runs with actions off.

- [ ] **Step 2: Images.** Use the `main` commit after Task 10. Read both digests from the CI run's `images` job (cosign-signed) and verify each signature:
  ```bash
  cosign verify ghcr.io/het101/hetops-control-<img>@sha256:<digest> \
    --certificate-identity-regexp 'https://github.com/Het101/hetops-control/' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```

- [ ] **Step 3: The ES role.** Append to `clusters/ops/logging/roles.yml`:

```yaml
# HetOps Control's snapshot.now: POST _slm/policy/<id>/_execute and nothing else in its code. manage_slm is the narrowest privilege
# that runs a policy (create_snapshot would bypass SLM's history and retention, which the Backups page reads). The snapshot runs
# with the headers of whoever last PUT the policy (the setup Job), not as this user.
control_operator:
  cluster: [manage_slm]
```

Add `- secretName: ops-es-user-control-operator` under `fileRealm` in `elasticsearch.yaml`, and `- sealed-user-control-operator.yaml` to `logging/kustomization.yaml`.

- [ ] **Step 4: Seal the user (on the lab, the only host with kubeseal; nothing is printed).** Follow the control-reader recipe:

```bash
S=/c/Users/HetPatel/AppData/Local/Temp/claude/scratch-ops-op; mkdir -p $S
ssh ubuntu@130.210.37.122 'kubectl get --raw "/api/v1/namespaces/kube-system/services/sealed-secrets-controller:8080/proxy/v1/cert.pem"' > $S/ops-cert.pem
sha256sum $S/ops-cert.pem clusters/ops/sealed-secrets/ops-cert.pem          # identical
ssh ubuntu@140.245.13.138 'cat > /tmp/ops-cert-control-operator.pem' < $S/ops-cert.pem
ssh ubuntu@140.245.13.138 'bash -s' > $S/sealed.tgz <<'EOF'
set -euo pipefail; umask 077; d=$(mktemp -d); trap 'cd /; rm -rf "$d" /tmp/ops-cert-control-operator.pem' EXIT; cd "$d"
openssl rand -base64 48 | tr -d '\n/+=' | head -c 40 > password
printf control-operator > username; printf control_operator > roles
kubectl create secret generic ops-es-user-control-operator -n logging --type=kubernetes.io/basic-auth \
  --from-file=username --from-file=password --from-file=roles --dry-run=client -o yaml \
  | kubeseal --cert /tmp/ops-cert-control-operator.pem --format yaml > sealed-user-control-operator.yaml
kubectl create secret generic control-es-operator -n control --type=kubernetes.io/basic-auth \
  --from-file=username --from-file=password --dry-run=client -o yaml \
  | kubeseal --cert /tmp/ops-cert-control-operator.pem --format yaml > sealed-es-operator.yaml
tar cz sealed-*.yaml
EOF
tar -xzf $S/sealed.tgz -C $S
mv $S/sealed-user-control-operator.yaml clusters/ops/logging/; mv $S/sealed-es-operator.yaml clusters/ops/control/; rm -rf $S
```

- [ ] **Step 5: The ops agent.** In `clusters/ops/control/agent.yaml`:
  - set the new image digest, with its comment naming the commit;
  - add to `env`:
    ```yaml
            # stage 2: the verbs this agent offers (hetops-control apps/agent/src/actions). snapshot.now runs an SLM policy as
            # control-operator (manage_slm); every read stays with control-reader.
            - { name: ACTIONS, value: snapshot.now }
            - { name: ES_OPERATOR_DIR, value: /es-operator }
    ```
  - mount `- { name: es-operator, mountPath: /es-operator, readOnly: true }`, with the volume `- name: es-operator` / `secret: { secretName: control-es-operator, items: [{ key: username, path: username }, { key: password, path: password }] }`;
  - add `- sealed-es-operator.yaml` to `clusters/ops/control/kustomization.yaml`.

  No NetworkPolicy changes: the agent's egress is open and it already reaches ES.

- [ ] **Step 6: The center.** In `center.yaml`, set the new digest and add:

```yaml
            # stage 2: POSTs must come from this page (the Origin check), and only these Access identities may act
            - { name: PUBLIC_ORIGIN, value: "https://control.hetops.dev" }
            - { name: ACTORS, value: "<the email from O1>" }
```

- [ ] **Step 7: Server-side dry run on hetops-3, then the PR.**

```bash
ssh ubuntu@130.210.37.122 'cd ~/hetops-k8s-lab && git fetch -q && git checkout -q origin/feat/control-actions-ops && for k in control logging; do kubectl kustomize clusters/ops/$k | kubectl apply --dry-run=server -f - >/dev/null && echo "$k ok"; done; git checkout -q main'
```

Expected: `control ok` and `logging ok`. Open the PR with the role justification and the verification plan. **OWNER STEP O2:** wait for "merge".

- [ ] **Step 8: After the merge, verify (scripts on stdin; each reads its secret inside the pod).**
  1. `kubectl get application control logging -n argocd` reports Synced Healthy; ES is green.
  2. control-operator holds exactly what it should. Save as `$S/op-check.mjs`:
     ```js
     import { readFileSync } from "node:fs";
     const r = f => readFileSync(`/es-operator/${f}`, "utf8").trim();
     const h = { authorization: `Basic ${Buffer.from(`${r("username")}:${r("password")}`).toString("base64")}`, "content-type": "application/json" };
     const res = await fetch("https://ops-logs-es-http.logging.svc:9200/_security/user/_has_privileges", { method: "POST", headers: h,
       body: JSON.stringify({ cluster: ["manage_slm", "read_slm", "manage", "manage_security", "create_snapshot", "monitor"], index: [{ names: ["logs-lab-default"], privileges: ["read", "write"] }] }) });
     const j = await res.json(); console.log(JSON.stringify({ cluster: j.cluster, index: j.index }));
     ```
     Run it with `ssh ubuntu@130.210.37.122 'kubectl exec -i -n control deploy/control-agent -- node --input-type=module -' < $S/op-check.mjs`. Expected: `manage_slm` and `read_slm` true; `manage`, `manage_security`, `create_snapshot` and `monitor` false; index read and write false.
  3. The agent offers and previews. Use a `$S/agent-preview.mjs` that reads `/secrets/token`, GETs `http://127.0.0.1:7443/v1/state` and prints the `actions` ids and the refs on `ops/backup/nightly-all`. It then POSTs `/v1/actions/snapshot.now/preview` with `{target:"ops/backup/nightly-all", params:{}, actor:"<O1 email>", requestId: crypto.randomUUID()}` and prints the text. Expected: `["snapshot.now"]`, a ref on both backups, and a preview naming `logs-lab-*` and `local`.
  4. Record the real `_execute` answer: one extra snapshot of nightly-all, kept by retention like any other. A `$S/record-execute.mjs` POSTs `_slm/policy/nightly-all/_execute` as control-operator and prints the body. Save it as hetops-control `apps/agent/test/fixtures/es-slm-execute.json`; it holds a snapshot name only, nothing secret. `GET _slm/policy/nightly-all` as control-reader, a few minutes later, shows the new `last_success`.
  5. **OWNER STEP O3:** Backups → nightly-all → Snapshot now → confirm. Then confirm:
     - the toast succeeds;
     - the timeline has two `action` events with the owner's email;
     - on hetops-3, `kubectl exec -n control deploy/control-center -- node -e "const D=require('better-sqlite3');console.log(new D('/data/events.db',{readonly:true}).prepare('select id,actor,action,target,state,error from actions order by at desc limit 3').all())"` shows the row succeeded. This prints no secret. The center image bundles better-sqlite3; if its `require` fails in the bundle, use `sqlite3` from the node instead with the PVC's host path.
  6. `gatus.ack`: when a Gatus check is failing, Acknowledge appears on its row and in Needs you. If none is failing, the center tests cover it; note in the journal that it was not exercised live.

- [ ] **Step 9: hetops-control follow-up PR:** the recorded `es-slm-execute.json`. `pnpm vitest run apps/agent/test/snapshot-action.test.ts` must still pass. Journal the whole task (commands above, the digest, the privilege check output).

---

### Task 12: Roll out on the lab: `argo.*`, `alert.silence`, `coolify.redeploy`

**Repo:** hetops-k8s-lab, branch `feat/control-actions-lab` from `origin/main` (after Task 11 merged).

**Files:**
- Create: `platform/control-agent/argo-guard.yaml`, `platform/control-agent/sealed-agent-coolify-deploy.yaml`
- Modify: `platform/control-agent/rbac.yaml`, `platform/control-agent/agent.yaml`, `platform/control-agent/kustomization.yaml`, `argo/project-control.yaml`

- [ ] **Step 1: OWNER STEP O4, the Coolify deploy token.** In Coolify (lab), go to **Keys & Tokens → API tokens → Create New Token**:
  - name `hetops-control-deploy`;
  - permissions: tick **deploy** only (not root, write, read or read:sensitive);
  - click Create and copy the token.

  Then, in Git Bash on your laptop:

```bash
umask 077; powershell.exe -NoProfile -Command Get-Clipboard | tr -d '\r\n' > ~/.secrets/coolify-deploy-token
powershell.exe -NoProfile -Command Set-Clipboard -Value ' '     # clear the clipboard
```

  I check only its length (`wc -c < ~/.secrets/coolify-deploy-token`), never its value.

- [ ] **Step 2: Seal it (over ssh stdin, never shown).**

```bash
ssh ubuntu@140.245.13.138 'set -euo pipefail; umask 077; tr -d "\r\n" | kubectl create secret generic control-agent-coolify-deploy -n control --from-file=token=/dev/stdin --dry-run=client -o yaml | kubeseal --format yaml --namespace control' \
  < ~/.secrets/coolify-deploy-token > platform/control-agent/sealed-agent-coolify-deploy.yaml
ssh ubuntu@140.245.13.138 'kubeseal --validate' < platform/control-agent/sealed-agent-coolify-deploy.yaml
```

- [ ] **Step 3: RBAC.** Append to `platform/control-agent/rbac.yaml`:

```yaml
---
# Stage 2: argo.sync and argo.refresh patch an Application (hetops-control apps/agent/src/actions/argo.ts). RBAC cannot see inside
# a patch, so argo-guard.yaml (a ValidatingAdmissionPolicy) allows only the refresh annotation and a sync to the app's own revision.
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: control-agent-argo-act
  namespace: argocd
rules:
  - apiGroups: [argoproj.io]
    resources: [applications]
    verbs: [get, patch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: control-agent-argo-act
  namespace: argocd
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: control-agent-argo-act }
subjects:
  - { kind: ServiceAccount, name: control-agent, namespace: control }
```

- [ ] **Step 4: The guard,** `platform/control-agent/argo-guard.yaml`. The same file goes to staging in Task 13:

```yaml
# What the control agent may change on an Argo CD Application, and nothing else. Its Role allows `patch` (rbac.yaml); RBAC cannot see
# inside a patch, and Argo CD applies as cluster-admin, so a patch that repointed an app's source would be a cluster takeover.
# The API server therefore refuses every change by the agent's ServiceAccount except:
#   - the refresh annotation, normal or hard (argo.refresh);
#   - a new sync operation to the app's own target revision: no revision(s), source(s), manifests, resources, sync options,
#     prune or force (argo.sync; exactly what `argocd app sync --core` writes for a plain sync).
# Sync wave -1: it exists before the Role that grants the patch.
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: control-agent-argo-actions
  annotations: { argocd.argoproj.io/sync-wave: "-1" }
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [argoproj.io]
        apiVersions: ["*"]
        operations: [UPDATE]
        resources: [applications]
  matchConditions:
    - name: only-the-control-agent
      expression: request.userInfo.username == "system:serviceaccount:control:control-agent"
  validations:
    - expression: object.spec == oldObject.spec
      message: the control agent may not change an Application's spec
    - expression: has(object.status) == has(oldObject.status) && (!has(object.status) || object.status == oldObject.status)
      message: the control agent may not change an Application's status
    - expression: >-
        has(object.metadata.labels) == has(oldObject.metadata.labels) && (!has(object.metadata.labels) || object.metadata.labels == oldObject.metadata.labels)
        && has(object.metadata.finalizers) == has(oldObject.metadata.finalizers) && (!has(object.metadata.finalizers) || object.metadata.finalizers == oldObject.metadata.finalizers)
        && has(object.metadata.ownerReferences) == has(oldObject.metadata.ownerReferences) && (!has(object.metadata.ownerReferences) || object.metadata.ownerReferences == oldObject.metadata.ownerReferences)
      message: the control agent may not change labels, finalizers or owners
    - expression: >-
        (!has(object.metadata.annotations) || object.metadata.annotations.all(k, k == 'argocd.argoproj.io/refresh'
          || (has(oldObject.metadata.annotations) && k in oldObject.metadata.annotations && oldObject.metadata.annotations[k] == object.metadata.annotations[k])))
        && (!has(oldObject.metadata.annotations) || oldObject.metadata.annotations.all(k, k == 'argocd.argoproj.io/refresh'
          || (has(object.metadata.annotations) && k in object.metadata.annotations)))
      message: the control agent may only set the refresh annotation
    - expression: >-
        !has(object.metadata.annotations) || !('argocd.argoproj.io/refresh' in object.metadata.annotations)
        || object.metadata.annotations['argocd.argoproj.io/refresh'] in ['normal', 'hard']
      message: refresh must be normal or hard
    - expression: >-
        !has(object.operation) || (has(oldObject.operation) && object.operation == oldObject.operation)
        || (has(object.operation.sync)
          && !has(object.operation.sync.revision) && !has(object.operation.sync.revisions)
          && !has(object.operation.sync.source) && !has(object.operation.sync.sources)
          && !has(object.operation.sync.manifests) && !has(object.operation.sync.resources)
          && !has(object.operation.sync.syncOptions)
          && (!has(object.operation.sync.prune) || object.operation.sync.prune == false)
          && (!has(object.operation.sync.syncStrategy) || (
               (!has(object.operation.sync.syncStrategy.apply) || !has(object.operation.sync.syncStrategy.apply.force) || object.operation.sync.syncStrategy.apply.force == false)
            && (!has(object.operation.sync.syncStrategy.hook) || !has(object.operation.sync.syncStrategy.hook.force) || object.operation.sync.syncStrategy.hook.force == false))))
      message: a sync from the control agent must target the app's own revision, without prune, force, options or overrides
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: control-agent-argo-actions
  annotations: { argocd.argoproj.io/sync-wave: "-1" }
spec:
  policyName: control-agent-argo-actions
  validationActions: [Deny]
```

In `argo/project-control.yaml`, `clusterResourceWhitelist` gains:

```yaml
  - { group: admissionregistration.k8s.io, kind: ValidatingAdmissionPolicy }          # the guard on the agent's Argo patches
  - { group: admissionregistration.k8s.io, kind: ValidatingAdmissionPolicyBinding }
```

- [ ] **Step 5: The agent.** In `platform/control-agent/agent.yaml`:
  - set the new digest;
  - add to `env`:
    ```yaml
            # stage 2: the verbs this agent offers. Argo through the Kubernetes API (rbac.yaml + argo-guard.yaml); Alertmanager's
            # silences on the same Service the alerts source reads; Coolify with a second, deploy-only token.
            - { name: ACTIONS, value: "argo.sync,argo.refresh,alert.silence,coolify.redeploy" }
            - { name: COOLIFY_DEPLOY_TOKEN_FILE, value: /secrets/coolify-deploy/token }
    ```
  - add the mount `- { name: coolify-deploy, mountPath: /secrets/coolify-deploy, readOnly: true }` and the volume `- name: coolify-deploy` / `secret: { secretName: control-agent-coolify-deploy }   # Coolify ability "deploy" only: it cannot read`;
  - in `kustomization.yaml`, add `- sealed-agent-coolify-deploy.yaml   # the Coolify deploy-only token` and `- argo-guard.yaml   # admission policy on the agent's Argo patches`.

- [ ] **Step 6: Confirm there is no NetworkPolicy work for Alertmanager.** `ssh ubuntu@140.245.13.138 'kubectl get networkpolicy -n monitoring'` returns `No resources found`. Record that in the PR.

- [ ] **Step 7: Server-side dry run, then the PR.** The CEL compiles at create time:

```bash
ssh ubuntu@140.245.13.138 'cd ~/hetops-k8s-lab && git fetch -q && git checkout -q origin/feat/control-actions-lab && kubectl kustomize platform/control-agent | kubectl apply --dry-run=server -f - | tail -n +1; git checkout -q main'
```

Expected: everything is configured or created. The only warnings are the existing PodSecurity "restricted" ones (hostPort, hostPath). **OWNER STEP O5:** "merge". The go-ahead covers the two recordings in Step 8.

- [ ] **Step 8: After the merge, verify on the lab.**
  1. Argo: `control-agent` is Synced Healthy. `kubectl get validatingadmissionpolicy control-agent-argo-actions -o jsonpath='{.status.typeChecking}'` shows no `expressionWarnings`. A warning means a field path is wrong for this Argo CD CRD: fix the expression and push before going on.
  2. The guard, as the ServiceAccount (`--dry-run=server` runs admission and changes nothing):
     ```bash
     ssh ubuntu@140.245.13.138 'bash -s' <<'EOF'
     SA=system:serviceaccount:control:control-agent; APP=cert-manager
     try() { printf "%-34s " "$1"; kubectl patch application $APP -n argocd --as=$SA --type merge -p "$2" --dry-run=server -o name 2>&1 | tail -1; }
     try "refresh normal (allow)" '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"normal"}}}'
     try "refresh hard (allow)"   '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'
     try "sync to target (allow)" '{"operation":{"initiatedBy":{"username":"check (hetops-control)"},"sync":{"syncStrategy":{"hook":{}}}}}'
     try "spec (deny)"            '{"spec":{"source":{"targetRevision":"evil"}}}'
     try "sync revision (deny)"   '{"operation":{"sync":{"revision":"0000000"}}}'
     try "sync source (deny)"     '{"operation":{"sync":{"source":{"repoURL":"https://evil.example/x.git"}}}}'
     try "sync prune (deny)"      '{"operation":{"sync":{"prune":true}}}'
     try "sync force (deny)"      '{"operation":{"sync":{"syncStrategy":{"apply":{"force":true}}}}}'
     try "sync options (deny)"    '{"operation":{"sync":{"syncOptions":["Replace=true"]}}}'
     try "label (deny)"           '{"metadata":{"labels":{"x":"y"}}}'
     try "annotation (deny)"      '{"metadata":{"annotations":{"x":"y"}}}'
     try "refresh value (deny)"   '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"evil"}}}'
     for v in get patch update delete create; do printf "can-i %-6s " $v; kubectl auth can-i $v applications -n argocd --as=$SA; done
     EOF
     ```
     Expected:
     - the three "allow" lines print `application.argoproj.io/cert-manager`;
     - every "deny" line prints `ValidatingAdmissionPolicy 'control-agent-argo-actions' … denied request: <its message>`;
     - `can-i` answers get yes, patch yes, update no, delete no, create no.
  3. Coolify scopes. A `$S/coolify-scope.mjs` in the agent pod reads both token files and prints only status codes:
     - the deploy token on `GET /api/v1/applications`, expected 403;
     - the read token on `GET /api/v1/deploy?uuid=<hetops-dns uuid>`, expected 403;
     - the deploy token's ability: no call needed, since step 5 uses it.
  4. Recording 1, a throwaway silence. A `$S/am-record.mjs` in the agent pod POSTs `/api/v2/silences` with matcher `alertname="HetOpsControlFixture"` (no such alert), 1 minute, `createdBy` the O1 email and comment `fixture recording`. It prints the answer, then `DELETE /api/v2/silence/<id>` and prints that status. The first answer becomes `alertmanager-silence-created.json`.
  5. Recording 2, one real redeploy of `hetops-dns` (approved in O5). A `$S/coolify-record.mjs` in the agent pod POSTs `/api/v1/deploy?uuid=y4edofq4pzebjid6hyksdl8z&force=false` with the deploy token and prints the body; it becomes `coolify-deploy.json`. Then watch Apps until that deploy finishes, and check that dns.hetops.dev still answers.
  6. **OWNER STEP O6:** on control.hetops.dev, press:
     - Refresh on one Argo app (Apps, a card's drawer → Refresh);
     - Redeploy on one Coolify app;
     - Silence (1 h) on a firing alert, if one is firing; otherwise leave the e2e and contract tests as the proof and note it.

     Each one shows a succeeded toast and two `action` events. Then check:
     - `kubectl get application <app> -n argocd -o jsonpath='{.status.reconciledAt}'` moved;
     - the Coolify deployment appears;
     - the silence is listed in Alertmanager with the owner's email as `createdBy`.
  7. Sync: when an app is OutOfSync, Sync from its card. `status.operationState.operation.initiatedBy.username` reads `<owner email> (hetops-control)`.

- [ ] **Step 9: hetops-control follow-up PR** with the two recorded fixtures. Run `pnpm vitest run apps/agent`; it must pass unchanged. Journal everything: the commands, the guard output and the scope checks.

---

### Task 13: Roll out on staging: `argo.*`

**Repo:** hetops-k8s-lab, branch `feat/control-actions-staging` from `origin/main` (after Task 12 merged).

**Files:**
- Create: `clusters/staging/control/argo-guard.yaml` (byte-identical to `platform/control-agent/argo-guard.yaml`; its header comment names the lab file as the twin to keep in sync)
- Modify: `clusters/staging/control/rbac.yaml` (append the same `control-agent-argo-act` Role and RoleBinding as Task 12 Step 3), `clusters/staging/control/agent.yaml`, `clusters/staging/control/kustomization.yaml` (`- argo-guard.yaml`)

The staging `control` app is in project `default`, so no whitelist change is needed.

- [ ] **Step 1: The agent.** Set the same digest as the lab, and add to `env`:

```yaml
            # stage 2: Argo CD's sync and refresh only (rbac.yaml + argo-guard.yaml); staging runs no Alertmanager or Coolify
            - { name: ACTIONS, value: "argo.sync,argo.refresh" }
```

- [ ] **Step 2: Dry run on vm2 (through the lab, as Bedrock reaches it), then the PR.**

```bash
ssh ubuntu@140.245.13.138 'cd ~/hetops-k8s-lab && git fetch -q && git checkout -q origin/feat/control-actions-staging && kubectl kustomize clusters/staging/control > /tmp/staging-control.yaml; git checkout -q main; ssh ubuntu@140.238.224.158 "kubectl apply --dry-run=server -f -" < /tmp/staging-control.yaml; rm -f /tmp/staging-control.yaml'
```

**OWNER STEP O7:** "merge".

- [ ] **Step 3: Verify.**
  - Staging Argo (hard-refresh root if needed) reports `control` Synced Healthy.
  - The guard has no type-checking warnings.
  - Run the Task 12 Step 8.2 script against staging by wrapping it in `ssh ubuntu@140.238.224.158 'bash -s'` from the lab, with `APP=sealed-secrets`. Expect the same allow, deny and can-i lines.
  - **OWNER STEP O7 (second half):** press Refresh on one staging Argo app. The toast succeeds and the timeline shows it under staging.
  - Journal it.
  - Stage 2 is done when every action has run once live, or is noted as covered by tests only (`gatus.ack`, and `alert.silence` if nothing fired).

---

## Self-review (done while writing)

- **Spec coverage:**
  - Actions as a fixed allow-list implemented in the agent: Tasks 2–6 and `ACTIONS`.
  - Risk declared, and the disruptive typed-name path: Tasks 1, 8 and 10 (tested with a test-only disruptive verb).
  - Who, what, when and result recorded and written to the timeline: Tasks 7–9.
  - Idempotent where the tool allows, 60 s, a failed action is an event: Task 8 and each action.
  - RBAC read-only except the exact verbs: Tasks 11–13.
  - Stage-2 verbs: `coolify.redeploy` (6), `argo.sync` and `argo.refresh` (4), `alert.silence` (5), `gatus.ack` (8, center-side by decision 2), `snapshot.now` (3).
  - Pages "Acts (stage 2)": Home Needs you, Alerts silence or acknowledge, Apps redeploy and sync, Backups run now (Task 10).
  - Live via SSE: Tasks 8–10. Security (Access, JWT, no secret in a command line or the browser): Global Constraints and Tasks 9 and 11–13.
- **Names stay the same across tasks:**
  - `ActionDescriptor.targets`, `Action.applies`, `describeAction` and `buildActions`/`MAKERS`/`need`;
  - `actionRunner` → `Runner`, `EventsDb.addRun/finishRun/run/abandonRunning/addAck/acks`;
  - `Actions.start/preview`, `centerState`, `decorate`, `gatusAck`, `Store.announce`, `AgentLink.post`;
  - web `offer/fields/defaults/preview/start`, `ui/catalog/runs/track/dismiss`.
- **Out of scope, on purpose:**
  - `deployment.restart` (disruptive), `bedrock.drift-check`, `chaos.pause/resume` and `restore-drill.run` are stage 3. The disruptive confirmation path is built and tested, so they slot in.
  - Argo actions on ops's own Argo CD are not in this rollout order. The same Role and guard make them a two-file change later.
  - hetops.dev does not list HetOps Control (it is owner-only behind Access), so this stage changes nothing there.
