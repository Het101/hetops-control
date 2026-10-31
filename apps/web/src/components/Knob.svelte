<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import { catalog, ui } from "../lib/action-state.svelte.js";
  import { offer } from "../lib/actions.js";
  // a round action knob: it acts when its entity offers the action; otherwise it stays focusable, dimmed, and says why
  let { entity, action, label, warm = false }: { entity: Entity; action?: string; label: string; warm?: boolean } = $props();
  const o = $derived(offer(entity, action, catalog.list));
  const why = $derived(o ? label : `${label}: not offered for this one`);
</script>

<button type="button" class="knob act" class:ember={warm && !!o} class:raised={!warm || !o} aria-disabled={o ? undefined : "true"} title={why} aria-label={why}
  onclick={e => { e.stopPropagation(); if (o) ui.open = { entity, ...o }; }}>
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
