import { readFileSync } from "node:fs";
import { ServerIdSchema } from "@hetops-control/contracts";

export function loadConfig(env = process.env) {
  const server = ServerIdSchema.parse(env.SERVER);
  if (!env.AGENT_TOKEN_FILE) throw new Error("AGENT_TOKEN_FILE is required");
  const token = readFileSync(env.AGENT_TOKEN_FILE, "utf8").trim();
  if (!token) throw new Error("agent token file is empty");
  const https = env.TLS_CERT_FILE && env.TLS_KEY_FILE
    ? { cert: readFileSync(env.TLS_CERT_FILE, "utf8"), key: readFileSync(env.TLS_KEY_FILE, "utf8") } : undefined;
  return { server, token, https, port: Number(env.PORT ?? 7443), host: env.HOST ?? "0.0.0.0" };
}
