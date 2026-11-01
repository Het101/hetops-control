<script lang="ts">
  import type { Entity, Event } from "@hetops-control/contracts";
  import type { State } from "../lib/api.js";
  import { alarms, facets, hhmm, matches, needsYou, picked, SEVERITIES, sourceState, span, str, type Severity } from "../lib/pages.js";
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
  // the pill cloud, sorted into what each check watches: its Gatus group, else its source (Elasticsearch, Bedrock); failing first
  const groupOf = (c: Entity) => str(c, "group") || c.source || c.kind;
  const checkGroups = $derived([...new Set(checks.map(groupOf))].sort().map(g => {
    const list = checks.filter(c => groupOf(c) === g).sort((a, b) => Number(needsYou(b.status)) - Number(needsYou(a.status)) || a.name.localeCompare(b.name));
    return { g, list, bad: list.filter(c => c.status !== "ok").length };
  }));
  const firing = $derived(count("critical") + count("warning"));
  // what Home's Needs-you holds that is not an alert or a check (a restarting app, drift): said here too, so this page never
  // calls the estate quiet while Home says something is waiting
  const elsewhere = $derived((estate?.headline.needs ?? []).filter(n => !all.some(a => a.entity.id === n.entity)));
  const still = $derived(elsewhere.length ? `${elsewhere.length} thing${elsewhere.length === 1 ? "" : "s"} still need${elsewhere.length === 1 ? "s" : ""} you` : "");
  const COPY: Record<Severity, string> = { critical: "Critical", warning: "Warning", info: "Info and blind spots" };
</script>

<section class="page-intro">
  <span class="kicker">ALERTS</span>
  <h1 tabindex="-1">{!estate ? "What is firing, across every server." : firing ? `${firing} thing${firing === 1 ? " is" : "s are"} firing.` : still ? `Nothing is firing; ${still}.` : "Nothing is firing."}</h1>
</section>

<!-- whatever is firing takes the wide column; on a quiet day every check does, and "nothing is firing" moves to the side -->
{#snippet firingMod()}
  <section class="mod raised c8 list" style="--in:.12s" aria-labelledby="a-firing">
    <h2 id="a-firing"><span>FIRING · BY SEVERITY</span><span>{shown.length} of {all.length}</span></h2>
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
          {@const ack = estate?.acks?.find(k => k.entity === a.entity.id)}
          {@const warm = a.severity !== "info" && !ack}
          <div class="row" class:now={warm} data-severity={s}>
            <button type="button" class="open" onclick={() => (open = a.entity)}>
              <span class="sev" class:warm aria-hidden="true"><i></i></span>
              <span class="t">{a.entity.name}<small>{a.detail} · {a.entity.server} · {a.source}</small>
                {#if ack}<small class="ack-note">acknowledged by {ack.actor} until {hhmm(Date.parse(ack.until))} UTC{ack.note ? ` · ${ack.note}` : ""}</small>{/if}</span>
              <span class="since mono" class:warm>{a.since ? `for ${span(now.getTime() - a.since)}` : "since ?"}<small>{a.since ? `from ${hhmm(a.since)} UTC` : "start not recorded"}</small></span>
            </button>
            {#each a.entity.links.slice(0, 1) as l (l.href)}<a class="out" href={l.href} target="_blank" rel="noreferrer" aria-label={`${l.label} for ${a.entity.name}`}>↗</a>{/each}
            <Knob entity={a.entity} label={`${a.entity.actions[0]?.label ?? "Silence"} ${a.entity.name}`} {warm} />
          </div>
        {/each}
      {/if}
    {/each}
    {#if estate && !all.length}
      <Waiting title="Nothing is firing.">{checks.length} check{checks.length === 1 ? "" : "s"} passing{am.reporting.length ? " and no active alert in Alertmanager" : ""}.</Waiting>
    {:else if all.length && !shown.length}<Waiting title="Nothing matches these filters.">Clear a chip or the search.</Waiting>{/if}
    {#if elsewhere.length}
      <div class="group mono sev-h warm">ALSO NEEDS YOU · NOT AN ALERT · {elsewhere.length}</div>
      {#each elsewhere as n (n.entity)}
        {@const e = estate?.entities.find(x => x.id === n.entity)}
        <div class="row now" data-needs>
          <button type="button" class="open" onclick={() => (open = e)} disabled={!e}>
            <span class="sev warm" aria-hidden="true"><i></i></span>
            <span class="t">{n.text}<small>{n.detail}</small></span>
          </button>
          {#if e}<Knob entity={e} action={n.action?.id} label={`${n.action?.label ?? "Act on"} ${e.name}`} warm />{/if}
        </div>
      {/each}
    {/if}
    {#if !am.reporting.length}
      <p class="note">Alertmanager is not reporting yet: this list holds the Gatus and Elasticsearch checks; Prometheus alerts join it when the lab's alert source lands.</p>
    {/if}
  </section>
{/snippet}
{#snippet checksMod()}
  <section class="mod raised c4 list" style="--in:.16s" aria-labelledby="a-checks">
    <h2 id="a-checks"><span>EVERY CHECK</span><span>{checks.length}</span></h2>
    {#if checks.length}
      {#each checkGroups as k (k.g)}
        <div class="group mono">{k.g.toUpperCase()} · {k.bad ? `${k.list.length - k.bad} of ${k.list.length} passing` : `${k.list.length} passing`}</div>
        <div class="pills">
          {#each k.list as c (c.id)}
            <button type="button" class="pill" class:warm={needsYou(c.status)} class:blind={c.status === "unknown"} onclick={() => (open = c)}
              title={`${c.statusReason ?? c.status} · ${c.server}`}><i></i>{c.name}</button>
          {/each}
        </div>
      {/each}
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
    <section class="mod raised c4 budget" class:slim={!slo.length && !sloSrc.failing.length} style="--in:.08s" aria-labelledby="a-budget">
      <h2 id="a-budget"><span>ERROR BUDGET</span><span>{slo[0]?.facts.windowDays ? `${slo[0].facts.windowDays.value} d` : ""}</span></h2>
      {#if sloSrc.failing.length}<Waiting title={`Can't read the error budget on ${sloSrc.failing[0]!.server}.`} warm>{sloSrc.failing[0]!.error}</Waiting>
      {:else if !slo.length}<Waiting title="No error budget reporting yet.">The lab's chaos SLO appears here when its source lands.</Waiting>
      {:else}<Budget {slo} />
      {/if}
    </section>

    {#if all.length}{@render checksMod()}{:else}{@render firingMod()}{/if}
  </div>
</div>

{#if open}<Drawer entity={open} {events} now={now.getTime()} onclose={() => (open = undefined)} />{/if}
