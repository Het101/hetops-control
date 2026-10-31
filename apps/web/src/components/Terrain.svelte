<script lang="ts">
  import type { Series } from "@hetops-control/contracts";
  import { areas, hhmm } from "../lib/pages.js";
  // a log-flow terrain: one area per series on a shared scale, gaps hatched rather than bridged; the first series is the bright one
  let { series, from, to, label, unit = "docs" }: { series: Series[]; from: number; to: number; label: string; unit?: string } = $props();
  const W = 640, H = 140;
  const uid = $props.id();
  const clip = `reveal-${uid}`; // the terrain draws in left to right behind a clip that only scales
  const top = $derived(Math.max(1, ...series.flatMap(s => s.points.filter(([t]) => t >= from && t <= to).map(p => p[1]))));
  const charts = $derived(series.map(s => ({ id: s.id, ...areas(s, W, H, from, to, top) })));
  // a gap any stream has, once
  const gaps = $derived([...new Map(charts.flatMap(c => c.gaps).map(g => [`${g[0]}-${g[1]}`, g])).values()]);
  const plural = (n: number) => `${n} gap${n === 1 ? "" : "s"}`;
</script>

<svg class="terrain" viewBox="0 0 640 150" preserveAspectRatio="none" role="img" aria-label={`${label}${gaps.length ? `, ${plural(gaps.length)}` : ""}`}>
  {#each [0, 1, 2, 3] as i (i)}<line x1="0" x2="640" y1={i * 46 + 2} y2={i * 46 + 2} class="grid-l"/>{/each}
  <clipPath id={clip}><rect class="reveal" width="640" height="150"/></clipPath>
  <g transform="translate(0 4)" clip-path={`url(#${clip})`}>
    {#each charts as c, k (c.id)}{#each c.segments as g, i (i)}<path d={g.area} class={k ? "a2" : "a1"}/><path d={g.line} class={k ? "l2" : "l1"}/>{/each}{/each}
    {#each gaps as [a, b] (`${a}-${b}`)}<rect x={a} y="0" width={Math.max(1, b - a)} height="140" class="gap"/>{/each}
  </g>
</svg>
<div class="mono note ends"><span>{hhmm(from)}</span><span>peak {top.toLocaleString()} {unit} / {series[0] ? Math.round(series[0].stepMs / 60_000) : 10} min{gaps.length ? ` · ${plural(gaps.length)} (hatched)` : ""}</span><span>now</span></div>
