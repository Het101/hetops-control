<script lang="ts">
  import { ServerIdSchema, type Entity, type Event } from "@hetops-control/contracts";
  import { num, type State } from "../lib/api.js";
  import { ago, facets, matches, needsYou, picked, pips, serverApps, sourceState, str, time } from "../lib/pages.js";
  import Chips from "../components/Chips.svelte";
  import Search from "../components/Search.svelte";
  import Knob from "../components/Knob.svelte";
  import Drawer from "../components/Drawer.svelte";
  import Waiting from "../components/Waiting.svelte";

  let { estate, events, now }: { estate: State | undefined; events: Event[]; now: Date } = $props();
  let server = $state<string[]>([]), mood = $state<string[]>([]), q = $state("");
  let open = $state<Entity>();

  const t = $derived(now.getTime());
  const ents = $derived(estate?.entities ?? []);
  const STATE = (e: Entity) => needsYou(e.status) ? "needs you" : e.status === "unknown" ? "can't tell" : "healthy";
  const keep = (e: Entity) => picked(server, e.server) && picked(mood, STATE(e)) && matches(q, e.name, e.id, str(e, "namespace"), str(e, "fqdn"));
  const pool = $derived(ents.filter(e => ["app", "argo-app", "site"].includes(e.kind)));
  const argo = $derived(pool.filter(e => e.kind === "argo-app" && keep(e)).sort((a, b) => Number(needsYou(b.status)) - Number(needsYou(a.status)) || a.name.localeCompare(b.name)));
  const coolify = $derived(pool.filter(e => e.kind === "app" && e.source === "coolify" && keep(e)));
  const work = $derived(pool.filter(e => e.kind === "app" && e.source !== "coolify" && keep(e)));
  const sites = $derived(pool.filter(e => e.kind === "site" && keep(e)).sort((a, b) => a.name.localeCompare(b.name)));
  const nsOf = (e: Entity) => str(e, "namespace") ?? "—";
  // one dense grid per server, ordered by namespace; the namespace rides on each tile
  const spaces = $derived(ServerIdSchema.options.map(server => ({ key: server, server,
    apps: work.filter(e => e.server === server).sort((a, b) => nsOf(a).localeCompare(nsOf(b)) || a.name.localeCompare(b.name)) })).filter(g => g.apps.length));
  const sums = $derived(ServerIdSchema.options.map(id => ({ id, view: estate?.servers[id], ...serverApps(ents, id) })));
  const total = $derived(pool.filter(e => e.kind !== "site").length);
  const needing = $derived(pool.filter(e => needsYou(e.status)).length);
  const cool = $derived(sourceState(estate, "coolify")), gat = $derived(sourceState(estate, "gatus"));
  const health = (e: Entity) => str(e, "health") ?? "Unknown", sync = (e: Entity) => str(e, "sync") ?? "Unknown";
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const word = (s: (typeof sums)[number]) => s.needs ? `${s.needs} need${s.needs === 1 ? "s" : ""} you` : s.view?.reachable ? "steady" : s.view?.configured ? "unreachable" : "no agent yet";
</script>

<section class="page-intro">
  <span class="kicker">APPS · WORKLOADS · SITES</span>
  <h1 tabindex="-1">{!estate ? "Every app Argo and Coolify run, and the sites they serve."
    : `${total} apps on ${sums.filter(s => s.apps || s.argo).length} servers${needing ? `; ${needing} need${needing === 1 ? "s" : ""} you.` : ", all steady."}`}</h1>
</section>

