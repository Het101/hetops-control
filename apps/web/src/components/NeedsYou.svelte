<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import type { Headline } from "../lib/api.js";
  import { catalog, ui } from "../lib/action-state.svelte.js";
  import { offer } from "../lib/actions.js";
  let { needs, entities }: { needs: Headline["needs"]; entities: Entity[] } = $props();
  const act = (n: Headline["needs"][number]) => {
    const e = entities.find(x => x.id === n.entity), o = e && n.action ? offer(e, n.action.id, catalog.list) : undefined;
    return e && o ? { entity: e, ...o } : undefined;
  };
</script>

<div class="needs pressed">
  <h3 class:calm={!needs.length}>NEEDS YOU · {needs.length}</h3>
  {#each needs as n, i (i)}
    {@const a = act(n)}
    <div class="need"><div class="txt">{n.text}<small>{n.detail}</small></div>
      <!-- aria-disabled, not disabled: a need without an action stays focusable so keyboard users hear why -->
      <button type="button" class="ember-btn" aria-disabled={a ? undefined : "true"}
        title={a ? `${a.ref.label} ${a.entity.name}` : "No action for this one here: open its page to look"}
        aria-label={a ? `${a.ref.label} ${a.entity.name}` : `${n.text}: no action to take here`} onclick={() => { if (a) ui.open = a; }}>
        <svg viewBox="0 0 24 24" fill="#2a1408" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button></div>
  {:else}
    <div class="need-none">Nothing is waiting on you.</div>
  {/each}
</div>
