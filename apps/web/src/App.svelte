<script lang="ts">
  import { tick } from "svelte";
  import type { Event } from "@hetops-control/contracts";
  import { follow, mergeEvents, SILENCE_MS, type State } from "./lib/api.js";
  import Rail from "./components/Rail.svelte";
  import Home from "./pages/Home.svelte";
  import Settings from "./pages/Settings.svelte";
  import TimelinePage from "./pages/Timeline.svelte";
  import Alerts from "./pages/Alerts.svelte";
  import Apps from "./pages/Apps.svelte";
  import Backups from "./pages/Backups.svelte";
  import Security from "./pages/Security.svelte";
  import Upcoming from "./pages/Upcoming.svelte";
  import NotFound from "./pages/NotFound.svelte";
  import { isPage, PAGES, route, type Upcoming as UpcomingPath } from "./lib/router.svelte.js";

  // Home shows the latest 6; the Timeline page keeps the most the center serves
  const SHOWN = 6, KEEP = 500, DOWN_MS = 10_000;
  let estate = $state<State>();
  let events = $state<Event[]>([]);
  let eventsError = $state(false);
  let now = $state(new Date());
  let lastMsg = $state<number>();
  let downSince = $state<number | undefined>(Date.now());

  $effect(() => {
    const stop = follow({
      state: s => { estate = s; lastMsg = Date.now(); },
      event: e => { events = mergeEvents(events, [e], KEEP); lastMsg = Date.now(); },
      events: list => { events = mergeEvents(events, list, KEEP); eventsError = false; },
      eventsFailed: err => { console.warn(err); eventsError = true; },
      link: open => { if (open) downSince = undefined; else downSince ??= Date.now(); },
    }, KEEP);
    const tick = setInterval(() => (now = new Date()), 1000);
    return () => { stop(); clearInterval(tick); };
  });

  // each navigation names the page and moves focus to its heading, so screen readers hear the change
  let first = true;
  $effect(() => {
    const path = route.path;
    document.title = `${isPage(path) ? PAGES[path] : "Not found"} · HetOps Control`;
    if (first) { first = false; return; }
    tick().then(() => document.querySelector<HTMLElement>("main h1")?.focus());
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

    {#if route.path === "/"}
      {#if estate}<Home {estate} {events} {eventsError} {now} shown={SHOWN} />{/if}
    {:else if route.path === "/timeline"}
      <TimelinePage {estate} {events} error={eventsError} {now} />
    {:else if route.path === "/alerts"}
      <Alerts {estate} {events} {now} />
    {:else if route.path === "/apps"}
      <Apps {estate} {events} {now} />
    {:else if route.path === "/backups"}
      <Backups {estate} {events} {now} />
    {:else if route.path === "/security"}
      <Security {estate} {events} {now} />
    {:else if route.path === "/settings"}
      <Settings {estate} {now} />
    {:else if isPage(route.path)}
      <Upcoming path={route.path as UpcomingPath} /><!-- every other page is matched above -->
    {:else}
      <NotFound path={route.path} />
    {/if}
  </main>
</div>
