<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import { catalog, ui } from "../lib/action-state.svelte.js";
  import { offer } from "../lib/actions.js";
  // An action knob. When its entity offers the action it is a raised pill that names its verb ("▸ Sync"), so what can run reads
  // at a glance; when it does not, it is flat, hollow and dashed, still focusable, and says why. named=false: the verb sits beside
  // it already (the drawer's action list), so the knob stays round.
  let { entity, action, label, warm = false, named = true }: { entity: Entity; action?: string; label: string; warm?: boolean; named?: boolean } = $props();
  const o = $derived(offer(entity, action, catalog.list));
  const why = $derived(o ? label : `${label}: not offered for this one`);
  const verb = $derived(named && o ? o.descriptor.label : undefined);
</script>

<button type="button" class="knob act" class:named={!!verb} class:off={!o} class:ember={warm && !!o} class:raised={!!o && !warm}
  aria-disabled={o ? undefined : "true"} title={why} aria-label={why}
  onclick={e => { e.stopPropagation(); if (o) ui.open = { entity, ...o }; }}>
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>{#if verb}<span aria-hidden="true">{verb}</span>{/if}</button>
