import type { ActionRun, Entity } from "@hetops-control/contracts";
import { merge, toastOf, type Descriptor, type Offer } from "./actions.js";

/** The one open action dialog, the descriptors the center advertises, and the latest runs (the toasts). */
export const ui = $state<{ open?: Offer & { entity: Entity } }>({});
export const catalog = $state<{ list: Descriptor[] }>({ list: [] });
export const runs = $state<{ list: ActionRun[] }>({ list: [] });
/** What the two live regions say: a failure interrupts (assertive), everything else waits its turn (polite). */
export const said = $state({ polite: "", assertive: "" });
export function track(r: ActionRun) {
  const next = merge(runs.list, r);
  if (next === runs.list) return;
  runs.list = next;
  const t = toastOf(r), text = [t.title, t.detail, t.line].filter(Boolean).join(". ");
  if (t.tone === "failed") said.assertive = text; else said.polite = text;
}
export const dismiss = (id: string) => { runs.list = runs.list.filter(x => x.id !== id); };
