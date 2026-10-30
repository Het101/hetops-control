<script lang="ts">
  import type { Entity, Event, Series } from "@hetops-control/contracts";
  import { num, type State } from "../lib/api.js";
  import { ago, areas, DAY, facets, hhmm, hotEvent, keyOf, knocks, LAB_AT, landDots, needsYou, project, sourceState, span, str, sumSeries, time } from "../lib/pages.js";
  import Glyph from "../components/Glyph.svelte";
  import Drawer from "../components/Drawer.svelte";
  import Waiting from "../components/Waiting.svelte";
  import { reduced } from "../lib/motion.js";

  let { estate, events, now }: { estate: State | undefined; events: Event[]; now: Date } = $props();
  let open = $state<Entity>(), openEv = $state<Event>();

  const t = $derived(now.getTime());
  const W = 800, H = 340;
  const dots = landDots(W, H, 4);
  const lab = project(LAB_AT[0], LAB_AT[1], W, H);
  const decisions = $derived(estate?.entities.filter(e => e.kind === "decision") ?? []);
  const cs = $derived(sourceState(estate, "crowdsec"));
  const map = $derived(knocks(decisions, W, H));
  const top = $derived(Math.max(1, ...map.placed.map(p => p.n)));
  const scen = $derived(facets(decisions, d => str(d, "scenario") ?? "unknown").slice(0, 6));
  const recent = $derived([...decisions].sort((a, b) => (num(b, "expiresIn") ?? 0) - (num(a, "expiresIn") ?? 0)).slice(0, 8));
  const bans = $derived(estate?.series.find(s => /crowdsec|bans/.test(s.id)));
  const drift = $derived(estate?.entities.filter(e => e.kind === "check" && (e.source === "bedrock" || e.facts.drift !== undefined)).sort((a, b) => a.name.localeCompare(b.name)) ?? []);
  const br = $derived(sourceState(estate, "bedrock"));
  const secLog = $derived(estate?.series.find(s => s.id === "ops/logs/security"));
  const AUDIT = /falco|audit|bedrock|crowdsec|timeline|chaos/;
  const audit = $derived(events.filter(e => e.kind === "action" || AUDIT.test(e.source)).slice(0, 10));
  const chart = (s: Series, w: number, h: number) => areas(s, w, h, t - DAY, t);
  const expires = (d: Entity) => { const s = num(d, "expiresIn"); return s === undefined ? "" : s <= 0 ? "expired" : `${span(s * 1000)} left`; };
</script>

<section class="page-intro">
  <span class="kicker">SECURITY · WHO KNOCKS</span>
  <h1 tabindex="-1">{decisions.length ? `${decisions.length} source${decisions.length === 1 ? " is" : "s are"} banned from ${map.placed.length} countr${map.placed.length === 1 ? "y" : "ies"}.`
    : "Who knocks, and what the estate did about it."}</h1>
</section>

