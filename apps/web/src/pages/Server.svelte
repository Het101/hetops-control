<script lang="ts">
  import type { Entity, Event, ServerId } from "@hetops-control/contracts";
  import { num, type State } from "../lib/api.js";
  import { heading, ago, areas, DAY, hhmm, needsLook, needsYou, str, toneOf, workloads } from "../lib/pages.js";
  import Forest from "../components/Forest.svelte";
  import Dial from "../components/Dial.svelte";
  import Status from "../components/Status.svelte";
  import Timeline from "../components/Timeline.svelte";
  import Waiting from "../components/Waiting.svelte";
  import Drawer from "../components/Drawer.svelte";

  // One server, whole: its tree drawn large, how loaded it is now and over the day, the workloads that need a look, what its
  // agent reads and whether its host has drifted from Bedrock, and what happened on it.
  let { id, estate, events, now }: { id: ServerId; estate: State | undefined; events: Event[]; now: Date } = $props();
  const NAME: Record<ServerId, string> = { lab: "Lab", staging: "Staging", ops: "Ops" };
  let open = $state<Entity>();

  const t = $derived(now.getTime());
  const v = $derived(estate?.servers[id]);
  const ents = $derived(estate?.entities.filter(e => e.server === id) ?? []);
  const cluster = $derived(ents.find(e => e.kind === "cluster"));
  const nodes = $derived(ents.filter(e => e.kind === "node"));
  const most = (k: string) => { const x = nodes.map(n => num(n, k)).filter((y): y is number => y !== undefined); return x.length ? Math.max(...x) : undefined; };
  const work = $derived(estate ? workloads(estate.entities, id) : []);
  const look = $derived(work.filter(needsLook).sort((a, b) => Number(needsYou(b.status)) - Number(needsYou(a.status)) || a.name.localeCompare(b.name)));
  const spaces = $derived(new Set(work.map(e => str(e, "namespace") ?? "—")).size);
  const argo = $derived(ents.filter(e => e.kind === "argo-app"));
  const drift = $derived(estate?.entities.find(e => e.kind === "check" && e.source === "bedrock" && e.name === id));
  const own = $derived(events.filter(e => e.server === id));
  const cpu = $derived(estate?.series.find(s => s.id === `${id}/host/cpu`));
  const mem = $derived(estate?.series.find(s => s.id === `${id}/host/memory`));
  // the load chart spans the day, or what the agent has kept since it started (it holds its history in memory)
  const from = $derived(Math.max(t - DAY, Math.min(cpu?.points[0]?.[0] ?? t, mem?.points[0]?.[0] ?? t)));
  const W = 1000, H = 120;
  // a full day of 10-minute buckets reaches 23 h 50 min back: that is the whole day, said as 24 H
  const whole = $derived(t - from >= DAY - 15 * 60_000);
  const cpuArea = $derived(cpu ? areas(cpu, W, H, from, t, 100) : undefined);
  const memArea = $derived(mem ? areas(mem, W, H, from, t, 100) : undefined);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  const verdict = $derived(!v ? `${NAME[id]}, as its agent sees it.`
    : !v.configured ? `${NAME[id]} is not connected.`
    : !v.reachable ? `We can't reach ${NAME[id]}'s agent.`
    : look.some(e => needsYou(e.status)) || needsYou(v.status) ? `${NAME[id]} needs a look.`
    : v.status === "unknown" ? `${NAME[id]} reports nothing yet.` : `${NAME[id]} is healthy.`);
  const line = $derived([str(cluster, "version"), work.length ? plural(work.length, "workload") : undefined,
    num(cluster, "podsRunning") !== undefined ? `${num(cluster, "podsRunning")}/${num(cluster, "podsTotal")} pods` : undefined,
    v?.agentVersion ? `agent ${v.agentVersion}` : undefined].filter(Boolean).join(" · "));
  const run = (ok: boolean, error?: string, lastRunAt?: string) => ok ? { tone: "ok" as const, word: "OK" } : error || lastRunAt ? { tone: "warn" as const, word: "Failing" } : { tone: "blind" as const, word: "Pending" };
  const pct = (x: number | undefined) => (x === undefined ? "—" : `${Math.round(x)}%`);
</script>

