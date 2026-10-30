import { readFileSync } from "node:fs";
import { ServerIdSchema } from "@hetops-control/contracts";

export function loadConfig(env = process.env) {
  const server = ServerIdSchema.parse(env.SERVER);
  if (!env.AGENT_TOKEN_FILE) throw new Error("AGENT_TOKEN_FILE is required");
  const token = readFileSync(env.AGENT_TOKEN_FILE, "utf8").trim();
  if (!token) throw new Error("agent token file is empty");
  if (!env.TLS_CERT_FILE !== !env.TLS_KEY_FILE) throw new Error("TLS_CERT_FILE and TLS_KEY_FILE must be set together");
  const port = Number(env.PORT ?? 7443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");
  const https = env.TLS_CERT_FILE && env.TLS_KEY_FILE
    ? { cert: readFileSync(env.TLS_CERT_FILE, "utf8"), key: readFileSync(env.TLS_KEY_FILE, "utf8") } : undefined;
  return { server, token, https, port, host: env.HOST ?? "0.0.0.0" };
}