<div class="grid">
  <section class="mod raised c8 map-mod" style="--in:.04s" aria-labelledby="s-map">
    <h4 id="s-map"><span>WHO KNOCKS · CROWDSEC DECISIONS</span><span>{decisions.length ? `${decisions.length} active` : ""}</span></h4>
    <svg class="world" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={decisions.length ? `Banned sources by country: ${map.placed.map(p => `${p.country} ${p.n}`).join(", ")}` : "World map; no decisions reported"}>
      {#each dots as [x, y], i (i)}<circle cx={x} cy={y} r="1.5" fill="#4e4f54"/>{/each}
      {#each map.placed as p, i (p.country)}
        {@const r = 3 + 7 * Math.sqrt(p.n / top)}
        {#if !$reduced}<circle class="knock-ring" cx={p.x} cy={p.y} {r} style={`--dl:${(i * .33) % 2.6}s`}/>{/if}
        <circle cx={p.x} cy={p.y} r={r * .55} class="knock"><title>{p.country}: {p.n} banned</title></circle>
        {#if p.n / top > .3}<text x={p.x + r + 3} y={p.y + 3} class="knock-l">{p.country} {p.n}</text>{/if}
      {/each}
      <circle cx={lab[0]} cy={lab[1]} r="9" class="lab-ring"/><circle cx={lab[0]} cy={lab[1]} r="4" class="lab-dot"/>
      <text x={lab[0] + 12} y={lab[1] + 4} class="lab-l">LAB</text>
    </svg>
    {#if cs.failing.length}<Waiting title={`Can't read CrowdSec on ${cs.failing[0]!.server}.`} warm>{cs.failing[0]!.error}</Waiting>
    {:else if !cs.reporting.length}<div class="overlay"><Waiting title="CrowdSec is not reporting yet.">Bans by country appear on this map when the lab's CrowdSec source lands. The white dot is the lab.</Waiting></div>
    {:else}<p class="note">silver = banned sources, sized by count · white = the lab{map.unplaced ? ` · ${map.unplaced} without a country` : ""}</p>{/if}
  </section>

  <section class="mod raised c4 list" style="--in:.08s" aria-labelledby="s-scen">
    <h4 id="s-scen"><span>WHAT THEY TRIED</span><span>{scen.length ? "scenarios" : ""}</span></h4>
    {#each scen as s (s.v)}
      <div class="bar-row"><span class="t mono">{s.v}</span><span class="bar pressed"><i style={`transform:scaleX(${s.n / scen[0]!.n})`}></i></span><b class="mono">{s.n}</b></div>
    {:else}<Waiting title="No decisions yet.">CrowdSec scenarios, most frequent first.</Waiting>{/each}
    {#if bans}
      {@const c = chart(bans, 300, 60)}
      <h4 class="sub-h"><span>BANS PER HOUR · 24 H</span><span>{sumSeries(bans, t - DAY)}</span></h4>
      <svg class="spark" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true">{#each c.segments as g, i (i)}<path d={g.area} class="a1"/><path d={g.line} class="l1"/>{/each}</svg>
    {/if}
  </section>

  <section class="mod raised c7 list" style="--in:.12s" aria-labelledby="s-bans">
    <h4 id="s-bans"><span>RECENT BANS</span><span>{recent.length ? `latest ${recent.length}` : ""}</span></h4>
    {#each recent as d (d.id)}
      <button type="button" class="row" onclick={() => (open = d)}>
        <span class="n mono">{str(d, "country") ?? "··"}</span>
        <span class="t mono">{str(d, "ip") ?? d.name}<small>{str(d, "scenario") ?? "scenario unknown"} · {str(d, "origin") ?? "origin unknown"}</small></span>
        <span class="tag pressed">{expires(d)}</span>
      </button>
    {:else}<Waiting title={cs.reporting.length ? "Nothing is banned right now." : "No ban source yet."}>Each ban with its masked address, scenario and time left.</Waiting>{/each}
  </section>

  <section class="mod raised c5 list" style="--in:.16s" aria-labelledby="s-drift">
    <h4 id="s-drift"><span>BEDROCK · HOST DRIFT</span><span>{drift.length ? `${drift.filter(d => d.facts.drift?.value === true).length} drifted` : ""}</span></h4>
    {#if br.failing.length}<Waiting title={`Can't read Bedrock's state on ${br.failing[0]!.server}.`} warm>{br.failing[0]!.error}</Waiting>{/if}
    {#each drift as d (d.id)}
      {@const warm = d.facts.drift?.value === true || needsYou(d.status)} {@const run = time(d, "lastRun") ?? time(d, "lastCheck")}
      <button type="button" class="row" class:now={warm} onclick={() => (open = d)}>
        <span class="sev" class:warm aria-hidden="true"><i></i></span>
        <span class="t">{d.name}<small>{run ? `checked ${ago(run, t)}` : "last run unknown"}{d.statusReason ? ` · ${d.statusReason}` : ""}</small></span>
        <span class="tag pressed" class:warm>{d.facts.drift?.value === true ? "DRIFTED" : d.status === "unknown" ? "CAN'T TELL" : "CLEAN"}</span>
      </button>
    {:else}{#if !br.failing.length}<Waiting title="Bedrock drift is not reporting yet.">Each host (lab, staging, ops) as clean or drifted from its Ansible code, with the last check.</Waiting>{/if}{/each}
  </section>

  <section class="mod raised c7" style="--in:.2s" aria-labelledby="s-log">
    <h4 id="s-log"><span>SECURITY LOG STREAM · 24 H</span><span>{secLog ? `${sumSeries(secLog, t - DAY).toLocaleString()} docs` : ""}</span></h4>
    {#if secLog}
      {@const c = chart(secLog, 640, 140)}
      <svg class="terrain" viewBox="0 0 640 150" preserveAspectRatio="none" role="img" aria-label={`Security log documents per 10 minutes over 24 hours${c.gaps.length ? `, ${c.gaps.length} gap${c.gaps.length === 1 ? "" : "s"}` : ""}`}>
        {#each [0, 1, 2, 3] as i (i)}<line x1="0" x2="640" y1={i * 46 + 2} y2={i * 46 + 2} class="grid-l"/>{/each}
        <g transform="translate(0 4)">{#each c.segments as g, i (i)}<path d={g.area} class="a1"/><path d={g.line} class="l1"/>{/each}
          {#each c.gaps as [a, b], i (i)}<rect x={a} y="0" width={Math.max(1, b - a)} height="140" class="gap"/>{/each}</g>
      </svg>
      <div class="mono note ends"><span>{hhmm(t - DAY)}</span><span>peak {c.top.toLocaleString()} / 10 min{c.gaps.length ? ` · ${c.gaps.length} gap${c.gaps.length === 1 ? "" : "s"} (hatched)` : ""}</span><span>now</span></div>
    {:else}<Waiting title="The security log stream is not reporting.">Documents per 10 minutes in logs-lab-security, from the ops Elasticsearch.</Waiting>{/if}
  </section>

  <section class="mod raised c5 list" style="--in:.24s" aria-labelledby="s-audit">
    <h4 id="s-audit"><span>AUDIT HIGHLIGHTS</span><span>{audit.length || ""}</span></h4>
    {#each audit as e (keyOf(e))}
      {@const warm = hotEvent(e)}
      <button type="button" class="row" class:now={warm} onclick={() => { openEv = e; open = estate?.entities.find(x => x.id === e.entity); }}>
        <Glyph kind={e.kind} {warm} /><span class="n">{hhmm(e.at)}</span>
        <span class="t">{e.summary}<small>{e.server} · {e.source}{e.actor ? ` · ${e.actor}` : ""}</small></span>
      </button>
    {:else}<Waiting title="No audit events yet.">Falco highlights, Bedrock drift runs, CrowdSec and every action taken here, from the Change Timeline.</Waiting>{/each}
  </section>
</div>

{#if open || openEv}<Drawer entity={open} event={openEv} {events} now={t} onclose={() => { open = undefined; openEv = undefined; }} />{/if}
