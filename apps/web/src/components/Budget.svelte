<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import { needsYou } from "../lib/pages.js";
  // the error budget slider, one per slo: silver while budget is left, ember only once the center says it needs the owner
  let { slo }: { slo: Entity[] } = $props();
  const budget = (e: Entity) => { const v = e.facts.budgetLeft?.value; return typeof v === "number" ? Math.max(0, Math.min(100, v)) : undefined; };
</script>

{#each slo as e (e.id)}
  {@const left = budget(e)}
  <div class="budget-num" class:warm={needsYou(e.status)}>{left === undefined ? "—" : Math.round(left)}<span>% left</span></div>
  <div class="slider pressed" role="meter" aria-label={`${e.name}: error budget left`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={left ?? 0}>
    <div class="fill" style={`transform:scaleX(${(left ?? 0) / 100})`}></div><div class="thumb raised" style={`left:${left ?? 0}%`}></div></div>
  <div class="mono note ends"><span>0</span><span>{e.name}</span><span>100</span></div>
{/each}
