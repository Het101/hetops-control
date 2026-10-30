<script lang="ts">
  import type { Snippet } from "svelte";
  let { label, href, active = false, children }: { label: string; href?: string; active?: boolean; children: Snippet } = $props();
</script>

<!-- pages that do not exist yet keep their icon and motion, but are not links -->
<a class="nav" class:on={active} class:pressed={active} class:raised={!active} href={href} aria-label={label}
   aria-current={active ? "page" : undefined} aria-disabled={href ? undefined : "true"} tabindex={href ? undefined : 0}>
  <span class="tip">{label}{#if !href}<small>arrives in stage 1b</small>{/if}</span>
  {@render children()}
</a>
