import type { ActionRun, Entity } from "@hetops-control/contracts";
import type { Descriptor, Offer } from "./actions.js";

/** The one open action dialog, the descriptors the center advertises, and the latest runs (the toasts). */
export const ui = $state<{ open?: Offer & { entity: Entity } }>({});
export const catalog = $state<{ list: Descriptor[] }>({ list: [] });
export const runs = $state<{ list: ActionRun[] }>({ list: [] });
export function track(r: ActionRun) {
  const held = runs.list.find(x => x.id === r.id);
  if (held && held.state !== "running" && r.state === "running") return;   // a late POST answer never undoes the streamed result
  runs.list = [r, ...runs.list.filter(x => x.id !== r.id)].slice(0, 4);
}
export const dismiss = (id: string) => { runs.list = runs.list.filter(x => x.id !== id); };
