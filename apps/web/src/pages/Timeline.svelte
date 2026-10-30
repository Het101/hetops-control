<script lang="ts">
  import type { Event } from "@hetops-control/contracts";
  import type { State } from "../lib/api.js";
  import { byHour, eventDays, facets, filterEvents, hhmm, hotEvent, hourly, keyOf, levelOf } from "../lib/pages.js";
  import Chips from "../components/Chips.svelte";
  import Search from "../components/Search.svelte";
  import Glyph from "../components/Glyph.svelte";
  import Drawer from "../components/Drawer.svelte";
  import Waiting from "../components/Waiting.svelte";

  let { estate, events, error, now }: { estate: State | undefined; events: Event[]; error: boolean; now: Date } = $props();

  let server = $state<string[]>([]), kind = $state<string[]>([]), source = $state<string[]>([]), level = $state<string[]>([]), q = $state("");
  let day = $state<string>(), hour = $state<number>();
  let open = $state<Event>();

  const days = $derived(eventDays(events));
  const shownDay = $derived(day && days.includes(day) ? day : days[0]);
  // the scrubber shows the chosen day under the chip filters, so its bars always match the list below
  const chipped = $derived(filterEvents(events, { server, kind, source, level, q }));
  const bars = $derived(shownDay ? hourly(chipped, shownDay) : []);
  const peak = $derived(Math.max(1, ...bars.map(b => b.n)));
  const list = $derived(filterEvents(chipped, { server: [], kind: [], source: [], level: [], q: "", day: hour === undefined ? undefined : shownDay, hour }));
  const groups = $derived(byHour(list));
  const LEVEL: Record<string, string> = { down: "down", attention: "attention", ok: "recovered", unknown: "unknown", none: "no status" };
  const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toUTCString().slice(0, 11).toUpperCase();
  const span = $derived(events.length ? `since ${events.at(-1)!.at.slice(0, 10) === events[0]!.at.slice(0, 10) ? hhmm(events.at(-1)!.at) : dayName(events.at(-1)!.at.slice(0, 10))}` : "");
  const servers = $derived(new Set(events.map(e => e.server)).size);
  const pickHour = (h: number) => { hour = hour === h ? undefined : h; };
</script>

<section class="page-intro">
  <span class="kicker">TIMELINE · ALL SERVERS</span>
  <h1 tabindex="-1">{events.length ? `${events.length} events across ${servers} server${servers === 1 ? "" : "s"}, ${span}.` : "Every event from every server, in one place."}</h1>
</section>

<div class="grid">
  <section class="mod raised c12 scrub" style="--in:.04s" aria-labelledby="t-day">
    <h4 id="t-day"><span>DAY · EVENTS PER HOUR (UTC)</span><span>{hour === undefined ? "pick an hour to narrow the list" : `${String(hour).padStart(2, "0")}:00 to ${String(hour).padStart(2, "0")}:59 · `}{#if hour !== undefined}<button type="button" class="linkish" onclick={() => (hour = undefined)}>clear</button>{/if}</span></h4>
    {#if days.length}
      <div class="days" role="group" aria-label="Day">
        {#each days.slice(0, 7) as d (d)}<button type="button" class="chip" class:on={d === shownDay} aria-pressed={d === shownDay} onclick={() => { day = d; hour = undefined; }}>{dayName(d)}</button>{/each}
      </div>
      <div class="hours" role="group" aria-label="Hour">
        {#each bars as b (b.hour)}
          <button type="button" class="hr" onclick={() => pickHour(b.hour)} class:on={hour === b.hour} class:dim={hour !== undefined && hour !== b.hour} disabled={!b.n}
            aria-pressed={hour === b.hour} aria-label={`${String(b.hour).padStart(2, "0")}:00, ${b.n} event${b.n === 1 ? "" : "s"}${b.hot ? `, ${b.hot} needing a look` : ""}`}
            style={`--h:${b.n / peak};--w:${b.n ? b.hot / b.n : 0}`}>
            <span class="bar"><i></i><b></b></span><small class="mono">{b.hour % 3 === 0 ? String(b.hour).padStart(2, "0") : ""}</small>
          </button>
        {/each}
      </div>
    {:else}
      <Waiting title={error ? "Could not load the event log." : "No events yet."} warm={error}>{error ? "Events from the live stream still appear below as they happen." : "Deploys, syncs, restarts and status changes land here as the agents report them."}</Waiting>
    {/if}
  </section>

  <section class="mod raised c12 list feed" style="--in:.1s" aria-labelledby="t-feed">
    <h4 id="t-feed"><span>FEED</span><span>{list.length} of {events.length}</span></h4>
    <div class="filters">
      <Search bind:q placeholder="Search events, apps, people" />
      <Chips label="Server" bind:selected={server} options={facets(events, e => e.server)} />
      <Chips label="Kind" bind:selected={kind} options={facets(events, e => e.kind)} />
      <Chips label="Source" bind:selected={source} options={facets(events, e => e.source)} />
      <Chips label="Level" bind:selected={level} options={facets(events, levelOf)} name={v => LEVEL[v] ?? v} />
    </div>
    {#if error && events.length}<Waiting title="Could not load the event log." warm>Showing what the live stream has sent since this page opened.</Waiting>{/if}
    {#each groups as g (g.key)}
      <div class="hour-h mono"><span>{g.label}</span><span>{dayName(g.day)}</span><span>{g.events.length}</span></div>
      {#each g.events as e (keyOf(e))}
        {@const warm = hotEvent(e)}
        <button type="button" class="row" class:now={warm} data-kind={e.kind} onclick={() => (open = e)}>
          <Glyph kind={e.kind} {warm} />
          <span class="n" class:warm>{e.at.slice(11, 19)}</span>
          <span class="t">{e.summary}<small>{e.server} · {e.source}{e.actor ? ` · ${e.actor}` : ""}{e.level ? ` · ${LEVEL[e.level] ?? e.level}` : ""}</small></span>
          <span class="tag pressed" class:warm>{warm ? (e.level ?? "").toUpperCase() : e.server.toUpperCase()}</span>
        </button>
      {/each}
    {:else}
      {#if events.length}<Waiting title="Nothing matches these filters.">Clear a chip or the search to see more.</Waiting>{/if}
    {/each}
  </section>
</div>

{#if open}<Drawer event={open} entity={estate?.entities.find(x => x.id === open?.entity)} {events} now={now.getTime()} onclose={() => (open = undefined)} />{/if}
