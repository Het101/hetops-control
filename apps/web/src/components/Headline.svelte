<script lang="ts">
  import { countUp } from "../lib/motion.js";
  import type { Headline } from "../lib/api.js";
  import type { Away } from "../lib/away.js";
  let { headline, now, away, ondismiss }: { headline: Headline; now: Date; away?: Away; ondismiss?: () => void } = $props();
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const when = (t: number) => { const d = new Date(t); return `${DAYS[d.getUTCDay()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`; };

  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const two = (n: number) => String(n).padStart(2, "0");
  const date = $derived(`${DAYS[now.getUTCDay()]} ${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} · ${two(now.getUTCHours())}:${two(now.getUTCMinutes())} UTC`);
  // standalone integers count up; times (03:12), versions and hashes stay as written
  const parts = $derived(headline.detail.split(/(?<![\w:.])(\d+)(?![\w:.])/));
</script>

<div class="hero-copy">
  <div class="date">{date}</div>
  {#if away}
    <!-- one line, then out of the way: what happened since you were last here; ember only for what still waits on you -->
    <p class="away" role="status">
      <span class="mono">SINCE {when(away.since)}</span>
      {away.events ? n(away.events, "event") : "nothing happened"}{#if away.recovered}, {away.recovered} recovered on {away.recovered === 1 ? "its" : "their"} own{/if}{#if away.waiting}, <b class="warm">{away.waiting} still waiting</b>{/if}.
      {#if away.events}<a href="/timeline">See them →</a>{/if}
      <button type="button" class="away-x" aria-label="Dismiss" onclick={ondismiss}>×</button>
    </p>
  {/if}
  <h1 class="headline" tabindex="-1">{headline.title}{#if headline.emphasis}<br><em>{headline.emphasis}</em>{/if}</h1>
  <div class="sub">{#each parts as p, i}{#if i % 2}<b use:countUp={Number(p)}></b>{:else}{p}{/if}{/each}</div>
</div>
