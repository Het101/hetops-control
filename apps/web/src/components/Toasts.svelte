<script lang="ts">
  import { dismiss, runs } from "../lib/action-state.svelte.js";
  // a success leaves after 8 s; a failure needs you, so it stays (ember) until dismissed
  $effect(() => {
    const done = runs.list.filter(r => r.state === "succeeded").map(r => r.id);
    if (!done.length) return;
    const t = setTimeout(() => done.forEach(dismiss), 8000);
    return () => clearTimeout(t);
  });
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each runs.list as r (r.id)}
    <div class="toast raised" class:warm={r.state === "failed"} data-state={r.state}>
      <span class="toast-dot" aria-hidden="true"></span>
      <span class="toast-t">{r.label} {r.targetName}<small>{r.server} · {r.state === "running" ? "asking…" : r.result?.summary ?? r.error ?? r.state}</small></span>
      {#if r.state !== "running"}<button type="button" class="toast-x" aria-label="Dismiss" onclick={() => dismiss(r.id)}>×</button>{/if}
    </div>
  {/each}
</div>
