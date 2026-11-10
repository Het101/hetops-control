<script lang="ts">
  // The one way a status is drawn, everywhere: a dot and a word. ok is moss (alive, healthy), warn is ember (needs you),
  // blind is a hollow ring (can't tell), quiet is silver (neither). Keeps .tag/.warm/.ok so callers and tests read the same.
  export type Tone = "ok" | "warn" | "blind" | "quiet";
  import { sentence } from "../lib/pages.js";
  let { tone, label }: { tone: Tone; label: string } = $props();
</script>

<span class={`status tag ${tone}`} class:warm={tone === "warn"}><i aria-hidden="true"></i>{sentence(label)}</span>
