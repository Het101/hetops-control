<script lang="ts">
  // a round action knob that is not wired yet: focusable, dimmed, and honest about when it arrives
  let { label, stage = 2, warm = false }: { label: string; stage?: number; warm?: boolean } = $props();
</script>

<button type="button" class="knob act" class:ember={warm} class:raised={!warm} aria-disabled="true" title={`${label}: arrives in stage ${stage}`}
  aria-label={`${label}: arrives in stage ${stage}`} onclick={e => e.stopPropagation()}>
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
