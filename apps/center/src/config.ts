import { readFileSync } from "node:fs";
import { z } from "zod";
import { ServerIdSchema } from "@hetops-control/contracts";

const AgentsSchema = z.array(z.object({ server: ServerIdSchema, url: z.string().url().refine(u => /^https?:\/\//.test(u), "http(s) only"),
  tokenFile: z.string().min(1), caFile: z.string().min(1).optional() }).strict())
  .refine(a => new Set(a.map(x => x.server)).size === a.length, "one entry per server");

/** AGENTS = JSON [{server, url, tokenFile, caFile?}]; secrets are read from files, never from the environment. */
export function loadConfig(env = process.env) {
  let raw: unknown;
  try { raw = JSON.parse(env.AGENTS ?? "[]"); } catch { throw new Error("AGENTS must be a JSON array"); }
  const parsed = AgentsSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`AGENTS is invalid: ${parsed.error.issues.map(i => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`);
  const agents = parsed.data.map(a => {
    const token = readFileSync(a.tokenFile, "utf8").trim();
    if (!token) throw new Error(`token file for ${a.server} is empty`);
    return { server: a.server, url: a.url.replace(/\/+$/, ""), token, ...(a.caFile ? { ca: readFileSync(a.caFile) } : {}) };
  });
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");
  return { agents, dbPath: env.DB_PATH ?? "/data/events.db", port, host: env.HOST ?? "0.0.0.0" };
}

/** Cloudflare Access settings; CONTROL_DEV=1 skips them, but only when listening on loopback. */
export function accessConfig(env = process.env): { dev: true } | { dev: false; teamDomain: string; aud: string } {
  if (env.CONTROL_DEV === "1") {
    if (env.HOST !== "127.0.0.1") throw new Error("CONTROL_DEV=1 is only allowed with HOST=127.0.0.1");
    return { dev: true };
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new Error("ACCESS_TEAM_DOMAIN and ACCESS_AUD are required");
  return { dev: false, teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD };
}
