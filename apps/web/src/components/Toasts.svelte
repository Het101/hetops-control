<script lang="ts">
  import { flip } from "svelte/animate";
  import { fly } from "svelte/transition";
  import { dismiss, runs, said } from "../lib/action-state.svelte.js";
  import { countdown, middle, toastOf } from "../lib/actions.js";
  import { reduced } from "../lib/motion.js";
  import { route } from "../lib/router.svelte.js";

  // a success leaves after LINGER_MS (paused while pointed at or focused); a failure needs you, so it stays until dismissed
  const LINGER_MS = 6000, SHOWN = 3;
  let all = $state(false), copied = $state<string>();
  const shown = $derived(all ? runs.list : runs.list.slice(0, SHOWN));
  const hidden = $derived(runs.list.length - shown.length);
  $effect(() => { if (runs.list.length <= SHOWN) all = false; });
  // transform and opacity only, ease-out; none at all under reduced motion (the OS, or Settings)
  const out4 = (p: number) => 1 - Math.pow(1 - p, 4);
  const motion = (o: { y: number; duration: number }) => ({ ...o, duration: $reduced ? 0 : o.duration, easing: out4 });

  /** The countdown follows the toast: it starts when the run succeeds, holds on hover or focus, and data-held pauses the line. */
  function linger(node: HTMLElement, p: { on: boolean; done: () => void }) {
    let c: ReturnType<typeof countdown> | undefined, over = false, focused = false;
    const sync = () => { const held = over || focused; node.toggleAttribute("data-held", held); if (held) c?.pause(); else c?.resume(); };
    const set = (q: typeof p) => { if (q.on && !c) { c = countdown(LINGER_MS, q.done); sync(); } else if (!q.on) { c?.stop(); c = undefined; } };
    const on: [string, (e: Event) => void][] = [["pointerenter", () => { over = true; sync(); }], ["pointerleave", () => { over = false; sync(); }],
      ["focusin", () => { focused = true; sync(); }], ["focusout", e => { focused = node.contains((e as FocusEvent).relatedTarget as Node | null); sync(); }]];
    on.forEach(([k, f]) => node.addEventListener(k, f));
    set(p);
    return { update: set, destroy: () => { c?.stop(); on.forEach(([k, f]) => node.removeEventListener(k, f)); } };
  }

  async function copy(id: string, ref: string, el: HTMLElement | null) {
    try { await navigator.clipboard.writeText(ref); copied = id; setTimeout(() => { if (copied === id) copied = undefined; }, 1600); }
    catch { if (el) getSelection()?.selectAllChildren(el); }   // no clipboard (an insecure origin): select it for Ctrl+C
  }
</script>

<!-- the live regions are always there, so a change in them is announced; the cards themselves stay quiet -->
<div class="sr" role="status" aria-live="polite">{said.polite}</div>
<div class="sr" role="alert" aria-live="assertive">{said.assertive}</div>

<section class="toasts" aria-label="Action results">
  {#each shown as r (r.id)}
    {@const t = toastOf(r)}
    <article class="toast raised" data-tone={t.tone} aria-labelledby={`tt-${r.id}`}
      use:linger={{ on: t.tone === "done", done: () => dismiss(r.id) }}
      in:fly={motion({ y: 14, duration: 380 })} out:fly={motion({ y: 8, duration: 220 })} animate:flip={{ duration: $reduced ? 0 : 280, easing: out4 }}>
      <svg class="tg" viewBox="0 0 24 24" aria-hidden="true">
        {#if t.tone === "running"}<circle class="tg-ring" cx="12" cy="12" r="9" /><path class="tg-arc" d="M12 3a9 9 0 0 1 9 9" />
        {:else if t.tone === "done"}<circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.7 2.7L16.2 9.6" />
        {:else}<circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" />{/if}
      </svg>
      <div class="toast-b">
        <p class="toast-h" id={`tt-${r.id}`}>{t.title}</p>
        <p class="toast-l">{t.line}</p>
        {#if t.detail}<p class="toast-why">{t.detail}</p>{/if}
        {#if t.ref}
          <div class="toast-ref pressed">
            <span class="mono" title={t.ref} id={`tr-${r.id}`}>{middle(t.ref)}</span>
            <button type="button" class="toast-copy" aria-label={copied === r.id ? `Copied the ${t.refName}` : `Copy the ${t.refName}`}
              onclick={() => copy(r.id, t.ref!, document.getElementById(`tr-${r.id}`))}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {#if copied === r.id}<path d="m6 12.5 4 4L18 8" />{:else}<rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 5.5V5a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h.5" />{/if}
              </svg>
            </button>
          </div>
        {/if}
        {#if t.next && route.path !== t.next.href}<a class="toast-next" href={t.next.href}>View in {t.next.label} <span aria-hidden="true">→</span></a>{/if}
      </div>
      {#if t.tone !== "running"}
        <button type="button" class="toast-x" aria-label={`Dismiss ${t.title}`} onclick={() => dismiss(r.id)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
        </button>
      {/if}
      {#if t.tone === "done" && !$reduced}<span class="toast-life" aria-hidden="true"></span>{/if}
    </article>
  {/each}
  {#if hidden > 0 || all}
    <button type="button" class="toast-more" aria-expanded={all} onclick={() => (all = !all)}>{all ? "Show fewer" : `${hidden} earlier`}</button>
  {/if}
</section>
