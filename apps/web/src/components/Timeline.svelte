<script lang="ts">
  import type { Event } from "@hetops-control/contracts";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { reduced } from "../lib/motion.js";
  import { heat, hhmm } from "../lib/pages.js";
  let { events, error = false, wide = false, title = "TIMELINE · ALL SERVERS" }: { events: Event[]; error?: boolean; wide?: boolean; title?: string } = $props();
  const time = (at: string) => at.slice(11, 16);
  // a move to attention or down is something to look at, until the same entity recovers (lib/pages.ts heat)
  const heated = $derived(heat(events));
</script>

<section class={`mod raised ${wide ? "c12" : "c7"} list`} style="--in:.4s" aria-labelledby="h-timeline" data-module="timeline">
  <h2 id="h-timeline"><span>{title}</span><span>latest {events.length}<a class="to" href="/timeline" aria-label="Open the Timeline">open →</a></span></h2>
  {#if error}<div class="empty warm">Could not load the event log; showing what the stream has sent.</div>{/if}
  {#each events as e, i (`${e.at}|${e.server}|${e.summary}|${e.entity ?? ""}`)}
    {@const warm = heated.hot(e)}
    {@const back = heated.recovered(e)}
    <!-- a new event slides in at the top; the rows already shown stay put -->
    <div class="row" class:now={warm} in:fly={{ y: -12, duration: $reduced ? 0 : 480, delay: $reduced ? 0 : Math.min(i, 6) * 40, easing: cubicOut }}>
      <span class="n" style={warm ? "color:var(--ember)" : undefined}>{time(e.at)}</span>
      <span class="t">{e.summary}<small>{e.server} · {e.source}{e.actor ? ` · ${e.actor}` : ""}</small></span>
      {#if warm}<div class="knob ember" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
      {:else}<span class="tag pressed" class:ok={!!back}>{back ? `RECOVERED ${hhmm(back)}` : e.server.toUpperCase()}</span>{/if}
    </div>
  {:else}
    {#if !error}<div class="empty">No events yet.</div>{/if}
  {/each}
</section>
