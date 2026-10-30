import { accessConfig, loadConfig } from "./config.js";
import { Store } from "./store.js";
import { EventsDb } from "./events-db.js";
import { AgentLink } from "./agents.js";
import { verifyAccess } from "./access.js";
import { buildCenter } from "./server.js";

const cfg = loadConfig(); const acc = accessConfig();
const store = new Store(); const db = new EventsDb(cfg.dbPath);
const prune = () => { try { db.prune(); } catch (e) { console.error("prune failed:", e instanceof Error ? e.message : String(e)); } };
prune(); const pruneTimer = setInterval(prune, 86_400_000);
const links = cfg.agents.map(a => new AgentLink(a.server, a.url, a.token, a.ca));
for (const l of links) l.start(store, db);
const app = buildCenter({ store, db, webRoot: process.env.WEB_ROOT ?? "/app/web",
  access: acc.dev ? (async () => ({ email: "dev@local" })) : ((jwt) => verifyAccess(jwt, acc)) });
await app.listen({ port: cfg.port, host: cfg.host });
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => {
  clearInterval(pruneTimer); for (const l of links) l.stop();
  void app.close().then(() => { db.close(); process.exit(0); });
});