<section class="page-intro">
  <span class="kicker">Server · {id}</span>
  <h1 tabindex="-1">{heading(verdict)}</h1>
  {#if line}<p class="intro-line mono">{line}{v?.statusReason ? ` · ${v.statusReason}` : ""}</p>{/if}
</section>

{#if !estate}
  <section class="mod raised"><Waiting title="Waiting for the center's first reading." /></section>
{:else if !v?.configured || !v.reachable}
  <section class="mod raised">
    <Waiting title={!v?.configured ? "No agent is configured for this server." : "Its agent is not answering."} warm={!!v?.configured}>
      {!v?.configured ? "Its tree, load and workloads appear here once its agent reports." : v.lastError ?? "Its last reading stays on the other pages until it answers again."}</Waiting>
  </section>
{:else}
<div class="grid">
  <section class="mod raised c8 srv-tree" style="--in:.04s" aria-label={`${NAME[id]}'s tree`}>
    <Forest state={estate} {events} only={id} />
  </section>
  <section class="mod raised c4" style="--in:.08s" aria-labelledby="sv-now">
    <h2 id="sv-now"><span>Host · now</span><span>{nodes.length > 1 ? `busiest of ${nodes.length} nodes` : nodes[0]?.name ?? ""}</span></h2>
    <div class="dials">
      <Dial id={`${id}-cpu`} label="CPU" value={most("cpu")} hot={nodes.some(n => needsYou(n.status))} />
      <Dial id={`${id}-mem`} label="Memory" value={most("memory")} />
      <Dial id={`${id}-disk`} label="Disk" value={most("disk")} />
    </div>
    {#each nodes.filter(n => n.statusReason) as n (n.id)}<p class="note" class:warm={needsYou(n.status)}>{n.name}: {n.statusReason}</p>{/each}
  </section>

  <section class="mod raised c12" style="--in:.12s" aria-labelledby="sv-load">
    <h2 id="sv-load"><span>Load · {whole ? "24 H" : `Since ${hhmm(from)} UTC`}</span><span>cpu {pct(most("cpu"))} · memory {pct(most("memory"))}</span></h2>
    {#if cpuArea?.segments.length || memArea?.segments.length}
      <svg class="load" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`CPU and memory of the busiest node since ${hhmm(from)} UTC`}>
        {#each [25, 50, 75] as g (g)}<line class="grid-l" x1="0" x2={W} y1={H - g / 100 * (H - 4)} y2={H - g / 100 * (H - 4)}/>{/each}
        {#each memArea?.segments ?? [] as s, i (i)}<path class="mem-a" d={s.area}/><path class="mem-l" d={s.line}/>{/each}
        {#each cpuArea?.segments ?? [] as s, i (i)}<path class="cpu-a" d={s.area}/><path class="cpu-l" d={s.line}/>{/each}
      </svg>
      <div class="ends mono"><span>{hhmm(from)} UTC</span><span>now</span></div>
      <p class="note">green = CPU · silver = memory · the busiest node, 10-minute means{whole ? "" : " · the agent keeps this since it last started"}</p>
    {:else}
      <Waiting title="No load history yet.">Its agent reports CPU and memory every 15 s; the line starts with its next reading.</Waiting>
    {/if}
  </section>

  <section class="mod raised c7 list" style="--in:.16s" aria-labelledby="sv-work">
    <h2 id="sv-work"><span>Workloads · {work.length}</span><span>{argo.length ? `${argo.filter(a => a.status === "ok").length}/${argo.length} argo healthy` : ""}<a class="to" href="/apps">open →</a></span></h2>
    {#each look as e (e.id)}
      {@const r = num(e, "restarts24h") ?? 0} {@const ready = num(e, "pods") ?? 0} {@const want = num(e, "podsDesired") ?? 0}
      <button type="button" class="row" class:now={needsYou(e.status)} onclick={() => (open = e)}>
        <span class="t">{e.name}<small>{str(e, "namespace") ?? ""}{ready < want ? ` · ${ready}/${want} ready` : r ? ` · ${plural(r, "restart")} · last ${ago(str(e, "lastRestartAt") ?? e.observedAt, t)}` : ""}</small></span>
        <Status tone={toneOf(e.status)} label={e.status} />
      </button>
    {/each}
    <p class="calm"><i aria-hidden="true"></i>{look.length ? `The other ${work.length - look.length} are healthy` : `All ${work.length} are healthy`}, across {plural(spaces, "namespace")}.</p>
  </section>

  <section class="mod raised c5 list" style="--in:.2s" aria-labelledby="sv-src">
    <h2 id="sv-src"><span>What its agent reads</span><span>{v.sources?.length ?? 0}</span></h2>
    {#each v.sources ?? [] as x (x.id)}
      {@const r = run(x.ok, x.error, x.lastRunAt)}
      <div class="row"><span class="t">{x.id}<small>{x.lastRunAt ? `last run ${ago(x.lastRunAt, t)}` : "not run yet"}</small>{#if x.error}<small class="warm">{x.error}</small>{/if}</span>
        <Status tone={r.tone} label={r.word} /></div>
    {/each}
    <div class="row"><span class="t">Bedrock drift<small>{drift ? drift.statusReason ?? `checked ${ago(str(drift, "lastRun") ?? drift.observedAt, t)}` : "no nightly drift check for this host yet"}</small></span>
      {#if drift}<Status tone={drift.facts.drift?.value === true ? "warn" : toneOf(drift.status)} label={drift.facts.drift?.value === true ? "Drifted" : "Clean"} />{:else}<Status tone="blind" label="Not run" />{/if}</div>
  </section>

  <Timeline events={own} limit={8} wide title={`Timeline · ${id}`} />
</div>
{/if}

{#if open}<Drawer entity={open} {events} now={t} onclose={() => (open = undefined)} />{/if}
