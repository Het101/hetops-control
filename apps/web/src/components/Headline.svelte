<script lang="ts">
  import { heading } from "../lib/pages.js";
  import { countUp } from "../lib/motion.js";
  import type { Headline } from "../lib/api.js";
  import type { Away } from "../lib/away.js";
  import { pinned, place, sky } from "../lib/sky.js";
  let { headline, now, away, ondismiss }: { headline: Headline; now: Date; away?: Away; ondismiss?: () => void } = $props();
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const when = (t: number) => { const d = new Date(t); return `${DAYS[d.getUTCDay()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`; };

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const two = (n: number) => String(n).padStart(2, "0");
  const date = $derived(`${DAYS[now.getUTCDay()]} ${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} · ${two(now.getUTCHours())}:${two(now.getUTCMinutes())} UTC`);
  // the season and the hour where the viewer is: the same sky the scene draws
  const season = $derived.by(() => { const s = pinned(sky(now, place()), new URLSearchParams(typeof location === "undefined" ? "" : location.search)); return `${s.ritu.name} · ${s.phase}`; });
  // standalone integers count up; times (03:12), versions and hashes stay as written
  const parts = $derived(headline.detail.split(/(?<![\w:.])(\d+)(?![\w:.])/));
</script>

<div class="hero-copy">
  <div class="date">{date} · <span title="The season (ritu) and time of day where you are">{season}</span></div>
  {#if away}
    <!-- one line, then out of the way: what happened since you were last here; ember only for what still waits on you -->
    <p class="away" role="status">
      <span class="mono">Since {when(away.since)}</span>
      {away.events ? n(away.events, "event") : "nothing happened"}{#if away.recovered}, {away.recovered} recovered on {away.recovered === 1 ? "its" : "their"} own{/if}{#if away.waiting}, <b class="warm">{away.waiting} still waiting</b>{/if}.
      {#if away.events}<a href="/timeline">See them →</a>{/if}
      <button type="button" class="away-x" aria-label="Dismiss" onclick={ondismiss}>×</button>
    </p>
  {/if}
  <h1 class="headline" tabindex="-1">{heading(headline.title)}{#if headline.emphasis}<br><em>{heading(headline.emphasis)}</em>{/if}</h1>
  <div class="sub">{#each parts as p, i}{#if i % 2}<b use:countUp={Number(p)}></b>{:else}{p}{/if}{/each}</div>
</div>
