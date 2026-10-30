<script lang="ts">
  import type { Event } from "@hetops-control/contracts";
  import { follow, loadEvents, type State } from "./lib/api.js";
  import Rail from "./components/Rail.svelte";
  import Headline from "./components/Headline.svelte";
  import NeedsYou from "./components/NeedsYou.svelte";
  import Forest from "./components/Forest.svelte";
  import HostLoad from "./components/HostLoad.svelte";
  import Timeline from "./components/Timeline.svelte";

  const SHOWN = 6, STALE_MS = 10_000;
  let estate = $state<State>();
  let events = $state<Event[]>([]);
  let now = $state(new Date());
  let lastMsg = $state<number>();
  let downSince = $state<number | undefined>(Date.now());

  const newest = (list: Event[]) => [...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, SHOWN);

  $effect(() => {
    loadEvents(SHOWN).then(e => { events = newest([...e, ...events]); }, e => console.warn(e));
    const stop = follow({
      state: s => { estate = s; lastMsg = Date.now(); },
      event: e => { events = newest([e, ...events]); lastMsg = Date.now(); },
      link: open => { if (open) downSince = undefined; else downSince ??= Date.now(); },
    });
    const tick = setInterval(() => (now = new Date()), 1000);
    return () => { stop(); clearInterval(tick); };
  });

  const reconnecting = $derived(downSince !== undefined && now.getTime() - downSince >= STALE_MS);
  const ago = $derived(lastMsg === undefined ? undefined : Math.max(0, Math.round((now.getTime() - lastMsg) / 1000)));
</script>

<div class="app">
  <Rail />
  <main>
    <div class="top">
      <span class="brand">HETOPS CONTROL</span>
      <span class="live" class:warm={reconnecting}><span class="pulse"></span>{reconnecting ? "reconnecting" : ago === undefined ? "connecting" : `live · ${ago} s ago`}</span>
    </div>

    {#if estate}
      <section class="hero raised">
        <Headline headline={estate.headline} {now} />
        <NeedsYou needs={estate.headline.needs} />
        <Forest state={estate} />
      </section>
      <div class="grid">
        <HostLoad state={estate} />
        <Timeline {events} />
      </div>
    {/if}
  </main>
</div>
