<script lang="ts">
  import type { Entity, ServerView } from "@hetops-control/contracts";
  import type { Headline } from "../lib/api.js";
  import { catalog } from "../lib/action-state.svelte.js";
  import { ranked } from "../lib/needs.js";
  import NeedRow from "./NeedRow.svelte";
  // The hero's ranked list: the worst first, three at most; the rest are a click away in the queue (n), not stacked here
  let { needs, entities, servers, max = 3 }: { needs: Headline["needs"]; entities: Entity[]; servers: Record<string, ServerView>; max?: number } = $props();
  const rows = $derived(ranked(needs, entities, servers, catalog.list));
  const openQueue = () => document.querySelector<HTMLButtonElement>("button.q-pill")?.click();
</script>

<div class="needs pressed">
  <h2 class:calm={!needs.length}>Needs you · {needs.length}</h2>
  {#each rows.slice(0, max) as r, i (r.n.entity + i)}
    <NeedRow row={r} rank={max > 3 ? i + 1 : undefined} />
  {:else}
    <div class="need-none">Nothing is waiting on you.</div>
  {/each}
  {#if rows.length > max}<button type="button" class="need-more" onclick={openQueue}>{rows.length - max} more in the queue <kbd>n</kbd></button>{/if}
</div>
