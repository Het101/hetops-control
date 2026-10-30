<script lang="ts">
  import type { Snippet } from "svelte";
  // a designed empty or error state inside a module: a quiet outline glyph, one line of what is missing, one of what will appear
  let { title, warm = false, children }: { title: string; warm?: boolean; children?: Snippet } = $props();
</script>

<div class="wait" class:warm role={warm ? "alert" : undefined}>
  <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 5"/>
    <circle cx="20" cy="20" r="3" fill="currentColor"/></svg>
  <div><b>{title}</b>{#if children}<span>{@render children()}</span>{/if}</div>
</div>
