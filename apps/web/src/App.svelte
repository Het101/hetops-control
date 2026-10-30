<script lang="ts">
  import type { Event } from "@hetops-control/contracts";
  import { follow, mergeEvents, SILENCE_MS, type State } from "./lib/api.js";
  import Rail from "./components/Rail.svelte";
  import Headline from "./components/Headline.svelte";
  import NeedsYou from "./components/NeedsYou.svelte";
  import Forest from "./components/Forest.svelte";
  import HostLoad from "./components/HostLoad.svelte";
  import Timeline from "./components/Timeline.svelte";

  const SHOWN = 6, DOWN_MS = 10_000;
  let estate = $state<State>();
  let events = $state<Event[]>([]);
  let eventsError = $state(false);
  let now = $state(new Date());
  let lastMsg = $state<number>();
  let downSince = $state<number | undefined>(Date.now());

  $effect(() => {
    const stop = follow({
      state: s => { estate = s; lastMsg = Date.now(); },
      event: e => { events = mergeEvents(events, [e], SHOWN); lastMsg = Date.now(); },
      events: list => { events = mergeEvents(events, list, SHOWN); eventsError = false; },
      eventsFailed: err => { console.warn(err); eventsError = true; },
      link: open => { if (open) downSince = undefined; else downSince ??= Date.now(); },
    }, SHOWN);
    const tick = setInterval(() => (now = new Date()), 1000);
    return () => { stop(); clearInterval(tick); };
  });

  const ago = $derived(lastMsg === undefined ? undefined : Math.max(0, Math.round((now.getTime() - lastMsg) / 1000)));
  // down for 10 s, or open but silent past the watchdog's limit
  const reconnecting = $derived((downSince !== undefined && now.getTime() - downSince >= DOWN_MS) || (ago !== undefined && ago * 1000 > SILENCE_MS));
</script>

<div class="app">
  <Rail />
  <main>
    <div class="top">
      <span class="brand">HETOPS CONTROL</span>
      <span class="live" class:warm={reconnecting} role="status">
        <span class="pulse"></span>{reconnecting ? "reconnecting" : ago === undefined ? "connecting" : `live · ${ago} s ago`}</span>
    </div>

    {#if estate}
      <section class="hero raised">
        <Headline headline={estate.headline} {now} />
        <NeedsYou needs={estate.headline.needs} />
        <Forest state={estate} />
      </section>
      <div class="grid">
        <HostLoad state={estate} />
        <Timeline {events} error={eventsError} />
      </div>
    {/if}
  </main>
</div>
