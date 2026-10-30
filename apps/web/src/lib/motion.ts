/** Read once at load: every CSS animation is also switched off by the reduced-motion rule in tokens.css. */
export const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const ease = "cubic-bezier(.22,1,.36,1)";
const easeOut = (p: number) => 1 - Math.pow(1 - p, 4); // the mock's count-up curve

/** Svelte action: counts the node's text from the last value to `to` — the only rAF loop in the app. */
export function countUp(node: HTMLElement, to: number) {
  let from = 0, raf = 0;
  const run = (target: number) => {
    cancelAnimationFrame(raf);
    if (reduced) { node.textContent = target.toLocaleString(); from = target; return; }
    const start = from, t0 = performance.now(), dur = 1500;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur); from = Math.round(start + (target - start) * easeOut(p));
      node.textContent = from.toLocaleString();
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  run(to);
  return { update: run, destroy: () => cancelAnimationFrame(raf) };
}
