<script lang="ts">
  import { ServerIdSchema, type Entity, type Event, type ServerId } from "@hetops-control/contracts";
  import { growTree, hash, rng, struggling, type Branch, type ForestApp } from "../lib/forest.js";
  import { num, type State } from "../lib/api.js";
  import { reduced } from "../lib/motion.js";
  import { windy } from "../lib/wind.js";

  let { state: estate, events = [] }: { state: State; events?: Event[] } = $props();

  const X: Record<ServerId, number> = { lab: 200, staging: 600, ops: 1000 };
  const NAME: Record<ServerId, string> = { lab: "Lab", staging: "Staging", ops: "Ops" };
  const PAL = ["#5f6065", "#7b7c81", "#9c9b98", "#c4c2bd", "#d9d7d1"];

  // the ground never changes: one blade every 5 units, as in the mock (without its decorative ember blades)
  const blades = Array.from({ length: 240 }, (_, i) => ({ x: i * 5, h: 4 + Math.abs(Math.sin(i * .21) * 10 + Math.sin(i * .07) * 14), d: 1400 + ((i * 37) % 700), dl: i * 4 }));

  // the wind bends the grass in runs of ten blades: 24 transforms a frame, not 240
  const runs = Array.from({ length: 24 }, (_, g) => ({ x: g * 50 + 25, ph: (hash(`run|${g}`) % 628) / 100, blades: blades.slice(g * 10, g * 10 + 10) }));
  // silver streaks that ride each gust front, and motes the breeze carries: seeded, the same on every load
  const W = rng(hash("weather"));
  const streaks = Array.from({ length: 5 }, (_, i) => ({ i, oy: 70 + i * 42 + W() * 20, ox: (W() - .5) * 220, amp: .1 + W() * .1, len: 140 + W() * 120 }));
  const motes = Array.from({ length: 14 }, (_, i) => ({ i, ox: W() * 1300, oy: 150 + W() * 130, r: .8 + W() * 1.1, f: .6 + W() * .8, ph: W() * 6.28, o: .18 + W() * .3 }));
  /** a seeded phase and rate for one swaying part, so two trees never move in lockstep */
  const sway = (k: string) => { const h = hash(`${k}|wind`); return { ph: (h % 628) / 100, f: .8 + (h % 40) / 100 }; };
  // roots breathe on their own 8 to 14 s cycles, offset so they never grow together
  const rootTime = (server: ServerId, i: number) => { const R = rng(hash(`${server}|root|${i}`)); return { "data-f": (8 + R() * 6).toFixed(1), "data-ph": (R() * 6.28).toFixed(2) }; };

  const apps = (s: ServerId, all: Entity[]) => all.filter(e => e.kind === "app" && e.server === s);

  // a server that has never connected gets a dormant outline: bare branches, no leaves
  const DORMANT: ForestApp[] = Array.from({ length: 7 }, (_, i) => ({ id: `dormant/${i}`, name: "", pods: 0, restarts: 0, status: "unknown" }));
  const never = (id: ServerId) => !estate.servers[id].reachable && !estate.servers[id].agentVersion;

  const trees = $derived(ServerIdSchema.options.map(s => ({ dormant: never(s), tree: growTree(s, X[s], never(s) ? DORMANT : apps(s, estate.entities).map(e => ({
    id: e.id, name: e.name, status: e.status, restarts: num(e, "restarts24h") ?? 0,
    // the canopy is the intended size; a missing pod shows as ember, not as a smaller tree
    pods: Math.max(num(e, "podsDesired") ?? 0, num(e, "pods") ?? 0) }))) })));

  type Station = { id: ServerId; name: string; line: string; word: string; warm: boolean; bare: boolean };
  const stations = $derived(ServerIdSchema.options.map((id): Station => {
    const view = estate.servers[id], list = apps(id, estate.entities);
    const cluster = estate.entities.find(e => e.kind === "cluster" && e.server === id);
    const restarts = list.reduce((n, e) => n + (num(e, "restarts24h") ?? 0), 0);
    const running = num(cluster, "podsRunning"), total = num(cluster, "podsTotal"), version = cluster?.facts.version?.value;
    const line = cluster ? [version, `${list.length} apps`, running !== undefined && total !== undefined ? `${running}/${total} pods` : undefined].filter(Boolean).join(" · ")
      : view.statusReason ?? "no agent yet";
    const base = { id, name: NAME[id], line, bare: !view.reachable };
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    // never connected: an alarm only if the center has an agent configured for it; lost after a connection always is
    if (!view.reachable) return view.agentVersion ? { ...base, word: "UNREACHABLE", warm: true } : { ...base, word: view.configured ? "UNREACHABLE" : "NOT CONNECTED", warm: view.configured };
    if (view.status === "down" || list.some(e => e.status === "down")) return { ...base, word: "DOWN", warm: true };
    if (restarts > 0) return { ...base, word: `SMOULDERING · ${plural(restarts, "restart")}`, warm: true };
    const failing = view.failingSources?.length ?? 0, stale = Number(/(\d+) readings? stale/.exec(view.statusReason ?? "")?.[1] ?? 0);
    if (failing || stale) return { ...base, word: `BLIND · ${[failing && `${plural(failing, "source")} failing`, stale && `${plural(stale, "reading")} stale`].filter(Boolean).join(" · ")}`, warm: true };
    if (view.status === "attention" || list.some(e => e.status === "attention")) return { ...base, word: "SMOULDERING", warm: true };
    if (view.status === "unknown") return { ...base, word: (view.statusReason ?? "unknown").toUpperCase(), warm: false };
    return { ...base, word: "HEALTHY", warm: false };
  }));

  let svg = $state<SVGSVGElement>();

  // every state the stream delivers sends a pulse of light down the roots: the forest visibly drinks the live data
  $effect(() => {
    void estate.generatedAt;
    if ($reduced || !svg) return;
    svg.querySelectorAll<SVGPathElement>(".root-pulse").forEach((p, i) => p.animate(
      [{ strokeDashoffset: .16, opacity: 0 }, { opacity: .8, offset: .15 }, { strokeDashoffset: -1.05, opacity: 0 }],
      { duration: 1900, delay: (i % 5) * 90, easing: "cubic-bezier(.4,0,.2,1)" }));
  });

  // a real restart (an event that arrives while the page is open) shakes one ember leaf loose from its branch
  type Drop = { id: string; cx: number; cy: number; dx: number };
  let drops = $state<Drop[]>([]);
  const heard = new Set<string>();
  $effect(() => {
    for (const e of events) {
      const k = `${e.at}|${e.server}|${e.summary}|${e.entity ?? ""}`;
      if (heard.has(k)) continue;
      heard.add(k);
      if (e.kind !== "restart" || !e.entity || Date.parse(e.at) < Date.now() - 120_000 || $reduced) continue;
      const b = trees.flatMap(x => x.tree.branches).find(x => x.id === e.entity);
      if (!b) continue;
      const R = rng(hash(k)), l = b.leaves[Math.floor(R() * b.leaves.length)];
      drops = [...drops, { id: k, cx: b.tip.x + (l?.x ?? 0), cy: b.tip.y + (l?.y ?? 0), dx: Math.round((R() - .2) * 70) }];
    }
  });

  /** Falling leaves and rising embers around a struggling branch's ember leaves; seeded, so they stay put between readings.
   The wind loop moves them (data-wind fall and rise): f is the cycle in seconds, dl the delay, dx the sideways drift. */
  function sparks(server: ServerId, b: Branch) {
    const hot = b.leaves.filter(l => l.ember);
    if ($reduced || !struggling(b) || !hot.length) return { falls: [], embers: [] };
    const R = rng(hash(`${server}|${b.id}|sparks`)), rs = Math.min(Math.max(b.restarts, 1), 4);
    const ex = b.tip.x + hot.reduce((n, l) => n + l.x, 0) / hot.length, ey = b.tip.y + hot.reduce((n, l) => n + l.y, 0) / hot.length;
    return {
      falls: Array.from({ length: rs * 3 }, (_, f) => ({ id: `${b.id}/f${f}`, cx: ex + (R() - .5) * 30, cy: ey + 10, f: 5 + R() * 3, dl: f * 1.4, dx: (R() - .3) * 60 })),
      embers: Array.from({ length: rs * 9 }, (_, k) => ({ id: `${b.id}/e${k}`, cx: ex + (R() - .5) * 40, cy: ey + (R() - .5) * 20, r: 1 + R() * 1.6, f: 2.2 + R() * 2, dl: R() * 3, dx: (R() - .5) * 30 })),
    };
  }
