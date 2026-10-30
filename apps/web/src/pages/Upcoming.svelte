<script lang="ts">
  import { PAGES, type Upcoming } from "../lib/router.svelte.js";
  let { path }: { path: Upcoming } = $props();

  // what each page will show once its source reports; nothing here is sample data
  const COPY: Record<Upcoming, { lead: string; will: string[] }> = {
    "/topology": { lead: "The estate as a transit map, drawn from what the agents report.",
      will: ["lab, staging and ops as three lines, their components as stations", "each link coloured by the check that proves it: tunnels, Tailscale, log shipping, backups", "a detail drawer for every station"] },
    "/timeline": { lead: "Every event from every server, in one place.",
      will: ["filters by server, kind and level, and search on /", "detail drawers with links to Grafana, Kibana, Argo and GitHub"] },
    "/alerts": { lead: "What Alertmanager is firing, and what the error budget has left.",
      will: ["firing alerts by severity, with how long they have fired", "silences and the runbook link for each rule"] },
    "/apps": { lead: "The apps Coolify and Argo run, and how their deploys went.",
      will: ["each app with its last deploy, its health and the commit it runs", "deploys that waited or failed, marked as needing you"] },
    "/backups": { lead: "Whether the last backup of everything that matters worked.",
      will: ["each snapshot with its last result and age", "any backup with no success in 26 hours, marked as needing you"] },
    "/security": { lead: "Who knocks, and what the estate did about it.",
      will: ["the \u201cwho knocks\u201d map of CrowdSec decisions by country", "recent bans, detections and Falco highlights"] },
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
