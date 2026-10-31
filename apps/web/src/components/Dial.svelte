<script lang="ts">
  import { countUp } from "../lib/motion.js";
  // value: CPU % (undefined = no reading); hot = ember arc
  let { id, label, value, hot = false, children }: { id: string; label: string; value: number | undefined; hot?: boolean; children?: import("svelte").Snippet } = $props();

  const cx = 48, cy = 48, r = 40, C = 2 * Math.PI * r, span = .75, full = C * span;
  const ticks = Array.from({ length: 13 }, (_, t) => { const a = (135 + 270 * t / 12) * Math.PI / 180;
    return { x1: cx + (r - 9) * Math.cos(a), y1: cy + (r - 9) * Math.sin(a), x2: cx + (r - 6) * Math.cos(a), y2: cy + (r - 6) * Math.sin(a) }; });
  const offset = $derived(full * (1 - Math.min(Math.max(value ?? 0, 0), 100) / 100));
</script>

<div class="dial">
  <div class="face pressed">
    <svg viewBox="0 0 96 96">
      <circle {cx} {cy} {r} stroke="#1f2023" stroke-width="6" fill="none" stroke-dasharray={`${full} ${C}`} stroke-linecap="round" transform={`rotate(135 ${cx} ${cy})`}/>
      {#each ticks as t}<line {...t} stroke="#56575c" stroke-width="1"/>{/each}
      {#if hot}<linearGradient id={`hg-${id}`} x1="0" x2="1"><stop offset="0" stop-color="#c2391a"/><stop offset="1" stop-color="#ff9a3c"/></linearGradient>{/if}
      <circle class="arc" {cx} {cy} {r} stroke={hot ? `url(#hg-${id})` : "#d8d6d0"} stroke-width="6" fill="none" stroke-dasharray={`${full} ${C}`}
        stroke-linecap="round" transform={`rotate(135 ${cx} ${cy})`}
        style={`stroke-dashoffset:${offset};--full:${full};--off:${offset}px;--over:${Math.max(0, offset - 7)}px${hot ? ";filter:drop-shadow(0 0 5px rgba(242,88,42,.6))" : ""}`}/>
    </svg>
    {#if value === undefined}<b class="none">—</b>{:else}<b><span use:countUp={Math.round(value)}></span>%</b>{/if}
  </div>
  {label}
  {@render children?.()}
</div>
