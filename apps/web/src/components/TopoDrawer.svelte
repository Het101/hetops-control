<script lang="ts">
  import { hot, WORD, type EdgeView, type NodeView } from "../lib/topology.js";

  // a station or a link: its facts, the live signals behind its state, and where to look; the same native dialog as Drawer
  let { node, edge, names, onclose }: { node?: NodeView; edge?: EdgeView; names: Record<string, string>; onclose: () => void } = $props();
  let dlg = $state<HTMLDialogElement>();
  $effect(() => { if ((node || edge) && dlg && !dlg.open) dlg.showModal(); });

  const it = $derived(edge ?? node);
  const facts = $derived(edge ? [["from", names[edge.from]!], ["to", names[edge.to]!], ...edge.facts, ...(edge.perMin !== undefined ? [["flow", `${edge.perMin.toLocaleString()} docs/min`]] : [])]
    : node ? [...node.facts, ...(node.stats ? [["running", node.stats]] : [])] : []);
</script>

<dialog bind:this={dlg} class="drawer raised" aria-labelledby="topo-h" onclose={onclose} onclick={e => { if (e.target === dlg) dlg?.close(); }}>
  {#if it}
    <div class="drawer-in">
      <header>
        <span class="kicker">{edge ? `LINK · ${edge.via}` : "STATION"}</span>
        <button type="button" class="knob raised x" aria-label="Close" onclick={() => dlg?.close()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </header>
      <h2 id="topo-h">{it.name}</h2>
      <p class="state" class:warm={hot(it.state)}>● {node?.server && it.state === "ok" ? "HEALTHY" : WORD[it.state]} · {it.reason}</p>
      <dl class="facts">{#each facts as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}</dl>
      <h3 class="sub-h"><span>{edge ? "SIGNALS · WHAT PROVES IT" : "ITS LINKS"}</span></h3>
      {#each it.signals as s, i (`${s.label}|${i}`)}
        <div class="sig" class:warm={hot(s.state)}><i class="pip {s.state}"></i><span><b>{s.label}</b><small>{WORD[s.state].toLowerCase()} · {s.detail}</small></span></div>
      {:else}<p class="note">No signal reports on this link yet, so it shows as unknown, never as healthy.</p>{/each}
      <h3 class="sub-h"><span>OPEN IN</span></h3>
      {#if it.links.length}
        <div class="links">{#each it.links as l (l.href)}<a class="back raised" href={l.href} {...l.href.startsWith("/") ? {} : { target: "_blank", rel: "noreferrer" }}>{l.label}{l.href.startsWith("/") ? "" : " ↗"}</a>{/each}</div>
      {:else}<p class="note">Nothing to open for this one.</p>{/if}
    </div>
  {/if}
</dialog>

<style>
  .sig{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--bg-deep);font-size:13px}
  .sig small{display:block;color:var(--ink-3);font-size:11.5px;margin-top:2px;overflow-wrap:anywhere}
  .sig.warm b,.sig.warm small{color:var(--ember)}
  .pip{flex:none;width:9px;height:9px;margin-top:4px;border-radius:50%;background:var(--quiet)}
  .pip.attention,.pip.down{background:var(--ember)}
  .pip.unknown{background:none;box-shadow:inset 0 0 0 1.5px var(--ink-3)}
  .pip.planned{background:none;outline:1.5px dashed var(--ink-3);outline-offset:-1.5px}
</style>
