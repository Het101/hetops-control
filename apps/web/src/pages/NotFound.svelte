<script lang="ts">
  let { path }: { path: string } = $props();
</script>

<section class="page-intro">
  <span class="kicker">404 · NOT ON THE MAP</span>
  <h1 tabindex="-1">There is no page at <span class="mono">{path}</span>.</h1>
</section>
<section class="mod raised waiting" style="--in:.06s">
  <p>The rail on the left lists every page HetOps Control has. The address may be mistyped, or from an older build.</p>
  <a class="back raised" href="/">Back to Home</a>
</section>
