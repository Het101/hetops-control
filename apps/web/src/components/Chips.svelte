<script lang="ts">
  // a filter group: toggle chips, none pressed = everything; counts come from the data, never invented
  let { label, options, selected = $bindable([]), name }: { label: string; options: { v: string; n?: number; label?: string }[]; selected?: string[]; name?: (v: string) => string } = $props();
  const flip = (v: string) => { selected = selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]; };
</script>

{#if options.length}
  <div class="chips" role="group" aria-label={label}>
    <span class="chips-l">{label}</span>
    {#each options as o (o.v)}
      <button type="button" class="chip" class:on={selected.includes(o.v)} aria-pressed={selected.includes(o.v)} onclick={() => flip(o.v)}>
        {o.label ?? name?.(o.v) ?? o.v}{#if o.n !== undefined}<i>{o.n}</i>{/if}</button>
    {/each}
  </div>
{/if}
