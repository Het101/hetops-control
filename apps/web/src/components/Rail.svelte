<script lang="ts">
  import NavIcon from "./NavIcon.svelte";
</script>

<nav class="rail">
  <div class="logo raised"><i></i></div>
  <NavIcon label="Home" href="/" active>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-5h4v5"/><path d="M16.5 6.5V4.5h1.8v3.6"/>
      <circle class="smoke" cx="17.4" cy="2.6" r="1"/><circle class="smoke s2" cx="18.2" cy="1.6" r=".8"/>
    </svg>
  </NavIcon>
  <NavIcon label="Topology">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <circle cx="5" cy="6" r="2.4"/><circle cx="19" cy="6" r="2.4"/><circle cx="12" cy="18.5" r="2.4"/>
      <path d="M7.2 7.2 10.6 16.6M16.8 7.2 13.4 16.6M7.4 6h9.2"/>
      <circle class="travel" r="1.3" fill="currentColor" style="offset-path:path('M7.4 6 H16.6 L13.4 16.6 L10.6 16.6 Z')"/>
    </svg>
  </NavIcon>
  <NavIcon label="Timeline">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <circle cx="12" cy="12" r="8.5"/><path class="hand h" d="M12 12V8"/><path class="hand m" d="M12 12l4 2"/>
    </svg>
  </NavIcon>
  <NavIcon label="Alerts">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <path d="M12 12v9"/><circle cx="12" cy="10.5" r="1.4" fill="currentColor"/>
      <path class="wave w1" d="M9.2 8a4 4 0 0 0 0 5M14.8 8a4 4 0 0 1 0 5"/>
      <path class="wave w2" d="M6.6 5.6a7.5 7.5 0 0 0 0 9.8M17.4 5.6a7.5 7.5 0 0 1 0 9.8"/>
      <path class="wave w3" d="M4 3.2a11 11 0 0 0 0 14.6M20 3.2a11 11 0 0 1 0 14.6"/>
    </svg>
  </NavIcon>
  <NavIcon label="Apps">
    <svg viewBox="0 0 24 24" fill="currentColor"><circle class="dot d1" cx="6" cy="12" r="2.1"/><circle class="dot d2" cx="12" cy="12" r="2.1"/><circle class="dot d3" cx="18" cy="12" r="2.1"/></svg>
  </NavIcon>
  <NavIcon label="Backups">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/><g class="arrow"><path d="M12 4v10"/><path d="m8 10 4 4 4-4"/></g>
    </svg>
  </NavIcon>
  <NavIcon label="Security">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.5-7 9-4.1-1.5-7-4.8-7-9V6z"/><circle class="ring" cx="12" cy="11.5" r="3.2"/>
    </svg>
  </NavIcon>
  <div class="sp"></div>
  <NavIcon label="Settings">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <g class="gear"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/></g>
    </svg>
  </NavIcon>
</nav>
