<script lang="ts">
  import type { Headline } from "../lib/api.js";
  let { needs }: { needs: Headline["needs"] } = $props();
</script>

<div class="needs pressed">
  <h3 class:calm={!needs.length}>NEEDS YOU · {needs.length}</h3>
  {#each needs as n, i (i)}
    <div class="need"><div class="txt">{n.text}<small>{n.detail}</small></div>
      <!-- aria-disabled, not disabled: it stays focusable so keyboard users can reach its explanation -->
      <button type="button" class="ember-btn" aria-disabled="true" title="actions arrive in stage 2"
        aria-label={`${n.action?.label ?? "Act"}: actions arrive in stage 2`}>
        <svg viewBox="0 0 24 24" fill="#2a1408" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button></div>
  {:else}
    <div class="need-none">Nothing is waiting on you.</div>
  {/each}
</div>