<div class="grid">
  {#each sums as s, i (s.id)}
    <section class="mod raised c4 srv" data-server={s.id} style={`--in:${.04 + i * .04}s`} aria-label={`${s.id} apps`}>
      <h4><span>{s.id.toUpperCase()}</span><span class:warm={s.needs > 0 || (!!s.view?.configured && !s.view?.reachable)}>{word(s)}</span></h4>
      {#if s.apps || s.argo}
        <div class="nums">
          <div><b>{s.apps}</b><span>workloads</span></div>
          <div><b class:warm={s.ready < s.desired}>{s.ready}<small>/{s.desired}</small></b><span>pods ready</span></div>
          <div><b class:warm={s.restarts > 0}>{s.restarts}</b><span>restarts 24 h</span></div>
          <div><b class:warm={s.synced < s.argo}>{s.synced}<small>/{s.argo}</small></b><span>argo healthy</span></div>
        </div>
      {:else}
        <Waiting title={s.view?.configured ? "Its agent is not reachable." : "Not connected yet."} warm={!!s.view?.configured && !s.view?.reachable}>Its apps appear here once its agent reports.</Waiting>
      {/if}
    </section>
  {/each}

  <section class="mod raised c12 filt" style="--in:.14s" aria-label="Filter apps">
    <div class="filters">
      <Search bind:q placeholder="Search apps, namespaces, sites" />
      <Chips label="Server" bind:selected={server} options={facets(pool, e => e.server)} />
      <Chips label="State" bind:selected={mood} options={facets(pool, STATE)} />
    </div>
  </section>

  <section class="mod raised c7 list" style="--in:.18s" aria-labelledby="ap-argo">
    <h4 id="ap-argo"><span>ARGO CD · SYNC AND HEALTH</span><span>{argo.length}</span></h4>
    <div class="cards">
      {#each argo as e (e.id)}
        {@const warm = needsYou(e.status)}
        <div class="card pressed" class:hot={warm} data-app={e.id}>
          <button type="button" class="open" onclick={() => (open = e)}>
            <b>{e.name}</b><small class="mono">{e.server}{str(e, "revision") ? ` · ${str(e, "revision")}` : ""}</small>
            <span class="duo"><i class:ok={sync(e) === "Synced"} class:warm={warm && sync(e) !== "Synced"}>{sync(e)}</i><i class:ok={health(e) === "Healthy"} class:warm={warm && health(e) !== "Healthy"}>{health(e)}</i></span>
            {#if e.statusReason}<small class:warm>{e.statusReason}</small>{/if}
          </button>
          <Knob label={`Sync ${e.name}`} {warm} />
        </div>
      {:else}
        <Waiting title={estate ? "No Argo CD apps match." : "Waiting for the first state."} />
      {/each}
    </div>
  </section>

  <section class="mod raised c5 list" style="--in:.22s" aria-labelledby="ap-cool">
    <h4 id="ap-cool"><span>COOLIFY · DEPLOYS</span><span>{coolify.length || ""}</span></h4>
    {#if cool.failing.length}
      <Waiting title={`Can't read Coolify on ${cool.failing[0]!.server}.`} warm>{cool.failing[0]!.error}</Waiting>
    {:else if !cool.reporting.length}
      <Waiting title="Coolify is not reporting yet.">Each Coolify app with its last deploy, commit and duration appears here when the lab's Coolify source lands.</Waiting>
    {:else}
      {#each coolify as e (e.id)}
        {@const warm = needsYou(e.status)} {@const dep = time(e, "lastDeployAt")}
        <div class="row" class:now={warm}>
          <button type="button" class="open" onclick={() => (open = e)}>
            <span class="t">{e.name}<small>{[str(e, "fqdn"), dep ? `deployed ${ago(dep, t)}` : undefined, str(e, "commit")].filter(Boolean).join(" · ") || e.statusReason || e.status}</small>
              {#if str(e, "undeployedCommit")}<small class="warm">{str(e, "undeployedCommit")!.slice(0, 7)} is waiting for a deploy</small>{/if}</span>
          </button>
          <Knob label={`Redeploy ${e.name}`} {warm} />
        </div>
      {:else}
        <Waiting title="No Coolify apps match." />
      {/each}
    {/if}
  </section>

  <section class="mod raised c12 list" style="--in:.26s" aria-labelledby="ap-work">
    <h4 id="ap-work"><span>WORKLOADS · PODS AND RESTARTS</span><span>{work.length}</span></h4>
    {#each spaces as g (g.key)}
      <div class="group mono">{g.server.toUpperCase()} · {g.apps.length} workloads</div>
      <div class="tiles">
        {#each g.apps as e (e.id)}
          {@const ready = num(e, "pods") ?? 0} {@const want = num(e, "podsDesired") ?? 0} {@const p = pips(ready, want)}
          {@const r = num(e, "restarts24h") ?? 0} {@const warm = needsYou(e.status)}
          <button type="button" class="tile" class:hot={warm} data-app={e.id} onclick={() => (open = e)}>
            <b><small class="mono">{nsOf(e)}</small>{e.name}</b>
            <span class="pips" role="img" aria-label={`${ready} of ${want} pods ready`}>{#each p.pips as x, i (i)}<i class={x}></i>{/each}{#if p.more}<small>+{p.more}</small>{/if}</span>
            <small class:warm={r > 0 || ready < want}>{ready < want ? `${ready}/${want} ready` : r ? `${plural(r, "restart")} · last ${ago(str(e, "lastRestartAt") ?? e.observedAt, t)}` : "no restarts"}</small>
          </button>
        {/each}
      </div>
    {:else}
      <Waiting title={estate ? "No workloads match." : "Waiting for the first state."} />
    {/each}
  </section>

  <section class="mod raised c12 list" style="--in:.3s" aria-labelledby="ap-sites">
    <h4 id="ap-sites"><span>SITES · UPTIME 24 H</span><span>{sites.length ? `${sites.filter(s => s.status === "ok").length}/${sites.length} up` : ""}</span></h4>
    {#if gat.failing.length}<Waiting title={`Can't read Gatus on ${gat.failing[0]!.server}.`} warm>{gat.failing[0]!.error}</Waiting>{/if}
    {#each sites as e (e.id)}
      {@const u = num(e, "uptime24h")} {@const warm = needsYou(e.status)} {@const ms = num(e, "latencyMs")} {@const seen = time(e, "lastCheck")}
      <button type="button" class="row site" class:now={warm} data-site={e.id} onclick={() => (open = e)}>
        <span class="t">{e.name}<small>{str(e, "group") ?? "site"} · {e.server}{num(e, "httpStatus") ? ` · HTTP ${num(e, "httpStatus")}` : ""}{e.statusReason ? ` · ${e.statusReason}` : ""}</small></span>
        <span class="up pressed" aria-hidden="true"><i class:warm style={`transform:scaleX(${u === undefined ? 0 : Math.max(0, (u - 90) / 10)})`}></i></span>
        <span class="mono pct" class:warm>{u === undefined ? "—" : `${u.toFixed(2)}%`}</span>
        <span class="mono ms">{ms === undefined ? "—" : `${Math.round(ms)} ms`}<small>{seen ? ago(seen, t) : ""}</small></span>
      </button>
    {:else}
      {#if !gat.failing.length}<Waiting title={gat.reporting.length ? "No sites match." : "Gatus is not reporting yet."}>Public sites and products with their 24 h uptime.</Waiting>{/if}
    {/each}
    {#if sites.length}<p class="note">the bar spans 90 to 100% uptime · ember = failing now</p>{/if}
  </section>
</div>

{#if open}<Drawer entity={open} {events} now={t} onclose={() => (open = undefined)} />{/if}
