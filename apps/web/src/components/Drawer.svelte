<script lang="ts">
  import type { Entity, Event, Fact } from "@hetops-control/contracts";
  import Knob from "./Knob.svelte";
  import Glyph from "./Glyph.svelte";
  import { ago, hhmm, keyOf, needsYou } from "../lib/pages.js";

  // the detail drawer: a native modal dialog (focus trap, Esc and inert page come from the browser)
  let { entity, event, events, now, onclose }: { entity?: Entity; event?: Event; events: Event[]; now: number; onclose: () => void } = $props();
  let dlg = $state<HTMLDialogElement>();
  $effect(() => { if ((entity || event) && dlg && !dlg.open) dlg.showModal(); });

  const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d/;
  const show = (f: Fact) => typeof f.value === "boolean" ? (f.value ? "yes" : "no")
    : typeof f.value === "string" && ISO.test(f.value) ? `${f.value.slice(0, 10)} ${hhmm(f.value)} UTC · ${ago(f.value, now)}`
    : `${typeof f.value === "number" ? f.value.toLocaleString() : f.value}${f.unit ? ` ${f.unit}` : ""}${f.max !== undefined && f.unit !== "%" ? ` of ${f.max}` : ""}`;
  const history = $derived(entity ? events.filter(e => e.entity === entity.id).slice(0, 8) : []);
  const words = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();
</script>

<dialog bind:this={dlg} class="drawer raised" aria-labelledby="drawer-h" onclose={onclose}
  onclick={e => { if (e.target === dlg) dlg?.close(); }}>
  <div class="drawer-in">
    <header>
      <span class="kicker">{entity ? `${entity.kind.toUpperCase()} · ${entity.server.toUpperCase()}` : event ? `${event.kind.toUpperCase()} EVENT · ${event.server.toUpperCase()}` : ""}</span>
      <button type="button" class="knob raised x" aria-label="Close" onclick={() => dlg?.close()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </header>
    {#if event}
      <h2 id="drawer-h">{event.summary}</h2>
      <dl class="facts">
        <dt>When</dt><dd class="mono">{event.at.slice(0, 10)} {event.at.slice(11, 19)} UTC · {ago(event.at, now)}</dd>
        <dt>Server</dt><dd>{event.server}</dd><dt>Source</dt><dd>{event.source}</dd>
        {#if event.actor}<dt>Actor</dt><dd>{event.actor}</dd>{/if}
        {#if event.level}<dt>Moved to</dt><dd class:warm={needsYou(event.level)}>{event.level}</dd>{/if}
        {#if event.entity}<dt>Entity</dt><dd class="mono">{event.entity}</dd>{/if}
      </dl>
    {/if}
    {#if entity}
      {#if event}<h3 class="sub-h"><span>{entity.name} now</span></h3>{:else}<h2 id="drawer-h">{entity.name}</h2>{/if}
      <p class="state" class:warm={needsYou(entity.status)}>● {entity.status.toUpperCase()}{entity.statusReason ? ` · ${entity.statusReason}` : ""}</p>
      <dl class="facts">
        {#each Object.entries(entity.facts) as [k, f] (k)}<dt>{words(k)}</dt><dd>{show(f)}</dd>{/each}
        <dt>observed</dt><dd>{ago(entity.observedAt, now)}{entity.source ? ` · by ${entity.source}` : ""}</dd>
      </dl>
      <h3 class="sub-h"><span>OPEN IN</span></h3>
      {#if entity.links.length}
        <div class="links">{#each entity.links as l (l.href)}<a class="back raised" href={l.href} target="_blank" rel="noreferrer">{l.label} ↗</a>{/each}</div>
      {:else}<p class="note">This source reports no links for it yet.</p>{/if}
      {#if entity.actions.length}
        <h3 class="sub-h"><span>ACTIONS</span></h3>
        <div class="acts">{#each entity.actions as a (a.id)}<span class="act-l"><Knob {entity} action={a.id} label={`${a.label} ${entity.name}`} warm={needsYou(entity.status)} />{a.label}<small>{a.risk}</small></span>{/each}</div>
      {/if}
      {#if history.length}
        <h3 class="sub-h"><span>RECENT EVENTS</span></h3>
        <div class="list mini">{#each history as h (keyOf(h))}
          <div class="row"><Glyph kind={h.kind} warm={needsYou(h.level)} /><span class="n">{hhmm(h.at)}</span><span class="t">{h.summary}</span></div>{/each}</div>
      {/if}
    {:else if event?.entity}
      <p class="note">{event.entity} is not in the current state; it may have been removed since.</p>
    {/if}
  </div>
</dialog>
