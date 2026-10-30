<script lang="ts">
  import { ServerIdSchema, type Entity, type ServerId } from "@hetops-control/contracts";
  import { growTree, hash, rng, struggling, type Branch } from "../lib/forest.js";
  import { num, type State } from "../lib/api.js";
  import { reduced } from "../lib/motion.js";

  let { state }: { state: State } = $props();

  const X: Record<ServerId, number> = { lab: 200, staging: 600, ops: 1000 };
  const NAME: Record<ServerId, string> = { lab: "Lab", staging: "Staging", ops: "Ops" };
  const PAL = ["#5f6065", "#7b7c81", "#9c9b98", "#c4c2bd", "#d9d7d1"];

  // the ground never changes: one blade every 5 units, as in the mock (without its decorative ember blades)
  const blades = Array.from({ length: 240 }, (_, i) => ({ x: i * 5, h: 4 + Math.abs(Math.sin(i * .21) * 10 + Math.sin(i * .07) * 14), d: 1400 + ((i * 37) % 700), dl: i * 4 }));

  const apps = (s: ServerId, all: Entity[]) => all.filter(e => e.kind === "app" && e.server === s);

  const trees = $derived(ServerIdSchema.options.map(s => growTree(s, X[s], apps(s, state.entities).map(e => ({
    id: e.id, name: e.name, status: e.status, restarts: num(e, "restarts24h") ?? 0,
    // the canopy is the intended size; a missing pod shows as ember, not as a smaller tree
    pods: Math.max(num(e, "podsDesired") ?? 0, num(e, "pods") ?? 0) })))));

  type Station = { id: ServerId; name: string; line: string; word: string; warm: boolean; bare: boolean };
  const stations = $derived(ServerIdSchema.options.map((id): Station => {
    const view = state.servers[id], list = apps(id, state.entities);
    const cluster = state.entities.find(e => e.kind === "cluster" && e.server === id);
    const restarts = list.reduce((n, e) => n + (num(e, "restarts24h") ?? 0), 0);
    const never = !view.reachable && !state.entities.some(e => e.server === id);
    const running = num(cluster, "podsRunning"), total = num(cluster, "podsTotal"), version = cluster?.facts.version?.value;
    const line = cluster ? [version, `${list.length} apps`, running !== undefined && total !== undefined ? `${running}/${total} pods` : undefined].filter(Boolean).join(" · ")
      : view.statusReason ?? "no agent yet";
    const base = { id, name: NAME[id], line, bare: !view.reachable };
    if (!view.reachable) return id === "staging" && never ? { ...base, word: "NOT CONNECTED", warm: false } : { ...base, word: "UNREACHABLE", warm: true };
    if (view.status === "down" || list.some(e => e.status === "down")) return { ...base, word: "DOWN", warm: true };
    if (view.status === "attention" || restarts > 0 || list.some(e => e.status === "attention"))
      return { ...base, word: restarts ? `SMOULDERING · ${restarts} restart${restarts > 1 ? "s" : ""}` : "SMOULDERING", warm: true };
    if (view.status === "unknown") return { ...base, word: "UNKNOWN", warm: false };
    return { ...base, word: "HEALTHY", warm: false };
  }));

  /** Falling leaves and rising embers around a struggling branch's ember leaves; seeded, so they stay put between readings. */
  function sparks(server: ServerId, b: Branch) {
    const hot = b.leaves.filter(l => l.ember);
    if (reduced || !struggling(b) || !hot.length) return { falls: [], embers: [] };
    const R = rng(hash(`${server}|${b.app}|sparks`)), rs = Math.min(Math.max(b.restarts, 1), 4);
    const ex = hot.reduce((n, l) => n + l.x, 0) / hot.length, ey = hot.reduce((n, l) => n + l.y, 0) / hot.length;
    return {
      falls: Array.from({ length: rs * 3 }, (_, f) => ({ cx: ex + (R() - .5) * 30, cy: ey + 10, style: `--d:${5 + R() * 3}s;--dl:${f * 1.4}s;--dx:${(R() - .3) * 60}px` })),
      embers: Array.from({ length: rs * 9 }, () => ({ cx: ex + (R() - .5) * 40, cy: ey + (R() - .5) * 20, r: 1 + R() * 1.6, style: `--d:${2.2 + R() * 2}s;--dl:${R() * 3}s;--dx:${(R() - .5) * 30}px` })),
    };
  }
</script>

<svg class="forest" viewBox="0 0 1200 320" preserveAspectRatio="xMidYMax meet" role="img" aria-label="One tree per server; branches are apps, leaves are pods, ember leaves are restarts">
  <defs>
    <radialGradient id="glow"><stop offset="0" stop-color="#4a4b51" stop-opacity=".55"/><stop offset="1" stop-color="#4a4b51" stop-opacity="0"/></radialGradient>
    <radialGradient id="emberLeaf"><stop offset="0" stop-color="#ffb26b"/><stop offset=".6" stop-color="#f0582a"/><stop offset="1" stop-color="#a8301a"/></radialGradient>
  </defs>
  <g>
    {#each blades as b}<rect class="blade" x={b.x} y={300 - b.h} width="3" height={b.h} rx="1.5" fill="#46474c" style={`--d:${b.d}ms;--dl:${b.dl}ms`}/>{/each}
  </g>
  <line x1="0" y1="300" x2="1200" y2="300" stroke="#4b4c51"/>
  {#each trees as t, si (t.server)}
    <g class:bare={stations[si]?.bare}>
      <ellipse cx={t.x} cy="200" rx="200" ry="125" fill="url(#glow)"/>
      {#each t.roots as d}<path {d} stroke="#44454a" stroke-width="2" fill="none"/>{/each}
      <path d={t.trunk} fill="#1d1e21"/>
      <g class="canopy" style={`--d:${6 + si * 1.3}s`}>
        {#each t.branches as b}
          <path d={b.d} stroke="#232427" stroke-width={b.width} fill="none" stroke-linecap="round"><title>{b.app}</title></path>
          {#each b.leaves as l}
            {#if l.ember}<circle class="leaf ember" cx={l.x} cy={l.y} r={l.r} fill="url(#emberLeaf)" opacity=".95" style="filter:drop-shadow(0 0 5px rgba(242,88,42,.7))"/>
            {:else}<circle class="leaf" cx={l.x} cy={l.y} r={l.r} fill={PAL[Math.floor(l.tone * 5)]} opacity={.5 + ((l.tone * 5) % 1) * .42}/>{/if}
          {/each}
        {/each}
      </g>
      {#each t.branches as b}
        {@const s = sparks(t.server, b)}
        {#each s.falls as f}<ellipse class="fall" cx={f.cx} cy={f.cy} rx="3.4" ry="1.9" fill="#f2702f" style={f.style}/>{/each}
        {#each s.embers as e}<circle class="ember-p" cx={e.cx} cy={e.cy} r={e.r} fill="#ffb066" style={e.style}/>{/each}
      {/each}
    </g>
  {/each}
</svg>
<div class="stations">
  {#each stations as s (s.id)}
    <div class="st" data-server={s.id}><b>{s.name}</b><span>{s.line}</span><br><i class:warm={s.warm}>● {s.word}</i></div>
  {/each}
</div>
