import { describe, it, expect, afterAll } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { json } from "../src/sources/http.js";
import { realArgo } from "../src/actions/argo.js";

// A server that never answers: only the caller's signal can end a call to it (well before the helper's own 10 s timeout).
const hung = createServer(() => {});
const base = new Promise<string>(r => hung.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(hung.address() as AddressInfo).port}`)));
afterAll(() => { hung.closeAllConnections(); hung.close(); });
const abortSoon = () => { const ac = new AbortController(); setTimeout(() => ac.abort(), 50); return ac.signal; };

describe("the action's signal reaches the wire", () => {
  it("the http helper stops when the caller aborts", async () => {
    const t = Date.now();
    await expect(json(`${await base}/x`, { signal: abortSoon() })).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(2_000);
  });
  it("the Argo CD client stops when the caller aborts", async () => {
    const server = await base;
    const api = realArgo(kc => kc.loadFromOptions({ clusters: [{ name: "c", server, skipTLSVerify: true }], users: [{ name: "u" }],
      contexts: [{ name: "x", cluster: "c", user: "u" }], currentContext: "x" }));
    const t = Date.now();
    await expect(api.get("cert-manager", abortSoon())).rejects.toThrow();
    await expect(api.patch("cert-manager", {}, abortSoon())).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(4_000);
  });
});
