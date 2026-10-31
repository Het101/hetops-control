<script lang="ts">
  import type { State } from "../lib/api.js";
  import { reduced } from "../lib/motion.js";
  import { H, hot, NODES, topology, W, WORD, type EdgeView, type LinkState, type NodeView } from "../lib/topology.js";
  import TopoDrawer from "../components/TopoDrawer.svelte";
  import Waiting from "../components/Waiting.svelte";

  let { estate, now }: { estate: State | undefined; now: Date } = $props();
  let openNode = $state<string>(), openEdge = $state<string>();

  const view = $derived(estate ? topology(estate, now.getTime()) : undefined);
  const names = Object.fromEntries(NODES.map(n => [n.id, n.name]));
  const pct = (x: number, y: number) => `left:${(x / W) * 100}%;top:${(y / H) * 100}%`;
  const hotN = $derived(view ? view.edges.filter(e => hot(e.state)).length : 0);
  const node = $derived(view?.nodes.find(n => n.id === openNode));
  const edge = $derived(view?.edges.find(e => e.id === openEdge));
  const close = () => { openNode = undefined; openEdge = undefined; };
  const show = (n?: string, e?: string) => { openNode = n; openEdge = e; };
  // a station's word: a server says how it is, a link-only node says what its links do
  const word = (n: NodeView) => n.server ? (n.state === "ok" ? "HEALTHY" : n.state === "planned" ? "NOT CONNECTED" : n.state === "down" ? "UNREACHABLE" : WORD[n.state]) : WORD[n.state];
  const chip = (e: EdgeView) => e.perMin ? `${e.via} · ${e.perMin.toLocaleString()}/min` : e.via;
  const dots = (e: EdgeView) => Array.from({ length: e.flow?.dots ?? 0 }, (_, i) => i);
  const LEGEND: [LinkState, string][] = [["ok", "carrying traffic"], ["attention", "needs you"], ["unknown", "no signal"], ["planned", "not built yet"]];
</script>

<section class="page-intro">
  <span class="kicker">TOPOLOGY · LIVE ON EVERY LINK</span>
  <h1 tabindex="-1">{view?.headline ?? "How the three servers connect, and whether each link is carrying traffic."}</h1>
</section>

