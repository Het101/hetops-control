<script lang="ts">
  import NavIcon from "./NavIcon.svelte";
  import { route } from "../lib/router.svelte.js";
  // Each icon is drawn once and used twice: in the rail, and on a phone, the pages that do not fit the bottom bar (spill) sit in
  // the More sheet instead (a native popover: light dismiss, Esc and focus handling come with it).
  const items = [
    { label: "Home", href: "/", icon: i0, spill: false },
    { label: "Topology", href: "/topology", icon: i1, spill: true },
    { label: "Timeline", href: "/timeline", icon: i2, spill: false },
    { label: "Alerts", href: "/alerts", icon: i3, spill: false },
    { label: "Apps", href: "/apps", icon: i4, spill: false },
    { label: "Backups", href: "/backups", icon: i5, spill: true },
    { label: "Security", href: "/security", icon: i6, spill: true },
    { label: "Settings", href: "/settings", icon: i7, spill: true },
  ];
  const away = $derived(items.some(n => n.spill && route.path === n.href));   // More is where you are when you are on one of them
  let sheet = $state<HTMLElement>();
  $effect(() => { void route.path; sheet?.hidePopover?.(); });              // a pick closes the sheet
</script>

{#snippet i0()}
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-5h4v5"/><path d="M16.5 6.5V4.5h1.8v3.6"/>
      <circle class="smoke" cx="17.4" cy="2.6" r="1"/><circle class="smoke s2" cx="18.2" cy="1.6" r=".8"/>
    </svg>
{/snippet}
{#snippet i1()}
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <circle cx="5" cy="6" r="2.4"/><circle cx="19" cy="6" r="2.4"/><circle cx="12" cy="18.5" r="2.4"/>
      <path d="M7.2 7.2 10.6 16.6M16.8 7.2 13.4 16.6M7.4 6h9.2"/>
      <circle class="travel" r="1.3" fill="currentColor" style="offset-path:path('M7.4 6 H16.6 L13.4 16.6 L10.6 16.6 Z')"/>
    </svg>
{/snippet}
{#snippet i2()}
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <circle cx="12" cy="12" r="8.5"/><path class="hand h" d="M12 12V8"/><path class="hand m" d="M12 12l4 2"/>
    </svg>
{/snippet}
{#snippet i3()}
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <path d="M12 12v9"/><circle cx="12" cy="10.5" r="1.4" fill="currentColor"/>
      <path class="wave w1" d="M9.2 8a4 4 0 0 0 0 5M14.8 8a4 4 0 0 1 0 5"/>
      <path class="wave w2" d="M6.6 5.6a7.5 7.5 0 0 0 0 9.8M17.4 5.6a7.5 7.5 0 0 1 0 9.8"/>
      <path class="wave w3" d="M4 3.2a11 11 0 0 0 0 14.6M20 3.2a11 11 0 0 1 0 14.6"/>
    </svg>
{/snippet}
{#snippet i4()}
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle class="dot d1" cx="6" cy="12" r="2.1"/><circle class="dot d2" cx="12" cy="12" r="2.1"/><circle class="dot d3" cx="18" cy="12" r="2.1"/></svg>
{/snippet}
{#snippet i5()}
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/><g class="arrow"><path d="M12 4v10"/><path d="m8 10 4 4 4-4"/></g>
    </svg>
{/snippet}
{#snippet i6()}
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.5-7 9-4.1-1.5-7-4.8-7-9V6z"/><circle class="ring" cx="12" cy="11.5" r="3.2"/>
    </svg>
{/snippet}
{#snippet i7()}
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <g class="gear"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/></g>
    </svg>
{/snippet}

<nav class="rail" aria-label="Pages">
  <div class="logo raised"><i></i></div>
  {#each items as n (n.href)}
    {#if n.href === "/settings"}<div class="sp"></div>{/if}
    <NavIcon label={n.label} href={n.href} spill={n.spill}>{@render n.icon()}</NavIcon>
  {/each}
  <button type="button" class="nav more" class:on={away} class:pressed={away} class:raised={!away} popovertarget="more-pages" aria-label="More pages">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4.5" y="4.5" width="6" height="6" rx="1.6"/><rect x="13.5" y="4.5" width="6" height="6" rx="1.6"/><rect x="4.5" y="13.5" width="6" height="6" rx="1.6"/><rect x="13.5" y="13.5" width="6" height="6" rx="1.6"/></svg>
  </button>
</nav>
<div class="sheet raised" id="more-pages" popover bind:this={sheet} aria-label="More pages">
  {#each items.filter(n => n.spill) as n (n.href)}
    <a class="sheet-l" class:on={route.path === n.href} href={n.href} aria-current={route.path === n.href ? "page" : undefined}>
      <span class="nav pressed" aria-hidden="true">{@render n.icon()}</span>{n.label}</a>
  {/each}
</div>
