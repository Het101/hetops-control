<script lang="ts">
  import type { NeedRow } from "../lib/needs.js";
  import { ui } from "../lib/action-state.svelte.js";
  // One need, drawn the same everywhere: its severity (a filled ember dot is down, a ring needs a look, hollow can't be seen),
  // what and why, and its one move: the action its entity offers, named, or the page to open. Never a button that does nothing.
  let { row, rank }: { row: NeedRow; rank?: number } = $props();
</script>

<div class="need-row" data-sev={row.sev} data-entity={row.n.entity}>
  {#if rank !== undefined}<span class="need-rank mono" aria-hidden="true">{rank}</span>{/if}
  <i class="need-sev" aria-hidden="true"></i>
  <div class="need-t"><span class="need-w mono">{row.word}</span>{row.n.text}<small>{row.n.detail}</small></div>
  {#if row.o && row.e}
    <button type="button" class="need-act" onclick={() => { ui.open = { entity: row.e!, ...row.o! }; }}
      aria-label={`${row.o.descriptor.label} ${row.e.name}`}>{row.o.descriptor.label}</button>
  {:else}
    <a class="need-go" href={row.page.href} aria-label={`${row.n.text}: open ${row.page.label}`}>Open {row.page.label}{" "}<span aria-hidden="true">→</span></a>
  {/if}
</div>
