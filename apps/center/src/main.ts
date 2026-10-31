import { accessConfig, actionsConfig, loadConfig } from "./config.js";
import { Store } from "./store.js";
import { EventsDb } from "./events-db.js";
import { startLinks } from "./agents.js";
import { verifyAccess } from "./access.js";
import { buildCenter } from "./server.js";
import { Actions, ActionError, centerState } from "./actions.js";
import { gatusAck } from "./ack.js";

const cfg = loadConfig(); const acc = accessConfig(); const ac = actionsConfig();
const store = new Store(undefined, cfg.agents.map(a => a.server)); const db = new EventsDb(cfg.dbPath);
const prune = () => { try { db.prune(); } catch (e) { console.error("prune failed:", e instanceof Error ? e.message : String(e)); } };
prune(); const pruneTimer = setInterval(prune, 86_400_000);
const abandoned = db.abandonRunning(new Date().toISOString());
if (abandoned) console.error(`actions: ${abandoned} run(s) were still running when the center stopped; closed as failed (result unknown)`);
// every link is started (which loads its CA) before Actions exists, so no post can reach an unstarted link
const links = startLinks(cfg.agents, store, db);
if (!ac.origin) console.error("actions: off (PUBLIC_ORIGIN is not set)");
else if (!ac.actors.length) console.error("actions: nobody may act (ACTORS is empty)");
else console.error(`actions: ${ac.actors.length} actor(s) may act from ${ac.origin}`);
const local = [gatusAck(db)];
const actions = new Actions({ state: () => centerState(store, db, local), db, local, actors: ac.actors,
  call: (server, path, body, signal) => { const l = links.get(server); if (!l) throw new ActionError(409, `${server} has no agent`); return l.post(path, body, signal); },
  publish: ({ run, event }) => { if (event) store.record(event); if (run) store.announce(run); } });
const app = buildCenter({ store, db, local, actions, origin: ac.origin, webRoot: process.env.WEB_ROOT ?? "/app/web", version: process.env.VERSION ?? "dev",
  access: acc.dev ? (async () => ({ email: "dev@local" })) : ((jwt) => verifyAccess(jwt, acc)) });
await app.listen({ port: cfg.port, host: cfg.host });
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => {
  clearInterval(pruneTimer); for (const l of links.values()) l.stop();
  setTimeout(() => process.exit(1), 10_000).unref();
  app.close().then(() => { db.close(); process.exit(0); }, () => process.exit(1));
});
