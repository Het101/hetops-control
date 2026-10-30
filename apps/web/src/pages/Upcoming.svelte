<script lang="ts">
  import { PAGES, type Upcoming } from "../lib/router.svelte.js";
  let { path }: { path: Upcoming } = $props();

  // what each page will show once its source reports; nothing here is sample data
  const COPY: Record<Upcoming, { lead: string; will: string[] }> = {
    "/topology": { lead: "The estate as a transit map, drawn from what the agents report.",
      will: ["lab, staging and ops as three lines, their components as stations", "each link coloured by the check that proves it: tunnels, Tailscale, log shipping, backups", "a detail drawer for every station"] },
  };
  const c = $derived(COPY[path]);
</script>

<section class="page-intro">
  <span class="kicker">{PAGES[path].toUpperCase()}</span>
  <h1 tabindex="-1">{c.lead}</h1>
</section>
<section class="mod raised waiting" style="--in:.06s">
  <h4><span>NO SOURCE REPORTING YET</span><span class="tag pressed">EMPTY</span></h4>
  <p>This page fills in when its source starts reporting. Until then it stays empty rather than show sample numbers.</p>
  <ul>{#each c.will as w}<li>{w}</li>{/each}</ul>
  <a class="back raised" href="/">Back to Home</a>
</section>
