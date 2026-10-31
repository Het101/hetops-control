import { describe, it, expect } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { coolifyRedeploy, type CoolifyDeployer } from "../src/actions/coolify.js";
import type { CoolifyReader } from "../src/sources/coolify.js";
import { describeAction } from "../src/actions/index.js";
// coolify.json: recorded on the lab (stage 1b Task 4).
// coolify-deploy.json: NOT RECORDED YET (no server access in this task). It is Coolify's documented answer to
// POST /api/v1/deploy?uuid=…&force=false ({"deployments": [{message, resource_uuid, deployment_uuid}]}). Task 12 replaces it with
// the recording of one hetops-dns redeploy; this test must still pass.
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
  it("hands the run's abort signal to both Coolify calls, so the 55 s limit cancels them", async () => {
    const seen: unknown[] = [];
    const reader: CoolifyReader = { applications: async () => [], deployments: async (_u, _t, signal) => { seen.push(signal); return []; } };
    await coolifyRedeploy(reader, { deploy: async (_u, signal) => { seen.push(signal); return deployed; } }).run(app(), {}, ctx);
    expect(seen).toEqual([ctx.signal, ctx.signal]);
  });
});
