<script lang="ts">
  import type { Snippet } from "svelte";
  let { label, href, active = false, children }: { label: string; href?: string; active?: boolean; children: Snippet } = $props();
</script>

<!-- pages that do not exist yet keep their icon and motion as a focusable, disabled button -->
{#if href}
  <a class="nav" class:on={active} class:pressed={active} class:raised={!active} {href} aria-label={label} aria-current={active ? "page" : undefined}>
    <span class="tip" aria-hidden="true">{label}</span>{@render children()}</a>
{:else}
  <button type="button" class="nav raised" aria-disabled="true" aria-label={`${label}: arrives in stage 1b`}>
    <span class="tip" aria-hidden="true">{label}<small>arrives in stage 1b</small></span>{@render children()}</button>
{/if}
