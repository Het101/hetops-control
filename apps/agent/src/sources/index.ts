import type { Source } from "../registry.js";
import { alertmanagerSource, realAlertmanager } from "./alertmanager.js";
import { argoSource } from "./argo.js";
import { bedrockSource, realBedrock } from "./bedrock.js";
import { realChaos, sloSource } from "./chaos.js";
import { crowdsecSource, realCrowdsec } from "./crowdsec.js";
import { elasticsearchSource, realEs, snapshotsSource } from "./elasticsearch.js";
import { gatusSource, realGatus } from "./gatus.js";
import { hostloadSource } from "./hostload.js";
import { kubernetesSource, type KubeReader } from "./kubernetes.js";
import { realTimeline, timelineSource } from "./timeline.js";

// Each tool-specific source runs where its URL is set: Gatus and Elasticsearch on the ops agent, the rest on the lab agent.
export const buildSources = (kube: KubeReader, env: NodeJS.ProcessEnv = process.env): Source[] => {
  const origin = (v: string) => new URL(v).origin;
  const es = env.ES_URL ? realEs(origin(env.ES_URL), env.ES_AUTH_DIR ?? "/secrets/es") : undefined;
  return [kubernetesSource(kube), argoSource(kube), hostloadSource(kube),
    ...(env.GATUS_URL ? [gatusSource(realGatus(origin(env.GATUS_URL)))] : []),
    ...(es ? [elasticsearchSource(es), snapshotsSource(es)] : []),
    ...(env.ALERTMANAGER_URL ? [alertmanagerSource(realAlertmanager(origin(env.ALERTMANAGER_URL)))] : []),
    ...(env.CHAOS_URL ? [sloSource(realChaos(origin(env.CHAOS_URL)))] : []),
    ...(env.TIMELINE_URL ? [timelineSource(realTimeline(origin(env.TIMELINE_URL)))] : []),
    ...(env.CROWDSEC_URL ? [crowdsecSource(realCrowdsec(origin(env.CROWDSEC_URL),
      env.CROWDSEC_KEY_FILE ?? "/secrets/crowdsec/key", env.CROWDSEC_CA_FILE ?? "/etc/crowdsec-ca/ca.crt"))] : []),
    ...(env.BEDROCK_DIR ? [bedrockSource(realBedrock(env.BEDROCK_DIR))] : [])];
};
