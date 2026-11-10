<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import { catalog, ui } from "../lib/action-state.svelte.js";
  import { offer } from "../lib/actions.js";
  import { commands, search, type Command } from "../lib/palette.js";
  import { go, PAGES } from "../lib/router.svelte.js";
  // Ctrl+K (or ⌘K) from anywhere: go to any page, server, app or site, or start any action an entity offers. The action opens
  // the same guarded dialog as its knob, so the palette is a shortcut, never a way around the preview and the confirm.
  let { entities }: { entities: Entity[] } = $props();
  let dlg = $state<HTMLDialogElement>(), input = $state<HTMLInputElement>(), q = $state(""), at = $state(0);
  const all = $derived(commands(PAGES, entities, catalog.list));
  const shown = $derived(search(all, q));
  const groups = $derived([...new Set(shown.map(c => c.group))].map(g => ({ g, list: shown.filter(c => c.group === g) })));
  $effect(() => { void q; at = 0; });

  const open = () => { q = ""; dlg?.showModal(); queueMicrotask(() => input?.focus()); };
  function run(c: Command | undefined) {
    if (!c) return;
    dlg?.close();
    if (c.act) { const o = offer(c.act.entity, c.act.action, catalog.list); if (o) ui.open = { entity: c.act.entity, ...o }; }
    else if (c.go) go(c.go);
  }
  const key = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); dlg?.open ? dlg.close() : open(); }
  };
  const nav = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); at = (at + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(shown.length, 1); }
    else if (e.key === "Enter") { e.preventDefault(); run(shown[at]); }
  };
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
</script>

<svelte:window onkeydown={key} />
<button type="button" class="pal-open" onclick={open} aria-keyshortcuts="Control+K Meta+K" title="Go anywhere or run an action">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
  <span>Go to</span><kbd>{isMac ? "⌘" : "Ctrl"} K</kbd></button>
<dialog bind:this={dlg} class="palette raised" aria-label="Go to or run">
  <div class="pal-in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
    <input bind:this={input} bind:value={q} onkeydown={nav} placeholder="A page, server, app, site or action" aria-label="Search pages, servers, apps and actions"
      role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={shown[at] ? `pal-${shown[at]!.id}` : undefined} autocomplete="off" spellcheck="false" />
    <kbd>esc</kbd></div>
  <div class="pal-list" id="pal-list" role="listbox" aria-label="Results">
    {#each groups as grp (grp.g)}
      <div class="pal-g" role="presentation">{grp.g}</div>
      {#each grp.list as c (c.id)}
        {@const i = shown.indexOf(c)}
        <div class="pal-row" class:on={i === at} id={`pal-${c.id}`} role="option" aria-selected={i === at} tabindex="-1"
          onclick={() => run(c)} onkeydown={() => {}} onmouseenter={() => (at = i)}>
          <span class="pal-l">{c.label}</span><span class="pal-h mono">{c.hint}</span>
          {#if c.act}<span class="pal-do">Run</span>{/if}
        </div>
      {/each}
    {:else}<p class="pal-none">Nothing matches “{q}”</p>{/each}
  </div>
  <p class="pal-keys mono"><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>enter</kbd> go or run · <kbd>esc</kbd> close</p>
</dialog>
