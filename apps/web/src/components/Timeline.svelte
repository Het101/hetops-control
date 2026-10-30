<script lang="ts">
  import type { Event } from "@hetops-control/contracts";
  let { events }: { events: Event[] } = $props();
  const time = (at: string) => at.slice(11, 16);
  // a status change into attention or down is something to look at
  const hot = (e: Event) => e.kind === "status" && /→ (attention|down)\b/.test(e.summary);
</script>

<section class="mod raised c7 list" style="--in:.18s">
  <h4><span>TIMELINE · ALL SERVERS</span><span>latest {events.length}</span></h4>
  {#each events as e}
    {@const warm = hot(e)}
    <div class="row" class:now={warm}>
      <span class="n" style={warm ? "color:var(--ember)" : undefined}>{time(e.at)}</span>
      <span class="t">{e.summary}<small>{e.server} · {e.source}{e.actor ? ` · ${e.actor}` : ""}</small></span>
      {#if warm}<div class="knob ember" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
      {:else}<span class="tag pressed">{e.server.toUpperCase()}</span>{/if}
    </div>
  {:else}
    <div class="empty">No events yet.</div>
  {/each}
</section>
