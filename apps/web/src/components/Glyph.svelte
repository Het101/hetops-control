<script lang="ts">
  // one small mark per event kind, so a scan of the feed reads before the words do
  let { kind, warm = false }: { kind: string; warm?: boolean } = $props();
</script>

<span class="glyph pressed" class:warm aria-hidden="true">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    {#if kind === "deploy"}<path d="M12 19V6"/><path d="m7 11 5-5 5 5"/><path d="M6 20h12"/>
    {:else if kind === "sync"}<path d="M5 9a7 7 0 0 1 12-3l2 2"/><path d="M19 4v4h-4"/><path d="M19 15a7 7 0 0 1-12 3l-2-2"/><path d="M5 20v-4h4"/>
    {:else if kind === "restart"}<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>
    {:else if kind === "status"}<circle cx="12" cy="12" r="7"/><path d="M12 5a7 7 0 0 1 0 14z" fill="currentColor"/>
    {:else if kind === "action"}<circle cx="12" cy="12" r="7.5"/><path d="M12 12 15.5 8.5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>
    {:else}<circle cx="12" cy="12" r="2.4" fill="currentColor"/>{/if}
  </svg>
</span>
