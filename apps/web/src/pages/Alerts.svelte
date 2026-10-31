<script lang="ts">
  import type { Entity, Event } from "@hetops-control/contracts";
  import type { State } from "../lib/api.js";
  import { alarms, facets, hhmm, matches, needsYou, picked, SEVERITIES, sourceState, span, type Severity } from "../lib/pages.js";
  import Chips from "../components/Chips.svelte";
  import Search from "../components/Search.svelte";
  import Knob from "../components/Knob.svelte";
  import Drawer from "../components/Drawer.svelte";
  import Waiting from "../components/Waiting.svelte";
  import Budget from "../components/Budget.svelte";

  let { estate, events, now }: { estate: State | undefined; events: Event[]; now: Date } = $props();
  let server = $state<string[]>([]), source = $state<string[]>([]), q = $state("");
  let open = $state<Entity>();

  const all = $derived(estate ? alarms(estate.entities, events) : []);
  const shown = $derived(all.filter(a => picked(server, a.entity.server) && picked(source, a.source) && matches(q, a.entity.name, a.detail, a.entity.id)));
  const count = (s: Severity) => all.filter(a => a.severity === s).length;
  const am = $derived(sourceState(estate, "alertmanager"));
  const slo = $derived(estate?.entities.filter(e => e.kind === "slo") ?? []);
  const sloSrc = $derived(sourceState(estate, "slo"));
  const checks = $derived(estate?.entities.filter(e => e.kind === "check" || e.kind === "site").sort((a, b) => a.name.localeCompare(b.name)) ?? []);
  const passing = $derived(checks.filter(c => c.status === "ok").length);
  const firing = $derived(count("critical") + count("warning"));
  const COPY: Record<Severity, string> = { critical: "Critical", warning: "Warning", info: "Info and blind spots" };
</script>

<section class="page-intro">
  <span class="kicker">ALERTS</span>
  <h1 tabindex="-1">{!estate ? "What is firing, across every server." : firing ? `${firing} thing${firing === 1 ? " is" : "s are"} firing.` : "Nothing is firing."}</h1>
</section>

<!-- whatever is firing takes the wide column; on a quiet day every check does, and "nothing is firing" moves to the side -->
{#snippet firingMod()}
  <section class="mod raised c8 list" style="--in:.12s" aria-labelledby="a-firing">
    <h4 id="a-firing"><span>FIRING · BY SEVERITY</span><span>{shown.length} of {all.length}</span></h4>
    {#if all.length}
      <div class="filters">
        <Search bind:q placeholder="Search alerts and checks" />
        <Chips label="Server" bind:selected={server} options={facets(all, a => a.entity.server)} />
        <Chips label="Source" bind:selected={source} options={facets(all, a => a.source)} />
      </div>
    {/if}
    {#if am.failing.length}<Waiting title={`Can't read Alertmanager on ${am.failing.map(f => f.server).join(", ")}.`} warm>{am.failing[0]!.error}. Its alerts are missing below, not resolved.</Waiting>{/if}
    {#each SEVERITIES as s (s)}
      {@const group = shown.filter(a => a.severity === s)}
      {#if group.length}
        <div class="group mono sev-h" class:warm={s !== "info"}>{COPY[s].toUpperCase()} · {group.length}</div>
        {#each group as a (a.entity.id)}
          {@const warm = a.severity !== "info"}
          <div class="row" class:now={warm} data-severity={s}>
            <button type="button" class="open" onclick={() => (open = a.entity)}>
              <span class="sev" class:warm aria-hidden="true"><i></i></span>
              <span class="t">{a.entity.name}<small>{a.detail} · {a.entity.server} · {a.source}</small></span>
              <span class="since mono" class:warm>{a.since ? `for ${span(now.getTime() - a.since)}` : "since ?"}<small>{a.since ? `from ${hhmm(a.since)} UTC` : "start not recorded"}</small></span>
            </button>
            {#each a.entity.links.slice(0, 1) as l (l.href)}<a class="out" href={l.href} target="_blank" rel="noreferrer" aria-label={`${l.label} for ${a.entity.name}`}>↗</a>{/each}
            <Knob label={`Silence ${a.entity.name}`} {warm} />
          </div>
        {/each}
      {/if}
    {/each}
    {#if estate && !all.length}
      <Waiting title="Nothing is firing.">{checks.length} check{checks.length === 1 ? "" : "s"} passing{am.reporting.length ? " and no active alert in Alertmanager" : ""}.</Waiting>
    {:else if all.length && !shown.length}<Waiting title="Nothing matches these filters.">Clear a chip or the search.</Waiting>{/if}
    {#if !am.reporting.length}
      <p class="note">Alertmanager is not reporting yet: this list holds the Gatus and Elasticsearch checks; Prometheus alerts join it when the lab's alert source lands.</p>
    {/if}
  </section>
{/snippet}
{#snippet checksMod()}
  <section class="mod raised c4 list" style="--in:.16s" aria-labelledby="a-checks">
    <h4 id="a-checks"><span>EVERY CHECK</span><span>{checks.length}</span></h4>
    {#if checks.length}
      <div class="pills">
        {#each checks as c (c.id)}
          <button type="button" class="pill" class:warm={needsYou(c.status)} class:blind={c.status === "unknown"} onclick={() => (open = c)}
            title={c.statusReason ?? c.status}><i></i>{c.name}<small>{c.server}</small></button>
        {/each}
      </div>
      <p class="note">ember = failing · hollow = can't tell · silver = passing</p>
    {:else}<Waiting title="No checks reporting yet.">Gatus endpoints and Elasticsearch health appear here.</Waiting>{/if}
  </section>
{/snippet}

<div class="grid">
  <div class="lane c8">
    <section class="mod raised c8 tally" style="--in:.04s" aria-label="By severity">
      {#each SEVERITIES as s (s)}
        {@const n = count(s)}
        <div class="tal"><b class:warm={s !== "info" && n > 0}>{n}</b><span class="mono">{s.toUpperCase()}</span></div>
      {/each}
      <div class="tal"><b>{passing}<small>/{checks.length}</small></b><span class="mono">CHECKS PASSING</span></div>
    </section>

    {#if all.length}{@render firingMod()}{:else}{@render checksMod()}{/if}
  </div>
  <div class="lane c4">
    <section class="mod raised c4 budget" style="--in:.08s" aria-labelledby="a-budget">
      <h4 id="a-budget"><span>ERROR BUDGET</span><span>{slo[0]?.facts.windowDays ? `${slo[0].facts.windowDays.value} d` : ""}</span></h4>
      {#if sloSrc.failing.length}<Waiting title={`Can't read the error budget on ${sloSrc.failing[0]!.server}.`} warm>{sloSrc.failing[0]!.error}</Waiting>
      {:else if !slo.length}<Waiting title="No error budget reporting yet.">The lab's chaos SLO appears here when its source lands.</Waiting>
      {:else}<Budget {slo} />
      {/if}
    </section>

    {#if all.length}{@render checksMod()}{:else}{@render firingMod()}{/if}
  </div>
</div>

{#if open}<Drawer entity={open} {events} now={now.getTime()} onclose={() => (open = undefined)} />{/if}
