<script lang="ts">
  import type { Headline } from "../lib/api.js";
  let { needs }: { needs: Headline["needs"] } = $props();
</script>

<div class="needs pressed">
  <h3 class:calm={!needs.length}>NEEDS YOU · {needs.length}</h3>
  {#each needs as n}
    <div class="need"><div class="txt">{n.text}<small>{n.detail}</small></div>
      <button class="ember-btn" disabled title="actions arrive in stage 2" aria-label={`${n.action?.label ?? "Act"} (actions arrive in stage 2)`}>
        <svg viewBox="0 0 24 24" fill="#2a1408"><path d="M8 5v14l11-7z"/></svg></button></div>
  {:else}
    <div class="need-none">Nothing is waiting on you.</div>
  {/each}
</div>
