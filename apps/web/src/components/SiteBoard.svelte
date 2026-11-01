<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import { hhmm } from "../lib/pages.js";
  import { barHeights, columns, type SiteRow } from "../lib/sites.js";

  // the Sites status board (Home and Apps): one row per site in two balanced columns, Sites then Products. Each row is one strip
  // of the last 24 hours, a bar per clock hour: its colour how the hour went (moss fully up, silver some down time, hollow not
  // watched, ember only for the current hour of a site failing now) and its height that hour's response time against the site's
  // own range. Then the last response time and the 24 h uptime.
  let { rows, onopen }: { rows: SiteRow[]; onopen: (e: Entity) => void } = $props();
  const cols = $derived(columns(rows).map((items, i) => ({ key: i, items })));
  const tip = (k: SiteRow["ticks"][number]) => `${hhmm(k.t)} UTC: ${k.up === undefined ? "not watched" : `${k.up.toFixed(2)}% up`}${k.ms === undefined ? "" : ` · ${Math.round(k.ms)} ms`}`;
  const said = (r: SiteRow) => { const up = r.ticks.filter(k => k.up === 100).length, hit = r.ticks.filter(k => k.up !== undefined && k.up < 100).length;
    return `Last 24 hours: ${up} hours up${hit ? `, ${hit} with down time` : ""}${24 - up - hit ? `, ${24 - up - hit} not watched` : ""}`; };
  // the line under the name: why it fails, else its domain, else (named after its domain) how its watched hours went
  const sub = (r: SiteRow) => { if (r.warm && r.e.statusReason) return r.e.statusReason;
    if (r.host && r.host.toLowerCase() !== r.e.name.toLowerCase()) return r.host;
    const seen = r.ticks.filter(k => k.up !== undefined), dip = seen.filter(k => k.up! < 100).length;
    return seen.length ? `${seen.length - dip}/${seen.length} h fully up${dip ? ` · ${dip} dipped` : ""}` : r.group; };
</script>

<div class="board">
  {#each cols as c (c.key)}
  <div class="board-col">
    {#each c.items as it (it.key)}
      {#if !it.row}<div class="board-g mono" class:cont={it.cont}>{it.label}{it.cont ? " · CONT." : ""}</div>
      {:else}
      {@const r = it.row}
      {@const link = r.e.links[0]}
      {@const hs = barHeights(r.ticks)}
      <div class="site" class:hot={r.warm} data-site={r.e.id}>
        <button type="button" class="site-open" onclick={() => onopen(r.e)}>
          <span class="sdot" class:warm={r.warm} class:unknown={r.e.status === "unknown"} aria-hidden="true"></span>
          <span class="t">{r.e.name}<small class="mono" class:warm={r.warm}>{sub(r)}</small></span>
          <span class="beats" role="img" aria-label={said(r)}>
            {#each r.ticks as k, i (i === r.ticks.length - 1 ? `${k.t}:${k.up}` : k.t)}
              <i class:ok={k.up === 100 && !(r.warm && i === r.ticks.length - 1)} class:dip={k.up !== undefined && k.up < 100} class:down={r.warm && i === r.ticks.length - 1}
                class:unknown={k.up === undefined} class:new={i === r.ticks.length - 1} style={`--h:${hs[i]};--i:${i}`} title={tip(k)}></i>
            {/each}
          </span>
          <span class="lat mono">{r.ms === undefined ? "—" : `${Math.round(r.ms)} ms`}</span>
          <span class="pct mono" class:warm={r.warm}>{r.pct === undefined ? "—" : `${r.pct.toFixed(2)}%`}</span>
        </button>
        {#if link}<a class="go knob" href={link.href} target="_blank" rel="noreferrer" aria-label={`Open ${link.label}`} title={link.label}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 16 16 8M9 8h7v7"/></svg></a>{/if}
      </div>
      {/if}
    {/each}
  </div>
  {/each}
</div>
<p class="note">a bar per hour · green = fully up · silver = some down time · ember = failing now · hollow = not watched · height = response time that hour</p>
