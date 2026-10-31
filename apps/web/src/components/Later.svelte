<script lang="ts">
  import type { Snippet } from "svelte";
  import { later } from "../lib/later.js";
  // renders its children in a later idle slice; no element of its own, so it never changes the layout around it. Use it
  // only where the space is already reserved (a box with a fixed or aspect-ratio size) or at the foot of the page.
  let { children }: { children: Snippet } = $props();
  let ready = $state(false);
  $effect(() => { let live = true; later(() => { if (live) ready = true; }); return () => { live = false; }; });
</script>

{#if ready}{@render children()}{/if}
