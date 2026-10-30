<script lang="ts">
  // "/" focuses the search from anywhere on the page, unless the owner is already typing somewhere
  let { q = $bindable(""), placeholder }: { q?: string; placeholder: string } = $props();
  let input = $state<HTMLInputElement>();
  const key = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || t?.closest("input,textarea,select,[contenteditable],dialog[open]")) return;
    e.preventDefault(); input?.focus();
  };
</script>

<svelte:window onkeydown={key} />
<label class="find pressed">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
  <input bind:this={input} type="search" bind:value={q} {placeholder} aria-label={placeholder} autocomplete="off" spellcheck="false"
    onkeydown={e => { if (e.key === "Escape") { q = ""; input?.blur(); } }}>
  <kbd class="mono" aria-hidden="true">/</kbd>
</label>
