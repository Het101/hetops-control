import { loadConfig } from "./config.js";
import { Registry } from "./registry.js";
import { buildServer } from "./server.js";
import { buildSources } from "./sources/index.js";
import { realKube } from "./sources/kubernetes.js";
import { actionRunner, buildActions } from "./actions/index.js";

const cfg = loadConfig();
const actions = buildActions();          // throws on an unknown or unconfigured name: the pod fails to start, visibly
const reg = new Registry(cfg.server, buildSources(realKube()), undefined, actions);
reg.start();
const app = buildServer(reg, cfg.token, { ...(cfg.https ? { https: cfg.https } : {}), run: actionRunner(reg, actions) });
await app.listen({ port: cfg.port, host: cfg.host });
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { reg.stop(); void app.close().then(() => process.exit(0)); });
