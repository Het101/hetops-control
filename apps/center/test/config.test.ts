import { describe, it, expect } from "vitest"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { actionsConfig, loadConfig } from "../src/config.js";

describe("center config", () => {
  const dir = mkdtempSync(join(tmpdir(), "center-cfg-")); const f = (n: string, s: string) => { const p = join(dir, n); writeFileSync(p, s); return p; };
  const tok = f("tok", "s3cret\n"), ca = f("ca.crt", "CA"), empty = f("empty", " \n");
  const env = (agents: unknown, o: Record<string, string> = {}) => ({ AGENTS: JSON.stringify(agents), ...o }) as NodeJS.ProcessEnv;
  it("reads agents with their token and CA from files", () => {
    const c = loadConfig(env([{ server: "lab", url: "https://10.0.0.1:7443/", tokenFile: tok, caFile: ca }]));
    expect(c.agents).toEqual([{ server: "lab", url: "https://10.0.0.1:7443", token: "s3cret", ca: Buffer.from("CA") }]);
    expect(c).toMatchObject({ port: 8080, host: "0.0.0.0", dbPath: "/data/events.db" });
  });
  it("refuses bad agents, empty tokens and bad ports", () => {
    expect(() => loadConfig({ AGENTS: "nope" })).toThrow(/JSON/);
    expect(() => loadConfig(env([{ server: "mars", url: "http://x", tokenFile: tok }]))).toThrow(/server/);
    expect(() => loadConfig(env([{ server: "lab", url: "ftp://x", tokenFile: tok }]))).toThrow(/http/);
    expect(() => loadConfig(env([{ server: "lab", url: "http://a", tokenFile: tok }, { server: "lab", url: "http://b", tokenFile: tok }]))).toThrow(/one entry/);
    expect(() => loadConfig(env([{ server: "lab", url: "http://a", tokenFile: empty }]))).toThrow(/empty/);
    expect(() => loadConfig(env([], { PORT: "0" }))).toThrow(/PORT/);
  });
});

describe("actions config", () => {
  it("actionsConfig: an https origin and lower-cased actors; dev defaults to loopback", () => {
    expect(actionsConfig({ PUBLIC_ORIGIN: "https://control.hetops.dev/", ACTORS: " Het@HetOps.dev , " })).toEqual({ origin: "https://control.hetops.dev", actors: ["het@hetops.dev"] });
    expect(actionsConfig({})).toEqual({ origin: "", actors: [] });                                   // actions off
    expect(actionsConfig({ PUBLIC_ORIGIN: "https://control.hetops.dev" })).toEqual({ origin: "https://control.hetops.dev", actors: [] });   // ACTORS unset: nobody acts
    expect(() => actionsConfig({ PUBLIC_ORIGIN: "http://control.hetops.dev", ACTORS: "a@b.c" })).toThrow("PUBLIC_ORIGIN must be https");
    expect(actionsConfig({ CONTROL_DEV: "1", HOST: "127.0.0.1", PORT: "8080" }).origin).toBe("http://127.0.0.1:8080");
  });
});
