import type { Source } from "../registry.js";
import { argoSource } from "./argo.js";
import { elasticsearchSource, realEs, snapshotsSource } from "./elasticsearch.js";
import { gatusSource, realGatus } from "./gatus.js";
import { hostloadSource } from "./hostload.js";
import { kubernetesSource, type KubeReader } from "./kubernetes.js";

// Gatus and Elasticsearch live on hetops-3 only: their sources run where their URL is set (the ops agent).
export const buildSources = (kube: KubeReader, env: NodeJS.ProcessEnv = process.env): Source[] => {
  const es = env.ES_URL ? realEs(new URL(env.ES_URL).origin, env.ES_AUTH_DIR ?? "/secrets/es") : undefined;
  return [kubernetesSource(kube), argoSource(kube), hostloadSource(kube),
    ...(env.GATUS_URL ? [gatusSource(realGatus(new URL(env.GATUS_URL).origin))] : []),
    ...(es ? [elasticsearchSource(es), snapshotsSource(es)] : [])];
};
