<script lang="ts">
  import type { Entity, Event } from "@hetops-control/contracts";
  import { num, type State } from "../lib/api.js";
  import { ago, BACKUP_WINDOW_H, backupView, countdown, hhmm, needsYou, sourceState, span, str } from "../lib/pages.js";
  import Knob from "../components/Knob.svelte";
  import Drawer from "../components/Drawer.svelte";
  import Waiting from "../components/Waiting.svelte";

  let { estate, events, now }: { estate: State | undefined; events: Event[]; now: Date } = $props();
  let open = $state<Entity>();

  const t = $derived(now.getTime());
  const list = $derived((estate?.entities.filter(e => e.kind === "backup") ?? []).sort((a, b) => Number(needsYou(b.status)) - Number(needsYou(a.status)) || a.name.localeCompare(b.name))
    .map(e => ({ e, v: backupView(e, t) })));
  const src = $derived(sourceState(estate, "snapshots"));
  const needing = $derived(list.filter(x => needsYou(x.e.status)).length);
  const kept = $derived(list.reduce((n, x) => n + (num(x.e, "snapshots") ?? 0), 0));
  const failed = $derived(list.reduce((n, x) => n + (num(x.e, "failed") ?? 0), 0));
  const soonest = $derived(list.map(x => x.v.next).filter((n): n is number => n !== undefined).sort((a, b) => a - b)[0]);
  // the age dial: a ring that fills as the last success ages toward the 26 h window
  const R = 17, C = 2 * Math.PI * R;
  const changes = (id: string) => events.filter(x => x.entity === id && x.kind === "status").length;
</script>

<section class="page-intro">
  <span class="kicker">BACKUPS</span>
  <h1 tabindex="-1">{!list.length ? "Whether the last backup of everything that matters worked."
    : needing ? `${needing} backup${needing === 1 ? " needs" : "s need"} you.` : `Every backup succeeded in the last ${BACKUP_WINDOW_H} hours.`}</h1>
</section>

<div class="grid">
  <section class="mod raised c12 tally" style="--in:.04s" aria-label="Backups at a glance">
    <div class="tal"><b>{list.length}</b><span class="mono">POLICIES</span></div>
    <div class="tal"><b class:warm={needing > 0}>{needing}</b><span class="mono">NEED YOU</span></div>
    <div class="tal"><b>{kept.toLocaleString()}</b><span class="mono">SNAPSHOTS KEPT</span></div>
    <div class="tal"><b>{failed}</b><span class="mono">FAILED, ALL TIME</span></div>
    <div class="tal"><b class="sm">{soonest === undefined ? "—" : countdown(soonest - t)}</b><span class="mono">NEXT RUN</span></div>
  </section>

  <section class="mod raised c12 list player" style="--in:.1s" aria-labelledby="b-list">
    <h4 id="b-list"><span>EVERY POLICY · LAST RESULT</span><span>age against {BACKUP_WINDOW_H} h</span></h4>
    {#if src.failing.length}<Waiting title={`Can't read snapshots on ${src.failing.map(f => f.server).join(", ")}.`} warm>{src.failing[0]!.error}. The rows below are not current.</Waiting>{/if}
    {#each list as { e, v }, i (e.id)}
      {@const warm = needsYou(e.status)}
      <div class="row" class:now={warm} data-backup={e.id}>
        <span class="n mono">{String(i + 1).padStart(2, "0")}</span>
        <button type="button" class="open" onclick={() => (open = e)}>
          <span class="age" role="img" aria-label={v.ageH === undefined ? "never succeeded" : `last success ${Math.round(v.ageH)} hours ago`}>
            <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r={R} class="track"/>
              <circle cx="22" cy="22" r={R} class="arc-age" class:warm={v.overdue || warm} stroke-dasharray={`${C} ${C}`} style={`stroke-dashoffset:${C * (1 - v.frac)}`} transform="rotate(-90 22 22)"/></svg>
            <b class="mono">{v.ageH === undefined ? "—" : v.ageH < 1 ? "<1h" : `${Math.floor(v.ageH)}h`}</b>
          </span>
          <span class="t">{e.name}<small>{[str(e, "repository") && `to ${str(e, "repository")}`, str(e, "indices")].filter(Boolean).join(" · ") || e.server}</small>
            {#if warm && e.statusReason}<small class="warm">{e.statusReason}</small>{/if}</span>
          <span class="col"><small>last ok</small>{v.ok ? `${hhmm(v.ok)} UTC` : "never"}<small>{v.ok ? ago(v.ok, t) : ""}</small></span>
          <span class="col"><small>next run</small><span class:warm={v.nextIn !== undefined && v.nextIn < -15 * 60_000}>{countdown(v.nextIn)}</span><small>{v.next ? `${hhmm(v.next)} UTC` : ""}</small></span>
          <span class="col hist"><small>history</small>{num(e, "snapshots") ?? "—"} kept · <span class:warm={v.failedLast}>{num(e, "failed") ?? 0} failed</span>
            <small class:warm={v.failedLast}>{v.bad ? `last failure ${ago(v.bad, t)}` : "no failure on record"}{changes(e.id) ? ` · ${changes(e.id)} changes` : ""}</small></span>
        </button>
        <Knob entity={e} action="snapshot.now" label={`Snapshot ${e.name} now`} {warm} />
      </div>
    {:else}
      {#if !src.failing.length}<Waiting title={src.reporting.length ? "The snapshot source reports no policies." : "No backup source reporting yet."}>Each snapshot policy appears here with its last result, its age, the next run and its failures.</Waiting>{/if}
    {/each}
    {#if list.length}<p class="note">the ring fills as the last success ages; full and ember at {BACKUP_WINDOW_H} h · next run {soonest ? `in ${span(Math.max(0, soonest - t))}` : "not scheduled"}</p>{/if}
  </section>
</div>

{#if open}<Drawer entity={open} {events} now={t} onclose={() => (open = undefined)} />{/if}
