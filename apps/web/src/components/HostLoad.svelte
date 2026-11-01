<script lang="ts">
  import { ServerIdSchema } from "@hetops-control/contracts";
  import Dial from "./Dial.svelte";
  import { num, type State } from "../lib/api.js";
  import { needsYou } from "../lib/pages.js";
  let { state }: { state: State } = $props();

  // ember only when a node needs you (its agent says attention or down); a busy CPU on its own is not a reason to look
  // a server's load is its busiest node
  const max = (xs: (number | undefined)[]) => { const v = xs.filter((x): x is number => x !== undefined); return v.length ? Math.max(...v) : undefined; };
  const loads = $derived(ServerIdSchema.options.map(id => {
    const nodes = state.entities.filter(e => e.kind === "node" && e.server === id);
    return { id, hot: nodes.some(n => needsYou(n.status)), cpu: max(nodes.map(n => num(n, "cpu"))), mem: max(nodes.map(n => num(n, "memory"))), disk: max(nodes.map(n => num(n, "disk"))) };
  }));
  const pct = (v: number | undefined) => v === undefined ? "—" : `${Math.round(v)}%`;
</script>

<section class="mod raised c4" style="--in:.1s" data-module="hostload">
  <h4><span>HOST LOAD</span><span>now</span></h4>
  <div class="dials">
    {#each loads as l (l.id)}
      <Dial id={l.id} label={l.id.toUpperCase()} value={l.cpu} hot={l.hot}>
        <small>mem {pct(l.mem)}</small><small>disk {pct(l.disk)}</small>
      </Dial>
    {/each}
  </div>
  <div class="note">CPU of the busiest node · ember when a node needs you</div>
</section>
