import { createRemoteJWKSet, jwtVerify } from "jose";

type Jwks = ReturnType<typeof createRemoteJWKSet>;
const jwksByUrl = new Map<string, Jwks>(); // one remote set per URL: jose caches the keys inside it

/** Verifies a Cloudflare Access JWT; throws on anything missing or invalid. jwksUrl exists for tests. */
export async function verifyAccess(jwt: string | undefined, cfg: { teamDomain: string; aud: string; jwksUrl?: string }): Promise<{ email: string }> {
  if (!jwt) throw new Error("no token");
  const url = cfg.jwksUrl ?? `https://${cfg.teamDomain}/cdn-cgi/access/certs`;
  let jwks = jwksByUrl.get(url);
  if (!jwks) jwksByUrl.set(url, jwks = createRemoteJWKSet(new URL(url)));
  const { payload } = await jwtVerify(jwt, jwks, { audience: cfg.aud, issuer: `https://${cfg.teamDomain}` });
  if (typeof payload.email !== "string" || !payload.email) throw new Error("token has no email");
  return { email: payload.email };
}
