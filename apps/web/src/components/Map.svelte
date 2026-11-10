<script lang="ts">
  import type { Entity, Event, ServerId } from "@hetops-control/contracts";
  import type { State } from "../lib/api.js";
  import { num } from "../lib/api.js";
  import { runs } from "../lib/action-state.svelte.js";
  import { burnAll, climb, overall, type Burn, type Reading, type Rising } from "../lib/burn.js";
  import { CONTOURS, RIVER, VIEW, grow, plant, type Tree } from "../lib/grove.js";
  import { hash, rng } from "../lib/seed.js";
  import { reduced } from "../lib/motion.js";

  // The Fire line map (docs/specs/2026-11-10-fire-line.md): the estate as a forest on a beat map, or one server zoomed in.
  // Every tree is a workload in one of five states (lib/burn.ts); fire, rain and steam move because they are live, nothing else does.
  let { state: estate, events = [], now, only, selected, onpick }:
    { state: State; events?: Event[]; now: Date; only?: ServerId; selected?: string; onpick?: (e: Entity) => void } = $props();

  // ready pods climbing is a change between readings, so the map remembers the last one
  const memory: Rising = new Map();
  const apps = $derived(estate.entities.filter(e => e.kind === "app"));
  const rising = $derived(climb(memory, apps, now.getTime()));
  const input = $derived({ entities: estate.entities, servers: estate.servers, runs: runs.list, events, now: now.getTime(), rising });
  const readings = $derived(burnAll(input));
  const land = $derived(plant(apps, readings, only));

  // leaves by state: dark (inside the canopy), mid, light (where the light falls)
  const LEAF: Record<Burn, [string, string, string]> = {
    calm: ["#2b5a41", "#4a9166", "#8acc9f"], fire: ["#7a2e12", "#e0612a", "#ffb547"], rain: ["#5e3420", "#c0663a", "#e8a066"],
    steam: ["#5f7a6f", "#97ada3", "#cad7d1"], fog: ["#3a423e", "#4a544f", "#5b6660"] };
  const BARK: Record<Burn, string> = { calm: "#6e5a47", fire: "#3a2e27", rain: "#4a3c33", steam: "#62564c", fog: "#55605a" };
  const WORD: Record<Burn, string> = { fire: "burning", rain: "being put out", steam: "just came back", fog: "can't be seen", calm: "calm" };

  // a server that never connected still stands on the map: a few bare trees in fog
  const bare = (s: ServerId) => Array.from({ length: 5 }, (_, i) => { const R = rng(hash(`${s}|bare|${i}`)); return { key: `${s}|bare|${i}`, x: 0, y: 0, w: 0, R, ...grow(`${s}|bare|${i}`, 0) }; });
  const never = (s: ServerId) => !estate.servers[s].reachable;

  // the ground burns when a node of the server needs you (a disk filling, a node not ready)
  const ground = (s: ServerId) => { const nodes = estate.entities.filter(e => e.kind === "node" && e.server === s); const rs = nodes.map(n => readings.get(n.id)!).filter(Boolean);
    const hot = nodes.find(n => readings.get(n.id)?.burn === "fire"); return { burn: overall(rs), why: hot ? `${hot.name}: ${hot.statusReason ?? "needs a look"}` : undefined }; };
  const line = (s: ServerId) => { const cluster = estate.entities.find(e => e.kind === "cluster" && e.server === s), n = apps.filter(a => a.server === s).length;
    if (never(s)) return estate.servers[s].configured ? "in fog · unreachable" : "in fog · agent not connected";
    const run = num(cluster, "podsRunning"), tot = num(cluster, "podsTotal");
    return [`${n} workload${n === 1 ? "" : "s"}`, run !== undefined && tot !== undefined ? `${run}/${tot} pods` : undefined].filter(Boolean).join(" · "); };

  // the tree's own box is 100 x 130 with the ground at 104: place its foot at (x, y), w wide
  const at = (t: Pick<Tree, "x" | "y" | "w">) => `translate(${t.x - t.w / 2} ${t.y - (t.w * 1.3 * 104) / 130}) scale(${t.w / 100})`;
  const label = (t: Tree) => `${t.name}, ${WORD[t.reading.burn]}${t.reading.why ? `: ${t.reading.why}` : ""}`;
  // rain and steam are seeded per tree, so two never fall or rise in step
  const drops = (id: string) => { const R = rng(hash(`${id}|rain`)); return Array.from({ length: 9 }, () => ({ x: 24 + R() * 52, y: R() * 18, d: (R() * 1).toFixed(2) })); };
  const pick = (e: MouseEvent, t: Tree) => { if (!onpick) return; e.preventDefault(); onpick(t.entity); };
  // a caption fits its plot: Overpass Mono at 11 px is 6.6 units a character
  const fit = (s: string, w: number) => { const n = Math.max(8, Math.floor(w / 6.6)); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
</script>

<svg class="map" class:still={$reduced} viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} aria-labelledby="map-t" data-map={only ?? "estate"}>
  <title id="map-t">{only ? `${land[0]?.name}: its workloads as trees, by namespace` : "The estate: each server a compartment, each workload a tree"}</title>
  <defs>
    <path id="leaf" d="M0 -4.2 Q2.6 0 0 4.2 Q-2.6 0 0 -4.2Z" />
    <pattern id="fog-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="8" height="8" fill="var(--map)" /><line x1="0" y1="0" x2="0" y2="8" stroke="var(--fog)" stroke-opacity=".45" stroke-width="2" />
    </pattern>
  </defs>
  <rect width={VIEW.w} height={VIEW.h} fill="var(--map)" />
  <g class="contours" aria-hidden="true">{#each CONTOURS as d (d)}<path {d} />{/each}</g>
  {#if !only}<path class="stream" d={RIVER} aria-hidden="true" />{/if}

  {#each land as c (c.server)}
    {@const g = ground(c.server)}
    <g class="compartment" data-server={c.server} data-burn={never(c.server) ? "fog" : g.burn === "fire" ? "fire" : "calm"}>
      <path class="outline" d={c.outline} fill={never(c.server) ? "url(#fog-hatch)" : "var(--stand)"} />
      <a href={`/servers/${c.server}`} class="c-name" aria-label={`Open ${c.name}'s page`}><text x={c.label.x} y={c.label.y}>{c.name}<tspan class="c-line" dx="10">{line(c.server)}</tspan></text></a>
      {#if g.burn === "fire" && g.why}<text class="c-ground mono" x={c.box.x} y={c.box.y + c.box.h + (only ? 6 : 2)}>ground · {g.why}</text>{/if}

      {#if never(c.server)}
        {#each bare(c.server) as b, i (b.key)}
          {@const spot = { x: c.box.x + c.box.w * (.14 + i * .18), y: c.box.y + c.box.h * (.7 + (b.R() - .5) * .2), w: only ? 60 : 22 }}
          <g transform={at(spot)} aria-hidden="true"><path d={b.roots} class="roots" stroke={BARK.fog} /><path d={b.trunk} fill={BARK.fog} /><path d={b.branches} class="branches" stroke={BARK.fog} /></g>
        {/each}
      {/if}

      {#each c.groves as gr (gr.id)}
        <text class="g-name mono" x={gr.label.x} y={gr.label.y}>{gr.name}</text>
        {#each gr.trees as t (t.id)}
          {@const L = LEAF[t.reading.burn]}
          <a href={`/servers/${t.server}`} class="tree" data-burn={t.reading.burn} data-hot={t.reading.hot || undefined} data-entity={t.id}
            aria-label={label(t)} aria-current={selected === t.id ? "true" : undefined} onclick={e => pick(e, t)}>
            <title>{label(t)}</title>
            {#if selected === t.id}<ellipse class="sel" cx={t.x} cy={t.y + 2} rx={t.w * .42} ry={t.w * .1} />{/if}
            <g transform={at(t)}>
              <!-- a still hit area over everything the tree draws, flames, rain and steam included: the target never moves under the pointer -->
              <rect class="hit" x="-6" y="-32" width="112" height="160" />
              <ellipse cx="50" cy="106" rx="20" ry="3.5" class="shadow" />
              <path d={t.roots} class="roots" stroke={BARK[t.reading.burn]} />
              <path d={t.trunk} fill={BARK[t.reading.burn]} />
              <path d={t.branches} class="branches" stroke={BARK[t.reading.burn]} />
              {#each t.leaves as l, i (i)}<use href="#leaf" fill={L[l.tone]} transform={`translate(${l.x} ${l.y}) rotate(${l.rot}) scale(${l.s})`} />{/each}
              {#if t.reading.burn === "fire"}
                <g class="flames" aria-hidden="true">
                  <path d="M38 26 Q34 14 41 4 Q42 14 47 18 Q46 8 52 0 Q55 12 58 16 Q62 8 64 4 Q68 16 62 28 Q50 34 38 26Z" fill="var(--fire)" />
                  <path d="M45 24 Q44 16 48 10 Q50 18 53 20 Q56 14 57 12 Q59 20 56 26 Q50 29 45 24Z" fill="#ffd08a" />
                </g>
              {:else if t.reading.burn === "rain"}
                <g class="rain" aria-hidden="true">
                  <ellipse cx="44" cy="-6" rx="26" ry="8" /><ellipse cx="60" cy="-9" rx="22" ry="9" />
                  {#each drops(t.id) as d, i (i)}<line class="drop" x1={d.x} y1={d.y} x2={d.x - 1.5} y2={d.y + 7} style={`animation-delay:${d.d}s`} />{/each}
                </g>
              {:else if t.reading.burn === "steam"}
                <g class="steam" aria-hidden="true"><path d="M40 20 c-6 -8 6 -12 0 -22" /><path d="M58 16 c-6 -8 6 -12 0 -22" style="animation-delay:1.4s" /></g>
              {/if}
            </g>
          </a>
        {/each}
        <!-- what is not calm, named under its grove in its state's colour, one line each, so words never collide; the reason is the tree's label -->
        {#each gr.caption.trees as t, i (t.id)}
          <text class="t-why mono" data-burn={t.reading.burn} x={gr.caption.x} y={gr.caption.y + i * 14}>{fit(t.name, gr.box.w - 8)}</text>
        {/each}
      {/each}
    </g>
  {/each}
</svg>

<style>
  .map { display: block; width: 100%; height: auto; border-radius: 12px; }
  .contours path { fill: none; stroke: #9fb8a5; stroke-opacity: .09; }
  .stream { fill: none; stroke: #4f7d92; stroke-opacity: .35; stroke-width: 3; }
  .outline { stroke: var(--map-ink); stroke-opacity: .45; stroke-width: 1.4; stroke-dasharray: 8 5; }
  .compartment[data-burn="fire"] .outline { stroke: var(--fire); stroke-opacity: .9; stroke-width: 2.4; stroke-dasharray: none; }
  .compartment[data-burn="fog"] .outline { stroke: var(--fog); stroke-dasharray: 3 4; }
  .c-name text { fill: var(--ink); font: 500 17px var(--sans); }
  .c-line { fill: var(--ink-3); font: 400 12px var(--mono); }
  .c-name:hover text, .c-name:focus-visible text { text-decoration: underline; }
  .c-ground { fill: var(--fire-ink); font-size: 11px; }
  .g-name { fill: var(--ink-3); font-size: 11px; }
  .roots { fill: none; stroke-width: 1.6; stroke-linecap: round; }
  .branches { fill: none; stroke-width: 2.2; stroke-linecap: round; }
  .shadow { fill: #000; fill-opacity: .28; }
  .hit { fill: transparent; }
  .tree { cursor: pointer; outline: none; }
  .tree:focus-visible > g { filter: brightness(1.25); }
  .sel { fill: none; stroke: var(--ink); stroke-width: 1.5; }
  .t-why { font-size: 11px; }
  .t-why[data-burn="fire"] { fill: var(--fire-ink); }
  .t-why[data-burn="rain"] { fill: var(--rain-ink); }
  .t-why[data-burn="steam"] { fill: var(--steam); }
  .t-why[data-burn="fog"] { fill: var(--ink-3); }
  .rain ellipse { fill: #1d2f3d; fill-opacity: .85; }
  .drop { stroke: var(--rain); stroke-width: 1.6; stroke-linecap: round; animation: fall 1s linear infinite; }
  .steam path { fill: none; stroke: var(--steam); stroke-opacity: .7; stroke-width: 1.6; stroke-linecap: round; animation: rise 3.2s ease-out infinite; }
  .flames { transform-box: fill-box; transform-origin: 50% 100%; animation: flicker 1.5s ease-in-out infinite; }
  .tree[data-hot] .flames { animation-duration: 1s; }
  @keyframes fall { 0% { transform: translateY(0); opacity: 0 } 15% { opacity: .95 } 100% { transform: translateY(62px); opacity: 0 } }
  @keyframes rise { 0% { transform: translateY(0); opacity: 0 } 30% { opacity: .7 } 100% { transform: translateY(-26px); opacity: 0 } }
  @keyframes flicker { 0%, 100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.08, 1.14); opacity: .8 } }
  .still .drop, .still .steam path, .still .flames { animation: none; }
  .still .drop { opacity: .8; }
  @media (prefers-reduced-motion: reduce) { .drop, .steam path, .flames { animation: none; } }
</style>
