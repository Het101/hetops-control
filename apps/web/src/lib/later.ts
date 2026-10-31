/**
 * Mount work in idle slices, one at a time, in the order asked: the first render paints the hero, and the modules below it
 * follow in small tasks instead of one long one. Only what is mounted waits; the data and the stream never do.
 */
const queue: (() => void)[] = [];
let pumping = false;
const idle = (f: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: 150 }) : setTimeout(f, 1));
function pump() {
  const f = queue.shift();
  if (!f) { pumping = false; return; }
  f();
  idle(pump);
}
export function later(f: () => void) {
  queue.push(f);
  if (!pumping) { pumping = true; idle(pump); }
}