{#if !view}
  <section class="mod raised" style="--in:.04s"><Waiting title="Waiting for the center's first reading.">Every link appears with the signal that proves it once the state arrives.</Waiting></section>
{:else}
<div class="grid">
  <section class="mod raised c12 topo-mod" style="--in:.04s" aria-labelledby="t-map">
    <h4 id="t-map"><span>THE ESTATE · CLOUDFLARE, THE TAILNET, BACKUPS</span><span class:warm={hotN > 0}>{hotN ? `${hotN} link${hotN === 1 ? "" : "s"} need${hotN === 1 ? "s" : ""} you` : `${view.edges.filter(e => e.state === "ok").length} of ${view.edges.length} carrying`}</span></h4>
    <div class="topo">
      <svg viewBox={`0 0 ${W} ${H}`} class="wires" aria-hidden="true">
        <rect x="40" y="196" width="1120" height="316" rx="34" class="tailnet"/>
        <text x="66" y="232" class="net-l">TAILNET · 100.x</text>
        {#each view.edges as e (e.id)}
          <path d={e.d} class="groove"/>
          <path d={e.d} class="wire {e.state}"/>
          {#if e.state === "planned"}<path d={e.d} class="hollow"/>{/if}
          {#if !$reduced}
            {#each dots(e) as i (i)}
              <circle r="4.4" class="flow" class:warm={hot(e.state)} style={`offset-path:path('${e.d}');animation-duration:${e.flow!.secs}s;animation-delay:${-(i * e.flow!.secs) / e.flow!.dots}s`}/>
            {/each}
          {/if}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <path d={e.d} class="hit" onclick={() => show(undefined, e.id)}/><!-- the mouse's wide target; keyboard uses the link's chip -->
        {/each}
      </svg>
      {#each view.edges as e (e.id)}
        <button type="button" class="link-chip {e.state}" style={pct(...e.at)} data-edge={e.id} aria-label={`${e.name}: ${WORD[e.state].toLowerCase()}, ${e.reason}`}
          onclick={() => show(undefined, e.id)}>{chip(e)}</button>
      {/each}
      {#each view.nodes as n (n.id)}
        <button type="button" class="stn raised {n.state}" class:srv={n.server} style={pct(n.x, n.y)} data-node={n.id} aria-label={`${n.name}: ${word(n).toLowerCase()}`} onclick={() => show(n.id)}>
          {#if n.server}
            <svg viewBox="0 0 28 30" class="tree" aria-hidden="true"><path d="M14 29V14M14 20l-5-4M14 17l5-3"/><circle cx="14" cy="9" r="6"/><circle cx="8" cy="13" r="4"/><circle cx="20" cy="12" r="4.5"/></svg>
          {/if}
          <span class="stn-t"><b>{n.name}</b><small class="mono">{n.sub}</small>{#if n.stats}<small class="mono">{n.stats}</small>{/if}
            <i class="mono" class:warm={hot(n.state)}>{word(n)}</i></span>
        </button>
      {/each}
    </div>
    <div class="legend mono" aria-label="Legend">
      {#each LEGEND as [s, l] (s)}<span><svg viewBox="0 0 34 10" aria-hidden="true"><path d="M2 5H32" class="wire {s}"/>{#if s === "planned"}<path d="M2 5H32" class="hollow"/>{/if}</svg>{l}</span>{/each}
      <span class="note-l">dots travel with the real flow: more and faster when busier · none on a stopped link</span>
    </div>
  </section>

  <section class="mod raised c7 list" style="--in:.08s" aria-labelledby="t-links">
    <h4 id="t-links"><span>EVERY LINK · ITS SIGNAL</span><span>{view.edges.length} links</span></h4>
    {#each view.edges as e (e.id)}
      <button type="button" class="row" class:now={hot(e.state)} data-link={e.id} onclick={() => show(undefined, e.id)}>
        <i class="pip {e.state}"></i>
        <span class="t">{e.name}<small>{names[e.from]} → {names[e.to]} · {e.via.toLowerCase()}</small></span>
        <span class="why" class:warm={hot(e.state)}>{WORD[e.state].toLowerCase()}<small>{e.reason}</small></span>
      </button>
    {/each}
  </section>

  <section class="mod raised c5 list" style="--in:.12s" aria-labelledby="t-stn">
    <h4 id="t-stn"><span>STATIONS</span><span>{view.nodes.length}</span></h4>
    {#each view.nodes as n (n.id)}
      <button type="button" class="row" class:now={hot(n.state)} onclick={() => show(n.id)}>
        <i class="pip {n.state}"></i>
        <span class="t">{n.name}<small>{[n.sub, n.stats].filter(Boolean).join(" · ")}</small></span>
        <span class="why mono" class:warm={hot(n.state)}>{word(n).toLowerCase()}</span>
      </button>
    {/each}
  </section>
</div>
{/if}

{#if node || edge}<TopoDrawer {node} {edge} {names} onclose={close} />{/if}

<style>
  .topo{position:relative;aspect-ratio:1200/540;margin-top:10px}
  .wires{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
  .tailnet{fill:var(--bg-deep);opacity:.55}
  .net-l{font:600 12px var(--mono);letter-spacing:.14em;fill:var(--ink-3)}
  .groove{fill:none;stroke:var(--bg-deep);stroke-width:9;stroke-linecap:round}
  .wire{fill:none;stroke:var(--quiet);stroke-width:2.4;stroke-linecap:round}
  .wire.attention,.wire.down{stroke:var(--ember)}
  .wire.down{stroke-dasharray:2 7}
  .wire.unknown{stroke:var(--ink-3);opacity:.6}
  .wire.planned{stroke:var(--ink-3);stroke-width:6;stroke-dasharray:10 8;stroke-linecap:butt}
  .hollow{fill:none;stroke:var(--bg);stroke-width:3;stroke-dasharray:10 8}
  .hit{fill:none;stroke:transparent;stroke-width:18;pointer-events:stroke;cursor:pointer}
  .flow{fill:var(--ink);offset-rotate:0deg;animation:run linear infinite}
  .flow.warm{fill:var(--ember-1)}
  @keyframes run{from{offset-distance:0%;opacity:0}8%{opacity:1}92%{opacity:1}to{offset-distance:100%;opacity:0}}

  .link-chip{position:absolute;transform:translate(-50%,-50%);border:0;cursor:pointer;padding:4px 10px;border-radius:999px;font:600 10.5px var(--mono);letter-spacing:.08em;
    color:var(--ink-2);background:var(--bg-deep);box-shadow:inset 0 0 0 1px var(--ink-3);white-space:nowrap;transition:transform .3s var(--ease)}
  .link-chip:hover{transform:translate(-50%,-50%) scale(1.06)}
  .link-chip.attention,.link-chip.down{color:var(--ember);box-shadow:inset 0 0 0 1px var(--ember)}
  .link-chip.planned{background:var(--bg);box-shadow:none;outline:1px dashed var(--ink-3);outline-offset:-1px}
  .link-chip:focus-visible,.stn:focus-visible,.row:focus-visible{outline:2px solid var(--quiet);outline-offset:3px}

  .stn{position:absolute;transform:translate(-50%,-50%);border:0;cursor:pointer;color:var(--ink);font:inherit;text-align:left;display:flex;gap:10px;align-items:center;
    padding:10px 16px;border-radius:20px;transition:transform .35s var(--ease)}
  .stn:hover{transform:translate(-50%,-50%) translateY(-2px)}
  .stn.srv{padding:12px 18px 12px 14px;border-radius:24px}
  .stn.planned{background:var(--bg);box-shadow:none;outline:1.5px dashed var(--ink-3);outline-offset:-1.5px}
  .stn-t b{display:block;font:600 15px var(--serif),Georgia,serif}
  .stn.srv .stn-t b{font-size:18px}
  .stn-t small{display:block;font-size:10.5px;color:var(--ink-3);margin-top:2px;white-space:nowrap}
  .stn-t i{display:block;font-style:normal;font-size:10px;letter-spacing:.1em;color:var(--quiet);margin-top:5px}
  .stn-t i.warm{color:var(--ember)}
  .tree{width:30px;height:32px;flex:none;fill:none;stroke:var(--quiet);stroke-width:1.6;stroke-linecap:round}
  .tree circle{fill:var(--ink-3);fill-opacity:.35}
  .attention .tree,.down .tree{stroke:var(--ember)}
  .attention .tree circle,.down .tree circle{fill:var(--ember);fill-opacity:.3}
  .planned .tree,.unknown .tree{stroke:var(--ink-3);stroke-dasharray:2 2.5}
  .planned .tree circle,.unknown .tree circle{fill:none}

  .legend{display:flex;flex-wrap:wrap;gap:8px 22px;align-items:center;margin-top:12px;font-size:11px;color:var(--ink-3)}
  .legend span{display:flex;align-items:center;gap:8px}
  .legend svg{width:34px;height:10px}
  .legend .note-l{margin-left:auto}

  .pip{flex:none;width:10px;height:10px;border-radius:50%;background:var(--quiet)}
  .pip.attention,.pip.down{background:var(--ember)}
  .pip.unknown{background:none;box-shadow:inset 0 0 0 1.5px var(--ink-3)}
  .pip.planned{background:none;outline:1.5px dashed var(--ink-3);outline-offset:-1.5px}
  .why{flex:none;max-width:46%;text-align:right;font-size:12px;color:var(--ink-2)}
  .why small{display:block;font-size:11px;color:var(--ink-3);margin-top:2px;overflow-wrap:anywhere}
  .why.warm,.why.warm small{color:var(--ember)}

  /* the map needs room: on narrow screens the two lists carry every link and station instead */
  @media (max-width:900px){ .topo-mod{display:none} }
</style>
