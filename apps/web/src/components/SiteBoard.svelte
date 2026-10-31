<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import { hhmm } from "../lib/pages.js";
  import { columns, spark, tickHeight, type SiteRow } from "../lib/sites.js";

  // the Sites status board (Home and Apps): one row per site in two balanced columns, Sites then Products; each row a 24-hour
  // heartbeat (one tick per clock hour, its height the uptime), the last response time with its hourly line, and the 24 h uptime.
  // Ember only for "needs you": the current hour of a site that is failing now; a recovered hour is a shorter, dimmer silver tick.
  let { rows, onopen }: { rows: SiteRow[]; onopen: (e: Entity) => void } = $props();
  const cols = $derived(columns(rows).map((items, i) => ({ key: i, items })));
  const tip = (k: SiteRow["ticks"][number]) => `${hhmm(k.t)} UTC: ${k.up === undefined ? "not watched" : `${k.up.toFixed(2)}% up`}`;
  const said = (r: SiteRow) => { const up = r.ticks.filter(k => k.up === 100).length, hit = r.ticks.filter(k => k.up !== undefined && k.up < 100).length;
    return `Last 24 hours: ${up} hours up${hit ? `, ${hit} with down time` : ""}${24 - up - hit ? `, ${24 - up - hit} not watched` : ""}`; };
</script>

<div class="board">
  {#each cols as c (c.key)}
  <div class="board-col">
    {#each c.items as it (it.key)}
      {#if !it.row}<div class="board-g mono" class:cont={it.cont}>{it.label}{it.cont ? " · CONT." : ""}</div>
      {:else}
      {@const r = it.row}
      {@const link = r.e.links[0]}
      <div class="site" class:hot={r.warm} data-site={r.e.id}>
        <button type="button" class="site-open" onclick={() => onopen(r.e)}>
          <span class="sdot" class:warm={r.warm} class:unknown={r.e.status === "unknown"} aria-hidden="true"></span>
          <span class="t">{r.e.name}<small class="mono" class:warm={r.warm}>{r.warm && r.e.statusReason ? r.e.statusReason : (r.host ?? r.group)}</small></span>
          <span class="beats" role="img" aria-label={said(r)}>
            {#each r.ticks as k, i (i === r.ticks.length - 1 ? `${k.t}:${k.up}` : k.t)}
              <i class:dip={k.up !== undefined && k.up < 100} class:down={r.warm && i === r.ticks.length - 1} class:unknown={k.up === undefined} class:new={i === r.ticks.length - 1}
                style={`--h:${k.up === undefined ? 1 : tickHeight(k.up)};--i:${i}`} title={tip(k)}></i>
            {/each}
          </span>
          <span class="lat mono">{r.ms === undefined ? "—" : `${Math.round(r.ms)} ms`}
            <svg viewBox="0 0 56 14" preserveAspectRatio="none" aria-hidden="true"><path d={spark(r.lat, 56, 14)}/></svg></span>
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
<p class="note">one tick per hour · shorter, dimmer = down time that hour · ember = failing now · hollow = not watched · line = mean response per hour</p>
