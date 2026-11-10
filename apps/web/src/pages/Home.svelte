<script lang="ts">
  import Status from "../components/Status.svelte";
  import type { Entity, Event } from "@hetops-control/contracts";
  import type { State } from "../lib/api.js";
  import type { Away } from "../lib/away.js";
  import { backupView, DAY, hhmm, ago, needsYou, span, str } from "../lib/pages.js";
  import { deployRiver, moduleState, perMinute, waitingDeploys } from "../lib/home.js";
  import { siteRows, summary } from "../lib/sites.js";
  import Headline from "../components/Headline.svelte";
  import NeedsYou from "../components/NeedsYou.svelte";
  import Map from "../components/Map.svelte";
  import HostLoad from "../components/HostLoad.svelte";
  import Timeline from "../components/Timeline.svelte";
  import Budget from "../components/Budget.svelte";
  import KnockMap from "../components/KnockMap.svelte";
  import Terrain from "../components/Terrain.svelte";
  import Waiting from "../components/Waiting.svelte";
  import SiteBoard from "../components/SiteBoard.svelte";
  import Drawer from "../components/Drawer.svelte";
  import Later from "../components/Later.svelte";

  // Home (Fire line): the bulletin, the map of the estate beside what needs you, then one module per page, each linking to it;
  // a module whose source never reported is not shown
  let { estate, events, eventsError, now, shown, away, ondismiss }: { estate: State; events: Event[]; eventsError: boolean; now: Date; shown: number; away?: Away; ondismiss?: () => void } = $props();
  const t = $derived(now.getTime());
  const ents = $derived(estate.entities);

  const river = $derived(deployRiver(events, t));
  const deploys = $derived(river.total);
  const waiting = $derived(waitingDeploys(ents));

  const slo = $derived(ents.filter(e => e.kind === "slo"));
  const budget = $derived(moduleState(estate, "slo", slo.length > 0));
  const flows = $derived(["ops/logs/default", "ops/logs/security"].flatMap(id => estate.series.filter(s => s.id === id)));
  const logs = $derived(moduleState(estate, "elasticsearch", flows.length > 0));
  const decisions = $derived(ents.filter(e => e.kind === "decision"));
  const cs = $derived(moduleState(estate, "crowdsec", decisions.length > 0));
  const backups = $derived(ents.filter(e => e.kind === "backup").sort((a, b) => Number(needsYou(b.status)) - Number(needsYou(a.status)) || a.name.localeCompare(b.name)));
  const snaps = $derived(moduleState(estate, "snapshots", backups.length > 0));
  const rows = $derived(siteRows(ents.filter(e => e.kind === "site"), estate.series, t));
  const gatus = $derived(moduleState(estate, "gatus", rows.length > 0));
  let open = $state<Entity>();
  const on = (m: { mode: string }) => m.mode !== "hidden";
  // the capsules spread across the module's real width at one unit per pixel, so they never balloon on a wide screen
  let capW = $state(420);
  // read through a ResizeObserver, which reports after layout; bind:clientWidth reads it during the render and forces a
  // layout of the whole page in the middle of it
  const width = (el: Element, set: (w: number) => void) => {
    const ro = new ResizeObserver(([e]) => { if (e) set(e.contentRect.width); });
    ro.observe(el);
    return { destroy: () => ro.disconnect() };
  };
  const CW = $derived(Math.max(300, Math.round(capW)));
  // the side column runs short when the budget or CrowdSec is missing; then the timeline leaves the middle column for a
  // full-width row, so deploys and the log flow end level with the shorter side
  const wideTimeline = $derived(!(on(budget) && on(cs)));
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const fmtWhen = (ms: number) => new Date(ms).toUTCString().slice(0, 11).replace(",", "");
  // the river's geometry: a lane per server that deployed (or has one waiting), x along the span held, midnights as faint lines
  const RX0 = 64, RW = $derived(CW - RX0 - 14);
  const rx = (ms: number) => RX0 + (river.end > river.start ? (ms - river.start) / (river.end - river.start) : 1) * RW;
  const latest = $derived(river.lanes.flatMap(l => l.deps).sort((a, b) => a.at.localeCompare(b.at)).at(-1));
  const laneOf = $derived([...new Set([...river.lanes.map(l => l.server), ...waiting.map(w => w.e.server)])]);
  const midnights = $derived(Array.from({ length: 15 }, (_, i) => Math.ceil(river.start / DAY) * DAY + i * DAY).filter(m => m < river.end));
</script>

<section class="fire-home" aria-label="The estate now">
  <div class="fh-head"><Headline headline={estate.headline} {now} {away} {ondismiss} /></div>
  <div class="fh-map"><Map state={estate} {events} {now} /></div>
  <aside class="fh-side"><NeedsYou needs={estate.headline.needs} entities={estate.entities} servers={estate.servers} max={6} /></aside>