</script>

<svg class="forest" bind:this={svg} use:windy={{ on: !$reduced, key: trees }} viewBox="0 0 1200 320" preserveAspectRatio="xMidYMax meet" role="img" aria-label="One tree per server; branches are apps, leaves are pods, ember leaves are restarts">
  <defs>
    <radialGradient id="glow"><stop offset="0" stop-color="#4a4b51" stop-opacity=".55"/><stop offset="1" stop-color="#4a4b51" stop-opacity="0"/></radialGradient>
    <radialGradient id="emberHalo"><stop offset=".45" stop-color="#f0582a" stop-opacity=".5"/><stop offset="1" stop-color="#f0582a" stop-opacity="0"/></radialGradient>
    <radialGradient id="sparkGlow"><stop offset="0" stop-color="#ffd2a0"/><stop offset=".55" stop-color="#ffb066"/><stop offset="1" stop-color="#ff7a2a" stop-opacity=".35"/></radialGradient>
    <radialGradient id="emberLeaf"><stop offset="0" stop-color="#ffb26b"/><stop offset=".6" stop-color="#f0582a"/><stop offset="1" stop-color="#a8301a"/></radialGradient>
  </defs>
  <!-- the weather only exists while things move: still, it would read as specks on the glass -->
  {#if !$reduced}<g class="weather" aria-hidden="true">
    {#each streaks as w (w.i)}<path class="streak" data-wind="streak" data-ox={w.ox} data-oy={w.oy} data-amp={w.amp} d={`M0 0 c ${w.len * .3} -5 ${w.len * .65} -5 ${w.len} 2`} style="opacity:0"/>{/each}
    {#each motes as m (m.i)}<circle class="mote" data-wind="mote" data-ox={m.ox} data-oy={m.oy} data-f={m.f} data-ph={m.ph} r={m.r} fill-opacity={m.o} transform={`translate(${m.ox - 50} ${m.oy})`}/>{/each}
  </g>{/if}
  <g>
    {#each runs as r (r.x)}
      <g data-wind="grass" data-x={r.x} data-ph={r.ph}>
        {#each r.blades as b (b.x)}<rect class="blade" x={b.x} y={300 - b.h} width="3" height={b.h} rx="1.5" fill="#46474c" style={`--d:${b.d}ms;--dl:${b.dl}ms`}/>{/each}
      </g>
    {/each}
  </g>
  <line x1="0" y1="300" x2="1200" y2="300" stroke="#4b4c51"/>
  {#each trees as { tree: t, dormant }, si (t.server)}
    {@const ts = sway(t.server)}
    {#if dormant}
      <!-- a ghost of the tree to come: it breathes, and barely stirs -->
      <g class="dormant" data-wind="ghost" data-ph={ts.ph} data-tree={t.server}>
        <g data-wind="pivot" data-x={t.x} data-ox={t.x} data-oy="300" data-amp=".08" data-ph={ts.ph} data-f={ts.f}>
          <path d={t.trunk} fill="none" stroke="#5a5b60" stroke-width="1.2"/>
          {#each t.branches as b (b.id)}<path d={b.d} stroke="#5a5b60" stroke-width="1" fill="none" stroke-linecap="round"/>{/each}
        </g>
      </g>
    {:else}
    {@const cs = sway(`${t.server}|crown`)}
    <g class:bare={stations[si]?.bare} data-tree={t.server}>
      <ellipse cx={t.x} cy="200" rx="200" ry="125" fill="url(#glow)"/>
      {#each t.roots as d, i (i)}
        <path class="root" data-wind="root" {...rootTime(t.server, i)} {d} pathLength="1" stroke="#44454a" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path class="root-pulse" {d} pathLength="1" fill="none" stroke-linecap="round"/>
      {/each}
      <g class="trunk" data-wind="pivot" data-x={t.x} data-ox={t.x} data-oy="300" data-amp=".22" data-ph={ts.ph} data-f={ts.f}>
        <path d={t.trunk} fill="#1d1e21"/>
        <g class="crown" data-wind="pivot" data-x={t.top.x} data-ox={t.top.x} data-oy={t.top.y} data-amp=".8" data-ph={cs.ph} data-f={cs.f}>
          {#each t.branches as b (b.id)}
            {@const s = sway(`${t.server}|${b.id}`)}
            <g class="limb" data-wind="pivot" data-x={b.tip.x} data-ox={b.base.x} data-oy={b.base.y} data-amp={(1.2 + 6 / Math.max(b.width, 2)).toFixed(2)} data-ph={s.ph} data-f={s.f}>
              <path d={b.d} stroke="#232427" stroke-width={b.width} fill="none" stroke-linecap="round"><title>{b.app}</title></path>
              <g transform={`translate(${b.tip.x} ${b.tip.y})`}>
                <g data-wind="flutter" data-x={b.tip.x} data-ph={s.ph * 1.7} data-f={s.f}>
                  {#each b.leaves as l, i (i)}
                    <!-- the ember glow is a precomputed halo, not a CSS filter re-rasterised on every sway frame -->
                    {#if l.ember}<circle cx={l.x} cy={l.y} r={l.r * 1.8} fill="url(#emberHalo)"/><circle class="leaf ember" cx={l.x} cy={l.y} r={l.r} fill="url(#emberLeaf)" fill-opacity=".95"/>
                    {:else}<circle class="leaf" cx={l.x} cy={l.y} r={l.r} fill={PAL[Math.floor(l.tone * 5)]} fill-opacity={.5 + ((l.tone * 5) % 1) * .42}/>{/if}
                  {/each}
                </g>
              </g>
            </g>
          {/each}
        </g>
      </g>
      {#each t.branches as b (b.id)}
        {@const s = sparks(t.server, b)}
        {#each s.falls as f (f.id)}<ellipse class="fall" data-wind="fall" data-f={f.f} data-ph={f.dl} data-amp={f.dx} cx={f.cx} cy={f.cy} rx="3.4" ry="1.9" fill="#f2702f"/>{/each}
        {#each s.embers as e (e.id)}<circle class="ember-p" data-wind="rise" data-f={e.f} data-ph={e.dl} data-amp={e.dx} cx={e.cx} cy={e.cy} r={e.r} fill="url(#sparkGlow)"/>{/each}
      {/each}
    </g>
    {/if}
  {/each}
  {#each drops as d (d.id)}<ellipse class="drop" cx={d.cx} cy={d.cy} rx="3.6" ry="2" fill="url(#emberLeaf)" style={`--dx:${d.dx}px`} onanimationend={() => (drops = drops.filter(x => x.id !== d.id))}/>{/each}
</svg>
<div class="stations">
  {#each stations as s (s.id)}
    <div class="st" data-server={s.id}><b>{s.name}</b><span>{s.line}</span><br><i class:warm={s.warm}>● {s.word}</i></div>
  {/each}
</div>
