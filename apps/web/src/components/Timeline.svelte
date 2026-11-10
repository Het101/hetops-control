<script lang="ts">
  import type { Event } from "@hetops-control/contracts";
  import { fly, slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { reduced } from "../lib/motion.js";
  import { hhmm, span } from "../lib/pages.js";
  import { threads } from "../lib/incidents.js";
  // the newest rows, with each incident folded into one: what fell, what was done, and when it came back (lib/incidents.ts)
  let { events, limit = 6, error = false, wide = false, title = "Timeline · all servers" }:
    { events: Event[]; limit?: number; error?: boolean; wide?: boolean; title?: string } = $props();
  const time = (at: string) => at.slice(11, 16);
  const items = $derived(threads(events).slice(0, limit));
  let openKey = $state<string>();
  const SEV = { down: "Down", attention: "Needs a look" } as Record<string, string>;
</script>

<section class={`mod raised ${wide ? "c12" : "c7"} list`} style="--in:.4s" aria-labelledby="h-timeline" data-module="timeline">
  <h2 id="h-timeline"><span>{title}</span><span>latest {items.length}<a class="to" href="/timeline" aria-label="Open the Timeline">open →</a></span></h2>
  {#if error}<div class="empty warm">Could not load the event log; showing what the stream has sent.</div>{/if}
  {#each items as it, i (it.kind === "thread" ? it.key : `${it.e.at}|${it.e.server}|${it.e.summary}|${it.e.entity ?? ""}`)}
    <!-- a new row slides in at the top; the rows already shown stay put -->
    <div in:fly={{ y: -12, duration: $reduced ? 0 : 480, delay: $reduced ? 0 : Math.min(i, 6) * 40, easing: cubicOut }}>
      {#if it.kind === "event"}
        <div class="row">
          <span class="n">{time(it.e.at)}</span>
          <span class="t">{it.e.summary}<small>{it.e.server} · {it.e.source}{it.e.actor ? ` · ${it.e.actor}` : ""}</small></span>
          <span class="tag pressed">{it.e.server}</span>
        </div>
      {:else}
        {@const live = !it.closed}
        <button type="button" class="row incident" class:now={live} aria-expanded={openKey === it.key} onclick={() => (openKey = openKey === it.key ? undefined : it.key)}>
          <span class="n" style={live ? "color:var(--ember)" : undefined}>{time(it.opened)}</span>
          <span class="t">{it.events[0]!.summary}<small>{it.server} · incident · {it.events.length} step{it.events.length === 1 ? "" : "s"}{it.actions ? ` · ${it.actions} action${it.actions === 1 ? "" : "s"}` : ""}</small></span>
          {#if live}<span class="tag warm">{SEV[it.worst] ?? "Needs a look"}</span>
          {:else}<span class="tag pressed ok">Recovered {hhmm(it.closed!)}{it.lasted ? ` · ${span(it.lasted)}` : ""}</span>{/if}
          <i class="thread-chev" aria-hidden="true"></i>
        </button>
        {#if openKey === it.key}
          <ol class="steps" transition:slide={{ duration: $reduced ? 0 : 220 }}>
            {#each it.events as s (`${s.at}|${s.summary}`)}
              <li data-level={s.level ?? s.kind}><span class="n">{time(s.at)}</span><span class="t">{s.summary}<small>{s.source}{s.actor ? ` · ${s.actor}` : ""}</small></span></li>
            {/each}
          </ol>
        {/if}
      {/if}
    </div>
  {:else}
    {#if !error}<div class="empty">No events yet.</div>{/if}
  {/each}
</section>
