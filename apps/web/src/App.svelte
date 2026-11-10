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
  import Topology from "./pages/Topology.svelte";
  import NotFound from "./pages/NotFound.svelte";
  import Server from "./pages/Server.svelte";
  import { isPage, PAGES, route, serverOf } from "./lib/router.svelte.js";
  import ActionDialog from "./components/ActionDialog.svelte";
  import Toasts from "./components/Toasts.svelte";
  import NeedsQueue from "./components/NeedsQueue.svelte";
  import { catalog, track } from "./lib/action-state.svelte.js";
  import { away, AWAY_MS, lastSeen, markSeen } from "./lib/away.js";
  import { pinned, place, sky } from "./lib/sky.js";

  // Home shows the latest 6; the Timeline page keeps the most the center serves
  const SHOWN = 6, KEEP = 500, DOWN_MS = 10_000;
  let estate = $state<State>();
  let events = $state<Event[]>([]);
  let eventsError = $state(false);
  let now = $state(new Date());
  let lastMsg = $state<number>();
  let downSince = $state<number | undefined>(Date.now());
  let signedOut = $state(false);

  $effect(() => {
    const stop = follow({
      state: s => { estate = s; catalog.list = s.actions ?? []; lastMsg = Date.now(); },
      event: e => { events = mergeEvents(events, [e], KEEP); lastMsg = Date.now(); },
      events: list => { events = mergeEvents(events, list, KEEP); eventsError = false; },
      eventsFailed: err => { console.warn(err); eventsError = true; },
      action: r => track(r),
      link: open => { if (open) downSince = undefined; else downSince ??= Date.now(); },
      signedOut: () => { signedOut = true; },
    }, KEEP);
    const tick = setInterval(() => (now = new Date()), 1000);
    return () => { stop(); clearInterval(tick); };
  });

  // each navigation names the page and moves focus to its heading, so screen readers hear the change
  let first = true;
  $effect(() => {
    const path = route.path;
    const srv = serverOf(path);
    document.title = `${isPage(path) ? PAGES[path] : srv ? srv.charAt(0).toUpperCase() + srv.slice(1) : "Not found"} · HetOps Control`;
    if (first) { first = false; return; }
    tick().then(() => document.querySelector<HTMLElement>("main h1")?.focus());
  });

  // while you were away: the time you were last here, read once on arrival (and again when the tab comes back after a while);
  // "last here" is kept fresh every minute while the page is visible and when you leave
  const seen = lastSeen();
  let awaySince = $state<number | undefined>(seen !== undefined && Date.now() - seen >= AWAY_MS ? seen : undefined);
  $effect(() => {
    markSeen();
    const keep = setInterval(() => { if (document.visibilityState === "visible") markSeen(); }, 60_000);
    const vis = () => {
      if (document.visibilityState === "hidden") { markSeen(); return; }
      const s = lastSeen(); if (s !== undefined && Date.now() - s >= AWAY_MS) awaySince = s;
      markSeen();
    };
    document.addEventListener("visibilitychange", vis); addEventListener("pagehide", vis);
    return () => { clearInterval(keep); document.removeEventListener("visibilitychange", vis); removeEventListener("pagehide", vis); };
  });
  const gone = $derived(awaySince === undefined ? undefined : away(events, awaySince, now.getTime()));

  const ago = $derived(lastMsg === undefined ? undefined : Math.max(0, Math.round((now.getTime() - lastMsg) / 1000)));
  // down for 10 s, or open but silent past the watchdog's limit
  // while the link is down, every page measures ages from the last data it has, not the running clock: frozen data aged by a
  // live clock invents alarms ("logs stopped 1 h 44 min ago" when the page, not the logs, had stopped)
  const stale = $derived(signedOut || (lastMsg !== undefined && (downSince !== undefined && now.getTime() - downSince >= DOWN_MS || now.getTime() - lastMsg > SILENCE_MS)));
  const shown = $derived(stale && lastMsg !== undefined ? new Date(lastMsg) : now);
  const hhmmUTC = (t: number) => `${new Date(t).toISOString().slice(11, 16)} UTC`;
  const reconnecting = $derived((downSince !== undefined && now.getTime() - downSince >= DOWN_MS) || (ago !== undefined && ago * 1000 > SILENCE_MS));
  // the hour and season where the viewer is, on <html>: tokens tint the room (warmer at dawn and dusk, cooler at night)
  $effect(() => {
    const set = () => { const s = pinned(sky(new Date(), place()), new URLSearchParams(location.search)); document.documentElement.dataset.phase = s.phase; document.documentElement.dataset.ritu = s.ritu.id; };
    set(); const t = setInterval(set, 60_000); return () => clearInterval(t);
  });
</script>

<div class="app">
  <Rail />
  <main>
    <div class="top">
      <span class="brand">HetOps Control</span>
      {#if estate}<NeedsQueue needs={estate.headline.needs} entities={estate.entities} />{/if}
      <span class="live" class:warm={reconnecting || signedOut} role="status">
        {#key lastMsg}<span class="pulse"></span>{/key}{signedOut ? "signed out" : reconnecting ? "reconnecting" : ago === undefined ? "connecting" : `live · ${ago} s ago`}{#if stale && lastMsg !== undefined}<small>{` · showing ${hhmmUTC(lastMsg)}`}</small>{/if}</span>
    </div>
    {#if signedOut}
      <!-- the one thing that brings the page back is a fresh sign-in: Access shows its login on reload, then the page resumes -->
      <div class="signed-out" role="alert">
        <span><b>Your sign-in has ended.</b> What you see is from {lastMsg !== undefined ? hhmmUTC(lastMsg) : "before"} and is not updating.</span>
        <button type="button" class="ember-btn wide" onclick={() => location.reload()}>Sign in again</button>
      </div>
    {/if}

    {#if route.path === "/"}
      {#if estate}<Home {estate} {events} {eventsError} now={shown} shown={SHOWN} away={gone} ondismiss={() => (awaySince = undefined)} />{/if}
    {:else if route.path === "/timeline"}
      <TimelinePage {estate} {events} error={eventsError} now={shown} />
    {:else if route.path === "/alerts"}
      <Alerts {estate} {events} now={shown} />
    {:else if route.path === "/apps"}
      <Apps {estate} {events} now={shown} />
    {:else if route.path === "/backups"}
      <Backups {estate} {events} now={shown} />
    {:else if route.path === "/security"}
      <Security {estate} {events} now={shown} />
    {:else if route.path === "/topology"}
      <Topology {estate} now={shown} />
    {:else if route.path === "/settings"}
      <Settings {estate} now={shown} />
    {:else if serverOf(route.path)}
      {#key route.path}<Server id={serverOf(route.path)!} {estate} {events} now={shown} />{/key}
    {:else}
      <NotFound path={route.path} />
    {/if}
  </main>
</div>
<ActionDialog />
<Toasts />
