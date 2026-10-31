<script lang="ts">
  import type { Event } from "@hetops-control/contracts";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { reduced } from "../lib/motion.js";
  let { events, error = false, wide = false }: { events: Event[]; error?: boolean; wide?: boolean } = $props();
  const time = (at: string) => at.slice(11, 16);
  // a status change into attention or down is something to look at
  const hot = (e: Event) => e.level === "attention" || e.level === "down";
</script>

<section class={`mod raised ${wide ? "c12" : "c7"} list`} style="--in:.4s" aria-labelledby="h-timeline" data-module="timeline">
  <h4 id="h-timeline"><span>TIMELINE · ALL SERVERS</span><span>latest {events.length}<a class="to" href="/timeline" aria-label="Open the Timeline">open →</a></span></h4>
  {#if error}<div class="empty warm">Could not load the event log; showing what the stream has sent.</div>{/if}
  {#each events as e, i (`${e.at}|${e.server}|${e.summary}|${e.entity ?? ""}`)}
    {@const warm = hot(e)}
    <!-- a new event slides in at the top; the rows already shown stay put -->
    <div class="row" class:now={warm} in:fly={{ y: -12, duration: $reduced ? 0 : 480, delay: $reduced ? 0 : Math.min(i, 6) * 40, easing: cubicOut }}>
      <span class="n" style={warm ? "color:var(--ember)" : undefined}>{time(e.at)}</span>
      <span class="t">{e.summary}<small>{e.server} · {e.source}{e.actor ? ` · ${e.actor}` : ""}</small></span>
      {#if warm}<div class="knob ember" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
      {:else}<span class="tag pressed">{e.server.toUpperCase()}</span>{/if}
    </div>
  {:else}
    {#if !error}<div class="empty">No events yet.</div>{/if}
  {/each}
</section>