</section>

{#snippet deploysMod()}
  <section class="mod raised c8" style="--in:.16s" aria-labelledby="h-deploys" data-module="deploys">
      <h2 id="h-deploys"><span>Deploys</span><span>{!eventsError && river.short && deploys ? `since ${fmtWhen(river.start)}` : !eventsError && deploys ? "14 days" : ""}<a class="to" href="/timeline" aria-label="Open the Timeline">open →</a></span></h2>
      {#if eventsError}<Waiting title="Can't read the event log." warm>Deploys come from the Change Timeline; they are not shown until it answers again.</Waiting>
      {:else}
        <div class="focal"><b>{deploys}</b> <span>{deploys === 1 ? "deploy" : "deploys"} in the last {river.short ? span(river.end - river.start) : "14 days"}</span></div>
        <svg class="river" use:width={w => (capW = w)} viewBox={`0 0 ${CW} ${Math.max(1, laneOf.length) * 30 + 20}`} role="img"
          aria-label={`${deploys} deploys since ${fmtWhen(river.start)}: ${river.lanes.map(l => `${l.server} ${l.deps.length}`).join(", ")}${waiting.length ? `; ${plural(waiting.length, "deploy")} waiting on you` : ""}`}>
          {#each midnights as m (m)}<line class="mid" x1={rx(m)} x2={rx(m)} y1="0" y2={laneOf.length * 30}/>{/each}
          {#each laneOf as server, li (server)}
            {@const y = li * 30 + 15} {@const lane = river.lanes.find(l => l.server === server)}
            <text x="0" y={y + 4} class="cap-l">{server}</text>
            <line class="lane" x1={RX0} x2={RX0 + RW} y1={y} y2={y}/>
            {#each lane?.deps ?? [] as d, di (d.at + d.summary)}
              {@const last = d === latest}
              <circle class="dep" class:last cx={rx(Date.parse(d.at))} cy={y} r={last ? 6 : 4.5} style={`--dl:${.3 + di * .04}s`}><title>{fmtWhen(Date.parse(d.at))} {d.at.slice(11, 16)} UTC · {d.summary}</title></circle>
            {/each}
            {#each waiting.filter(w => w.e.server === server) as w (w.e.id)}<circle class="dep hot" cx={RX0 + RW} cy={y} r="6"><title>{w.e.name}: {w.commit} waiting for a deploy</title></circle>{/each}
          {/each}
          <text x={RX0} y={laneOf.length * 30 + 16} class="cap-l">{fmtWhen(river.start)}</text><text x={RX0 + RW} y={laneOf.length * 30 + 16} text-anchor="end" class="cap-l">Now</text>
        </svg>
        {#each waiting.slice(0, 2) as w (w.e.id)}
          <div class="wait-row warm"><span class="sev warm" aria-hidden="true"><i></i></span><span>{w.e.name} has {w.commit} waiting for a deploy<small>{w.e.server}{w.e.source ? ` · ${w.e.source}` : ""}</small></span></div>
        {/each}
        {#if !deploys && !waiting.length}<p class="note">No deploys in the events held. Rollouts and Argo syncs appear here, one dot each.</p>
        {:else}<p class="note">a dot per rollout or Argo sync · a lane per server · faint lines are midnights (UTC){waiting.length ? " · ember = waiting on you" : ""}</p>{/if}
      {/if}
    </section>
{/snippet}
{#snippet budgetMod()}
  <section class="mod raised c4" style="--in:.22s" aria-labelledby="h-budget" data-module="budget">
        <h2 id="h-budget"><span>Error budget</span><span>{slo[0]?.facts.windowDays ? `${slo[0].facts.windowDays.value} d` : ""}<a class="to" href="/alerts" aria-label="Open Alerts">open →</a></span></h2>
        {#if budget.fail}<Waiting title="Can't read the error budget." warm>{budget.fail.server}: {budget.fail.error}</Waiting>
        {:else if budget.mode === "empty"}<Waiting title="No SLO reported.">The error budget appears when an SLO is defined.</Waiting>
        {:else}<Budget {slo} />{/if}
      </section>
{/snippet}
{#snippet logsMod()}
  <section class="mod raised c8 grow" style="--in:.28s" aria-labelledby="h-logs" data-module="logs">
        <h2 id="h-logs"><span>Log flow → ops</span><span>{!logs.fail && perMinute(flows[0]) ? `24 h · ${perMinute(flows[0])}/min` : ""}<a class="to" href="/security" aria-label="Open Security">open →</a></span></h2>
        {#if logs.fail}<Waiting title="Can't read Elasticsearch." warm>{logs.fail.server}: {logs.fail.error}. The log flow is not shown until it answers.</Waiting>
        {:else if logs.mode === "empty"}<Waiting title="No log streams reported.">The default and security streams appear here, per 10 minutes.</Waiting>
        {:else}
          <Terrain series={flows} from={t - DAY} to={t} label="Lab log documents per 10 minutes over 24 hours, default and security streams" />
          <p class="note">{flows.map((s, i) => `${i ? "grey" : "silver"} = ${s.label.replace(/^Lab logs: /i, "")} stream`).join(" · ")}</p>
        {/if}
      </section>
{/snippet}
{#snippet knocksMod()}
  <section class="mod raised c4 grow" style="--in:.34s" aria-labelledby="h-knocks" data-module="knocks">
        <h2 id="h-knocks"><span>Who knocks · CrowdSec</span><span>{!cs.fail && decisions.length ? `${decisions.length} banned` : ""}<a class="to" href="/security" aria-label="Open Security">open →</a></span></h2>
        {#if cs.fail}<Waiting title="Can't read CrowdSec." warm>{cs.fail.server}: {cs.fail.error}</Waiting>
        {:else}
          <KnockMap {decisions} w={400} h={170} step={6} labels={false} />
          <p class="note">{decisions.length ? "silver = banned sources, sized by count · white = the lab" : "Nothing is banned right now · white = the lab"}</p>
        {/if}
      </section>
{/snippet}
{#snippet backupsMod()}
  <section class="mod raised c4 list" style="--in:.46s" aria-labelledby="h-backups" data-module="backups">
        <h2 id="h-backups"><span>Backups · last result</span><span><a class="to" href="/backups" aria-label="Open Backups">open →</a></span></h2>
        {#if snaps.fail}<Waiting title="Can't read the snapshots." warm>{snaps.fail.server}: {snaps.fail.error}</Waiting>
        {:else}
          {#each backups as e (e.id)}
            {@const v = backupView(e, t)} {@const warm = needsYou(e.status)}
            <a class="row" class:now={warm} href="/backups" data-backup={e.id}>
              <span class="n mono" class:warm>{v.ok ? hhmm(v.ok) : "never"}</span>
              <span class="t">{e.name}<small class:warm>{warm ? (e.statusReason ?? e.status) : `${str(e, "repository") ? `to ${str(e, "repository")} · ` : ""}last ok ${v.ok ? ago(v.ok, t) : "never"}`}</small></span>
              <Status tone={warm ? "warn" : "ok"} label={warm ? (v.failedLast ? "Failed" : "Overdue") : "OK"} />
            </a>
          {:else}<Waiting title="No snapshot policies reported.">Each policy appears with its last result.</Waiting>{/each}
        {/if}
      </section>
{/snippet}
{#snippet sitesMod()}
  <section class="mod raised c12" style="--in:.52s" aria-labelledby="h-sites" data-module="sites">
    <h2 id="h-sites" class="board-h"><span>Sites · 24 h</span><span>{!gatus.fail && rows.length ? summary(rows) : ""}<a class="to" href="/apps" aria-label="Open Apps">open →</a></span></h2>
    {#if gatus.fail}<Waiting title="Can't read Gatus." warm>{gatus.fail.server}: {gatus.fail.error}</Waiting>
    {:else if gatus.mode === "empty"}<Waiting title="No sites reported.">Public sites and products appear with their last 24 hours.</Waiting>
    <!-- the board is the foot of the page, so it can follow a slice later without moving anything -->
    {:else}<Later><SiteBoard {rows} onopen={e => (open = e)} /></Later>{/if}
  </section>
{/snippet}

<!-- two columns that end level: the instruments down the side, the flows down the middle; the log terrain takes up any slack.
     The timeline runs full width below when the optional side modules are missing; the sites board always does. -->
<!-- the hero paints first; the modules below mount in the next idle slices (their data is already here and stays live) -->
<Later>
<div class="grid home">
  <div class="lane side c4" class:short={wideTimeline}>
    <HostLoad state={estate} />
    {#if on(budget)}{@render budgetMod()}{/if}
    {#if on(cs)}{@render knocksMod()}{/if}
    {#if on(snaps)}{@render backupsMod()}{/if}
  </div>
  <div class="lane main c8">
    {@render deploysMod()}
    {#if on(logs)}{@render logsMod()}{/if}
    {#if !wideTimeline}<Timeline {events} limit={shown} error={eventsError} />{/if}
  </div>
  {#if wideTimeline}<Timeline {events} limit={shown} error={eventsError} wide />{/if}
  {#if on(gatus)}{@render sitesMod()}{/if}
</div>
</Later>

{#if open}<Drawer entity={open} {events} now={t} onclose={() => (open = undefined)} />{/if}
