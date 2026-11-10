<script lang="ts">
  import type { Entity } from "@hetops-control/contracts";
  import type { Headline } from "../lib/api.js";
  import { catalog, ui } from "../lib/action-state.svelte.js";
  import { offer, pageOf } from "../lib/actions.js";
  import { go } from "../lib/router.svelte.js";
  // Everything that needs you, from any page: an ember pill in the top bar while anything does, and behind it a queue to work
  // through from the keyboard (n opens it; j/k or the arrows move; Enter acts, or opens the page when there is nothing to press).
  let { needs, entities }: { needs: Headline["needs"]; entities: Entity[] } = $props();
  let dlg = $state<HTMLDialogElement>(), list = $state<HTMLElement>();
  const items = $derived(needs.map(n => {
    const e = entities.find(x => x.id === n.entity), o = e && n.action ? offer(e, n.action.id, catalog.list) : undefined;
    return { n, e, o, page: pageOf(n.entity) };
  }));
  const rows = () => [...(list?.querySelectorAll<HTMLButtonElement>("button.q-row") ?? [])];
  const open = () => { dlg?.showModal(); rows()[0]?.focus(); };
  const act = (i: (typeof items)[number]) => {
    dlg?.close();
    if (i.e && i.o) ui.open = { entity: i.e, ...i.o }; else go(i.page.href);
  };
  const move = (e: KeyboardEvent) => {
    const r = rows(), at = r.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || !r.length) return;
    e.preventDefault(); r[(at + step + r.length) % r.length]!.focus();
  };
  // n opens the queue from anywhere, unless the owner is typing or another dialog is up
  const key = (e: KeyboardEvent) => {
    const t = e.target as Element | null;
    if (e.key !== "n" || e.ctrlKey || e.metaKey || e.altKey || !needs.length || t?.closest("input,textarea,select,[contenteditable],dialog[open]")) return;
    e.preventDefault(); open();
  };
</script>

<svelte:window onkeydown={key} />
{#if needs.length}
  <button type="button" class="q-pill" onclick={open} aria-keyshortcuts="n" title="Open the queue (n)">
    <i aria-hidden="true"></i>{needs.length} need{needs.length === 1 ? "s" : ""} you</button>
{/if}
<dialog bind:this={dlg} class="q-dlg raised" aria-labelledby="q-h" onkeydown={move}>
  <h2 id="q-h"><span>Needs you · {needs.length}</span><button type="button" class="q-x" aria-label="Close" onclick={() => dlg?.close()}>×</button></h2>
  <div class="q-list" bind:this={list}>
    {#each items as i, k (i.n.entity + k)}
      <button type="button" class="q-row" onclick={() => act(i)}>
        <span class="q-n mono" aria-hidden="true">{k + 1}</span>
        <span class="t">{i.n.text}<small>{i.n.detail}</small></span>
        <span class="q-do">{i.o ? i.o.descriptor.label : `Open ${i.page.label}`} →</span>
      </button>
    {:else}<p class="need-none">Nothing is waiting on you.</p>{/each}
  </div>
  <p class="q-keys mono"><kbd>j</kbd> <kbd>k</kbd> move · <kbd>enter</kbd> act · <kbd>esc</kbd> close</p>
</dialog>
