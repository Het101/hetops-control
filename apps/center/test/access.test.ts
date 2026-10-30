import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { verifyAccess } from "../src/access.js";

let srv: Server, priv: KeyLike, cfg: { teamDomain: string; aud: string; jwksUrl?: string };
beforeAll(async () => {
  const kp = await generateKeyPair("RS256"); priv = kp.privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  srv = createServer((_, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
  cfg = { teamDomain: `127.0.0.1:${(srv.address() as { port: number }).port}`, aud: "aud1", jwksUrl: `http://127.0.0.1:${(srv.address() as { port: number }).port}/certs` };
});
afterAll(() => { srv.close(); });
const sign = (o: { aud?: string; exp?: string | number; iss?: string; claims?: Record<string, unknown> } = {}) => new SignJWT(o.claims ?? { email: "me@x.dev" }).setProtectedHeader({ alg: "RS256", kid: "k1" })
  .setAudience(o.aud ?? "aud1").setIssuer(o.iss ?? `https://${cfg.teamDomain}`).setIssuedAt().setExpirationTime(o.exp ?? "5m").sign(priv);

describe("verifyAccess", () => {
  it("accepts a valid token", async () => { expect(await verifyAccess(await sign(), cfg)).toEqual({ email: "me@x.dev" }); });
  it("rejects wrong audience", async () => { await expect(verifyAccess(await sign({ aud: "other" }), cfg)).rejects.toThrow(); });
  it("rejects expired", async () => { await expect(verifyAccess(await sign({ exp: Math.floor(Date.now() / 1000) - 3600 }), cfg)).rejects.toThrow(); });
  it("rejects a wrong issuer", async () => { await expect(verifyAccess(await sign({ iss: "https://evil.example" }), cfg)).rejects.toThrow(); });
  it("rejects a token without email (service tokens)", async () => { await expect(verifyAccess(await sign({ claims: { common_name: "svc" } }), cfg)).rejects.toThrow(/email/); });
  it("rejects missing", async () => { await expect(verifyAccess(undefined, cfg)).rejects.toThrow(); });
});
