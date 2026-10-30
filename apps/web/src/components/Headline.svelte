<script lang="ts">
  import { countUp } from "../lib/motion.js";
  import type { Headline } from "../lib/api.js";
  let { headline, now }: { headline: Headline; now: Date } = $props();

  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const two = (n: number) => String(n).padStart(2, "0");
  const date = $derived(`${DAYS[now.getUTCDay()]} ${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} · ${two(now.getUTCHours())}:${two(now.getUTCMinutes())} UTC`);
  // standalone integers count up; times (03:12), versions and hashes stay as written
  const parts = $derived(headline.detail.split(/(?<![\w:.])(\d+)(?![\w:.])/));
</script>

<div class="hero-copy">
  <div class="date">{date}</div>
  <h1 class="headline" tabindex="-1">{headline.title}{#if headline.emphasis}<br><em>{headline.emphasis}</em>{/if}</h1>
  <div class="sub">{#each parts as p, i}{#if i % 2}<b use:countUp={Number(p)}></b>{:else}{p}{/if}{/each}</div>
</div>
