import type { Source } from "../registry.js";
import { argoSource } from "./argo.js";
import { hostloadSource } from "./hostload.js";
import { kubernetesSource, type KubeReader } from "./kubernetes.js";

export const buildSources = (kube: KubeReader): Source[] => [kubernetesSource(kube), argoSource(kube), hostloadSource(kube)];
