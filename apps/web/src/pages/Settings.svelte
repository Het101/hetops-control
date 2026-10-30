<script lang="ts">
  import { ServerIdSchema, type Me, type ServerView, type SourceReport } from "@hetops-control/contracts";
  import { loadMe, type State } from "../lib/api.js";
  import { prefs, type Prefs } from "../lib/prefs.js";
  let { estate, now }: { estate: State | undefined; now: Date } = $props();

  let me = $state<Me>(); let meFailed = $state(false);
  $effect(() => { loadMe().then(m => { me = m; }, e => { console.warn(e); meFailed = true; }); });

  const servers = ServerIdSchema.options;
  const hhmm = (at: string) => `${at.slice(11, 16)} UTC`;
  const ago = (at: string) => {
    const s = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 1000));
    return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
  };
  const every = (ms: number) => ms < 60_000 ? `every ${Math.round(ms / 1000)} s` : `every ${Math.round(ms / 60_000)} min`;
  // a configured server that cannot be reached is a need (ember); one never configured is just quiet
  const link = (v: ServerView) => !v.configured ? { word: "NOT CONFIGURED", warm: false } : v.reachable ? { word: "CONNECTED", warm: false } : { word: "UNREACHABLE", warm: true };
  const run = (x: SourceReport) => x.ok ? { word: "OK", warm: false } : x.error || x.lastRunAt ? { word: "FAILING", warm: true } : { word: "PENDING", warm: false };

  const MOTION: { v: Prefs["motion"]; label: string }[] = [{ v: "system", label: "System" }, { v: "on", label: "On" }, { v: "off", label: "Off" }];
  const DENSITY: { v: Prefs["density"]; label: string }[] = [{ v: "comfortable", label: "Comfortable" }, { v: "compact", label: "Compact" }];
  const REPO = "https://github.com/Het101/hetops-control";
</script>

<section class="page-intro">
  <span class="kicker">SETTINGS</span>
  <h1 tabindex="-1">How HetOps Control sees the estate, and how it looks to you.</h1>
</section>

<div class="grid">
  <div class="stack c7">
    <section class="mod raised list servers" style="--in:.04s" aria-labelledby="s-agents">
      <h4 id="s-agents"><span>AGENTS</span><span>{servers.length} servers</span></h4>
      {#if !estate}<div class="empty">Waiting for the first state from the center.</div>
      {:else}
        {#each servers as id (id)}
          {@const v = estate.servers[id]} {@const l = link(v)}
          <div class="row" data-server={id}>
            <span class="n">{id}</span>
            <span class="t">{#if v.configured}{v.agentVersion ? `agent ${v.agentVersion}` : "agent version unknown"}
              · {v.reachable ? "reachable" : "unreachable"} since {hhmm(v.since)}{:else}no agent configured{/if}
              {#if v.lastError}<small class="warm">last error: {v.lastError}</small>{/if}</span>
            <span class="tag pressed" class:warm={l.warm}>{l.word}</span>
          </div>
        {/each}
      {/if}
    </section>

    <section class="mod raised list" style="--in:.12s" aria-labelledby="s-sources">
      <h4 id="s-sources"><span>SOURCES</span></h4>
      {#if !estate}<div class="empty">Waiting for the first state from the center.</div>
      {:else}
        {#each servers as id (id)}
          {@const v = estate.servers[id]}
          <div class="group mono">{id.toUpperCase()}</div>
          {#each v.sources ?? [] as x (x.id)}
            {@const r = run(x)}
            <div class="row" data-source={`${id}/${x.id}`}>
              <span class="t">{x.id}<small>{every(x.periodMs)} · {x.lastRunAt ? `last run ${ago(x.lastRunAt)}` : "not run yet"}</small>
                {#if x.error}<small class="warm">{x.error}</small>{/if}</span>
              <span class="tag pressed" class:warm={r.warm}>{r.word}</span>
            </div>
          {:else}
            <div class="empty">{!v.configured ? "No agent configured." : !v.reachable ? "Unreachable: its sources cannot be read." : "The agent reports no sources."}</div>
          {/each}
        {/each}
      {/if}
    </section>
  </div>
  <div class="stack c5">
    <section class="mod raised" style="--in:.08s" aria-labelledby="s-you">
      <h4 id="s-you"><span>SIGNED IN</span></h4>
      {#if me}<p class="big">{me.email || "unknown"}</p><p class="note">Identity from Cloudflare Access, read by the center on every request.</p>
      {:else if meFailed}<p class="note warm">Could not read who is signed in.</p>
      {:else}<p class="note">Reading…</p>{/if}
      <h4 class="sub-h"><span>ABOUT</span></h4>
      <dl class="facts">
        <dt>Build</dt><dd class="mono">{me ? me.version : "…"}</dd>
        <dt>Source</dt><dd><a href={REPO} target="_blank" rel="noreferrer">github.com/Het101/hetops-control</a></dd>
        <dt>Design</dt><dd><a href={`${REPO}/blob/main/docs/specs/2026-10-30-hetops-control-design.md`} target="_blank" rel="noreferrer">design spec</a></dd>
      </dl>
    </section>

    <section class="mod raised" style="--in:.16s" aria-labelledby="s-prefs">
      <h4 id="s-prefs"><span>PREFERENCES</span><span>this browser</span></h4>
      <fieldset class="pick">
        <legend>Reduce motion</legend>
        <div class="seg pressed">
          {#each MOTION as o (o.v)}<label class:on={$prefs.motion === o.v}><input type="radio" name="motion" value={o.v} checked={$prefs.motion === o.v}
            onchange={() => prefs.update(p => ({ ...p, motion: o.v }))}>{o.label}</label>{/each}
        </div>
        <small>System follows your device. On stills every animation; Off keeps them.</small>
      </fieldset>
      <fieldset class="pick">
        <legend>Density</legend>
        <div class="seg pressed">
          {#each DENSITY as o (o.v)}<label class:on={$prefs.density === o.v}><input type="radio" name="density" value={o.v} checked={$prefs.density === o.v}
            onchange={() => prefs.update(p => ({ ...p, density: o.v }))}>{o.label}</label>{/each}
        </div>
      </fieldset>
    </section>
  </div>
</div>
