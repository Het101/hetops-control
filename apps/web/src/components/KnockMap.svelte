<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import { knocks, LAB_AT, landDots, project } from "../lib/pages.js";
  import { reduced } from "../lib/motion.js";
  import { windy } from "../lib/wind.js";
  import Later from "./Later.svelte";
  // the who-knocks dotted map: CrowdSec bans in silver, sized by count (a ban needs no one, so never ember); the lab in white
  let { decisions, w, h, step, labels = true }: { decisions: Entity[]; w: number; h: number; step: number; labels?: boolean } = $props();
  // every land dot in one path (two half-circle arcs each): one element to lay out and paint, not hundreds
  const land = $derived.by(() => { const r = 1.5 * Math.max(w / 800, .8); return landDots(w, h, step).map(([x, y]) => `M${(x - r).toFixed(2)} ${y.toFixed(2)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`).join(""); });
  const lab = $derived(project(LAB_AT[0], LAB_AT[1], w, h));
  const map = $derived(knocks(decisions, w, h));
  const top = $derived(Math.max(1, ...map.placed.map(p => p.n)));
  const k = $derived(w / 800); // marks scale with the map
</script>

<!-- two layers in one box: the land, drawn once as a single path on a layer of its own that never repaints, and the marks,
     which the shared 30 Hz scene clock moves (lib/wind.ts) -->
<div class="world" style:aspect-ratio={`${w} / ${h}`}>
  <!-- the box holds its size, so the map can be drawn a slice later -->
  <Later>
  <svg class="land" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={land} fill="#4e4f54"/></svg>
  <svg class="marks" viewBox={`0 0 ${w} ${h}`} use:windy={{ on: !$reduced, key: map }} role="img" aria-label={decisions.length ? `Banned sources by country: ${map.placed.map(p => `${p.country} ${p.n}`).join(", ")}` : "World map; no decisions reported"}>
    {#each map.placed as p, i (p.country)}
      {@const r = (3 + 7 * Math.sqrt(p.n / top)) * Math.max(k, .6)}
      {#if !$reduced}<circle class="knock-ring" data-wind="ring" data-f="2.6" stroke-opacity="0" data-ph={(i * .33) % 2.6} data-ox={p.x} data-oy={p.y} cx={p.x} cy={p.y} {r}/>{/if}
      <circle cx={p.x} cy={p.y} r={r * .55} class="knock" data-wind="breathe" data-f="3.6" data-ph={-((i * .7) % 3.6)} data-ox={p.x} data-oy={p.y}><title>{p.country}: {p.n} banned</title></circle>
      {#if labels && p.n / top > .3}<text x={p.x + r + 3} y={p.y + 3} class="knock-l">{p.country} {p.n}</text>{/if}
    {/each}
    <!-- a slow radar sweep out from the lab: two rings, half a period apart -->
    {#if !$reduced}{#each [0, 1] as n (n)}<circle class="scan" data-wind="scan" data-f="6" data-ph={n * 3} data-ox={lab[0]} data-oy={lab[1]} stroke-opacity="0" cx={lab[0]} cy={lab[1]} r={Math.min(w, h * 2.4) * .3}/>{/each}{/if}
    <circle cx={lab[0]} cy={lab[1]} r={9 * Math.max(k, .6)} class="lab-ring"/><circle cx={lab[0]} cy={lab[1]} r={4 * Math.max(k, .7)} class="lab-dot"/>
    {#if labels}<text x={lab[0] + 12} y={lab[1] + 4} class="lab-l">LAB</text>{/if}
  </svg>
  </Later>
</div>
