import { describe, it, expect } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { argoRefresh, argoSync, type ArgoApps } from "../src/actions/argo.js";
import { describeAction } from "../src/actions/index.js";
// argo-app.json: ASSEMBLED, NOT RECORDED YET (no server access in this task). spec is cert-manager's Application from
// hetops-k8s-lab argo/apps/cert-manager.yaml; status.sync and status.health come from the lab recording in argo.json;
// status.operationState follows the documented Argo CD Application CRD shape. Task 12 replaces it with the real recording:
// kubectl get application cert-manager -n argocd -o json (managedFields removed); this test must still pass.
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
  it("hands the run's abort signal to every Kubernetes call, so the 55 s limit cancels them", async () => {
    const seen: unknown[] = []; const api: ArgoApps = { get: async (_n, signal) => { seen.push(signal); return rec; }, patch: async (_n, _b, signal) => { seen.push(signal); } };
    await argoSync(api).run(app(), {}, ctx); await argoRefresh(api).run(app(), { hard: false }, ctx);
    expect(seen).toEqual([ctx.signal, ctx.signal, ctx.signal]);
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
