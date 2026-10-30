<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import { knocks, LAB_AT, landDots, project } from "../lib/pages.js";
  import { reduced } from "../lib/motion.js";
  // the who-knocks dotted map: CrowdSec bans in silver, sized by count (a ban needs no one, so never ember); the lab in white
  let { decisions, w, h, step, labels = true }: { decisions: Entity[]; w: number; h: number; step: number; labels?: boolean } = $props();
  const dots = $derived(landDots(w, h, step));
  const lab = $derived(project(LAB_AT[0], LAB_AT[1], w, h));
  const map = $derived(knocks(decisions, w, h));
  const top = $derived(Math.max(1, ...map.placed.map(p => p.n)));
  const k = $derived(w / 800); // marks scale with the map
</script>

<svg class="world" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={decisions.length ? `Banned sources by country: ${map.placed.map(p => `${p.country} ${p.n}`).join(", ")}` : "World map; no decisions reported"}>
  {#each dots as [x, y], i (i)}<circle cx={x} cy={y} r={1.5 * Math.max(k, .8)} fill="#4e4f54"/>{/each}
  {#each map.placed as p, i (p.country)}
    {@const r = (3 + 7 * Math.sqrt(p.n / top)) * Math.max(k, .6)}
    {#if !$reduced}<circle class="knock-ring" cx={p.x} cy={p.y} {r} style={`--dl:${(i * .33) % 2.6}s`}/>{/if}
    <circle cx={p.x} cy={p.y} r={r * .55} class="knock"><title>{p.country}: {p.n} banned</title></circle>
    {#if labels && p.n / top > .3}<text x={p.x + r + 3} y={p.y + 3} class="knock-l">{p.country} {p.n}</text>{/if}
  {/each}
  <circle cx={lab[0]} cy={lab[1]} r={9 * Math.max(k, .6)} class="lab-ring"/><circle cx={lab[0]} cy={lab[1]} r={4 * Math.max(k, .7)} class="lab-dot"/>
  {#if labels}<text x={lab[0] + 12} y={lab[1] + 4} class="lab-l">LAB</text>{/if}
</svg>
