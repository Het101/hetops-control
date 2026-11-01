<script lang="ts">
  import type { Snippet } from "svelte";
  import { route } from "../lib/router.svelte.js";
  let { label, href, spill = false, children }: { label: string; href: string; spill?: boolean; children: Snippet } = $props();
  const active = $derived(route.path === href);
</script>

<a class="nav" class:spill class:on={active} class:pressed={active} class:raised={!active} {href} aria-label={label} aria-current={active ? "page" : undefined}>
  <span class="tip" aria-hidden="true">{label}</span>{@render children()}</a>
