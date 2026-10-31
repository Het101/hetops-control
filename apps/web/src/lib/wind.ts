import { hash, rng } from "./forest.js";
import { drained } from "./later.js";

/**
 * The forest's wind, in scene units (the forest viewBox is 1200 wide). A soft breeze is always moving; every ~11 s a gust
 * rolls in from the left and crosses the scene in about 7 s. Pure functions of (x, t), so the motion is deterministic,
 * each element reads the gust when it reaches its own x (the phase delay by distance), and it is unit-tested.
 */
export const GUST_EVERY = 11; // s between gust starts
export const GUST_SPEED = 260; // units per second, left to right
const GUST_FROM = -300, GUST_WIDTH = 240;

/** gust k: when it starts (seconds) and how strong it is, both seeded so the weather repeats exactly */
export function gustAt(k: number) {
  const R = rng(hash(`gust|${k}`));
  return { t0: k * GUST_EVERY + R() * 3, strength: .7 + R() * .5 };
}
/** where gust k's front is at time t */
export const gustX = (k: number, t: number) => GUST_FROM + (t - gustAt(k).t0) * GUST_SPEED;

/** gust strength at x, t: the sum of the gusts crossing (at most two overlap) */
export function gust(x: number, t: number): number {
  const k = Math.floor(t / GUST_EVERY);
  let g = 0;
  for (const j of [k - 1, k]) {
    if (j < 0) continue;
    const { t0, strength } = gustAt(j);
    if (t < t0) continue;
    const d = (x - (GUST_FROM + (t - t0) * GUST_SPEED)) / GUST_WIDTH;
    g += strength * Math.exp(-d * d);
  }
  return g;
}
/** the always-on breeze, travelling left to right too (phase falls with x) */
export const breeze = (x: number, t: number) => .35 * Math.sin(t * .55 - x * .004) + .14 * Math.sin(t * 1.3 - x * .011 + 1.7);
/** wind at x, t: roughly -0.5 .. 1.7, positive pushes right */
export const wind = (x: number, t: number) => breeze(x, t) + gust(x, t);

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress 0..1 (Newton steps, then bisection), for keyframes replayed in JS */
export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const c = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (x: number) => {
    if (x <= 0 || x >= 1) return x <= 0 ? 0 : 1;
    let s = x;
    for (let i = 0; i < 6; i++) {
      const d = 3 * x1 * (1 - s) ** 2 + 6 * (x2 - x1) * s * (1 - s) + 3 * (1 - x2) * s * s, e = c(x1, x2, s) - x;
      if (Math.abs(e) < 1e-6) return c(y1, y2, s);
      if (Math.abs(d) < 1e-6) break;
      s -= e / d;
    }
    let lo = 0, hi = 1; s = x;
    for (let i = 0; i < 30; i++) { if (c(x1, x2, s) < x) lo = s; else hi = s; s = (lo + hi) / 2; }
    return c(y1, y2, s);
  };
}
const ease = bezier(.22, 1, .36, 1), easeIO = bezier(.65, 0, .35, 1), shake = bezier(.45, .05, .55, .95); // tokens.css --ease, --ease-io; the shaken leaf

/** a scale about the point (cx, cy): an element's own centre, as CSS transform-box: fill-box would give */
const scaleAt = (s: number, cx: number, cy: number) => `translate(${cx} ${cy}) scale(${s.toFixed(4)}) translate(${-cx} ${-cy})`;

type Frame = { transform: string; opacity: number };
/**
 * One frame of the mock's ember keyframes for a particle centred at (cx, cy), `e` seconds into its life, with a cycle of
 * `f` seconds and a sideways drift `dx`. In its delay (e < 0) it is hidden, as the keyframes' first frame is. The leaf
 * spins and the ember shrinks about its own centre.
 *   fall: linear; translate(dx, 120) rotate(320deg) at the end; opacity 0, .95 at 10%, 0
 *   rise: --ease on every keyframe interval; translate(dx, -70) scale(.3) at the end; opacity 0, 1 at 15%, 0
 *   drop: the fall once, on the shaken-leaf curve, holding its last frame (e runs from the moment the leaf came loose)
 */
export function spark(kind: "fall" | "rise" | "drop", e: number, f: number, dx: number, cx: number, cy: number): Frame {
  if (e < 0) return { transform: "", opacity: 0 };
  if (kind === "rise") {
    const p = (e % f) / f, k = ease(p);
    return { transform: `translate(${(dx * k).toFixed(2)} ${(-70 * k).toFixed(2)}) ${scaleAt(1 - .7 * k, cx, cy)}`, opacity: p < .15 ? ease(p / .15) : 1 - ease((p - .15) / .85) };
  }
  const once = kind === "drop", p = once ? Math.min(1, e / f) : (e % f) / f, c = once ? shake : (x: number) => x, k = c(p);
  return { transform: `translate(${(dx * k).toFixed(2)} ${(120 * k).toFixed(2)}) rotate(${(320 * k).toFixed(1)} ${cx} ${cy})`, opacity: p < .1 ? .95 * c(p / .1) : .95 * (1 - c((p - .1) / .9)) };
}

/**
 * The Who-knocks map's marks, about their own centres: a ring knocking outwards (2.6 s, --ease, hidden in its delay), a ban's dot breathing
 * (3.6 s, --ease-io, back and forth), and the lab's slow scan ring (6 s, --ease). e < 0: still in its delay, untouched.
 */
export function mark(kind: "ring" | "breathe" | "scan", e: number, f: number, cx: number, cy: number): Frame | undefined {
  if (e < 0) return undefined;
  const n = Math.floor(e / f), p = (e - n * f) / f;
  if (kind === "breathe") { const k = easeIO(n % 2 ? 1 - p : p); return { transform: scaleAt(.82 + .26 * k, cx, cy), opacity: .72 + .28 * k }; }
  const k = ease(p);
  return kind === "ring" ? { transform: scaleAt(.6 + 1.6 * k, cx, cy), opacity: .9 * (1 - k) } : { transform: scaleAt(.05 + .95 * k, cx, cy), opacity: .5 * (1 - k) };
}

/**
 * The shared clock: one requestAnimationFrame for every scene on the page, ticking at 30 Hz, so the forest and the map
 * repaint in the same frame. A scene subscribes while it runs.
 *
 * It waits for the page to settle: the load event, then the last deferred module slice (lib/later.ts), then one idle
 * callback (at most 1.5 s). Until then every scene stays in the rest pose its markup draws, so loading work and motion
 * never compete for the main thread; the first frame looks the same, only still.
 */
const scenes = new Set<(now: number) => void>();
let raf = 0, last = 0, settled = false;
const tick = (now: number) => {
  raf = scenes.size ? requestAnimationFrame(tick) : 0;
  // the motion is slow, so 30 updates a second read as smooth; repainting at 60 would double the cost for nothing
  if (now - last < 30) return;
  last = now;
  for (const f of scenes) f(now);
};
const wake = () => { if (settled && scenes.size && !raf) raf = requestAnimationFrame(tick); };
const join = (f: (now: number) => void) => { scenes.add(f); wake(); };
if (typeof window !== "undefined") {
  const loaded = document.readyState === "complete" ? Promise.resolve() : new Promise(r => addEventListener("load", r, { once: true }));
  const idle = () => new Promise<void>(r => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 1)));
  void loaded.then(drained).then(idle).then(() => { settled = true; wake(); });
}
/** how far the motion has faded in, 0 to 1 over FADE ms from when a scene starts (or restarts) moving */
const FADE = 1000;
const fadeIn = (ms: number) => { const p = Math.min(1, Math.max(0, ms / FADE)); return p * p * (3 - 2 * p); };
const leave = (f: (now: number) => void) => { scenes.delete(f); };

type Part = { el: SVGGraphicsElement; kind: string; x: number; ox: number; oy: number; amp: number; ph: number; f: number; born: number };
const n = (v: string | undefined, d = 0) => (v === undefined ? d : Number(v));
/** what a paused element shows: the streak, the knock and scan rings and the sparks are hidden until the clock runs */
const HOLD: Record<string, [string, string]> = { streak: ["opacity", "0"], scan: ["stroke-opacity", "0"], ring: ["stroke-opacity", "0"], fall: ["fill-opacity", "0"], rise: ["fill-opacity", "0"], drop: ["fill-opacity", "0"] };

/**
 * Svelte action on a scene svg (the forest, the knock map): the shared 30 Hz clock drives every element marked data-wind,
 * writing a transform and an opacity per element (never layout). It stops when `on` is false (reduced motion), when the tab
 * is hidden and while the svg is scrolled out of view. `key` changes when the scene's elements change; they are collected
 * again on the next tick, once the DOM has them.
 *   data-wind="pivot"   rotate around (data-ox, data-oy) by data-amp degrees per unit of wind at data-x, plus a slow own sway
 *   data-wind="flutter" a leaf cluster's small own circle, livelier in a gust
 *   data-wind="grass"   a run of blades skewed from the ground line
 *   data-wind="streak"  a faint streak riding the gust front
 *   data-wind="mote"    a drifting mote carried by the breeze
 *   data-wind="root"    a root that grows and shrinks over data-f seconds (stroke-dashoffset on a pathLength 1 path)
 *   data-wind="ghost"   the dormant tree's slow breath (opacity)
 *   data-wind="fall"    a leaf falling from a struggling branch, and "rise" an ember rising from it: data-f s cycles after
 *                       data-ph s, drifting data-amp sideways, about their centre (data-ox, data-oy)
 *   data-wind="drop"    the leaf a restart shakes loose: one fall of data-f s from the moment it appears
 *   data-wind="ring" | "breathe" | "scan"  the knock map's marks: data-f s cycles after data-ph s, about (data-ox, data-oy)
 * Opacity is fill-opacity or stroke-opacity on a single shape, which needs no transparency layer.
 */
export function windy(svg: SVGSVGElement, p: { on: boolean; key: unknown }) {
  let parts: Part[] = [], on = p.on, seen = true, dirty = true, running = false;
  let start = 0; // when this scene's clock began: its first tick, and again after every pause
  const born = new WeakMap<Element, number>();
  const collect = (now: number) => {
    dirty = false;
    parts = [...svg.querySelectorAll<SVGGraphicsElement>("[data-wind]")].map(el => {
      const d = el.dataset;
      if (!born.has(el)) born.set(el, now);
      return { el, kind: d.wind!, x: n(d.x), ox: n(d.ox), oy: n(d.oy), amp: n(d.amp, 1), ph: n(d.ph), f: n(d.f, 1), born: born.get(el)! };
    });
  };
  /** back to the rest pose the markup draws: a mote returns to its starting point rather than the scene's corner */
  const still = () => {
    if (dirty) collect(performance.now());
    for (const q of parts) {
      for (const a of ["transform", "fill-opacity", "stroke-opacity"]) q.el.removeAttribute(a);
      q.el.style.removeProperty("stroke-dashoffset"); q.el.style.removeProperty("opacity");
      const h = HOLD[q.kind];
      if (h?.[0] === "opacity") q.el.style.opacity = h[1]; else if (h) q.el.setAttribute(h[0], h[1]);
      if (q.kind === "mote") q.el.setAttribute("transform", `translate(${q.ox - 50} ${q.oy})`);
    }
  };
  // a: the fade-in, from the rest pose (0) to full motion (1); opacities and offsets scale by it, so nothing jumps
  let a = 1;
  // an element that is and stays invisible is not touched: a spark between cycles, a ring in its delay
  const put = (el: Element, f: Frame | undefined, attr: string, fade = true) => {
    if (!f) return;
    const o = (fade ? f.opacity * a : f.opacity).toFixed(3);
    if (o === "0.000" && el.getAttribute(attr) === "0.000") return;
    el.setAttribute("transform", f.transform); el.setAttribute(attr, o);
  };
  /** a breathing dot rests at full size and strength, so it eases from there into its breath */
  const settle = (f: Frame | undefined): Frame | undefined => {
    if (!f || a === 1) return f;
    const k = Number(/scale\(([\d.]+)\)/.exec(f.transform)?.[1] ?? 1);
    return { transform: f.transform.replace(/scale\([\d.]+\)/, `scale(${(1 + (k - 1) * a).toFixed(4)})`), opacity: 1 + (f.opacity - 1) * a };
  };
  const frame = (now: number) => {
    if (dirty) collect(now);
    if (!start) start = now;
    a = fadeIn(now - start);
    const t = (now - start) / 1000 + 4; // start just before the first gust
    for (const q of parts) {
      switch (q.kind) {
        case "pivot": {
          const r = a * q.amp * (wind(q.x, t) + .3 * Math.sin(t * .9 * q.f + q.ph));
          q.el.setAttribute("transform", `rotate(${r.toFixed(3)} ${q.ox} ${q.oy})`); break;
        }
        case "flutter": {
          const g = .6 + Math.max(0, wind(q.x, t)) * 1.4, w = t * 2.1 * q.f + q.ph;
          q.el.setAttribute("transform", `translate(${(a * (Math.sin(w) * 1.3 * g + wind(q.x, t) * 1.6)).toFixed(2)} ${(a * Math.cos(w * 1.3) * .9 * g).toFixed(2)})`); break;
        }
        case "grass": {
          const k = Math.tan(a * (wind(q.x, t) * 7 + Math.sin(t * 2.4 + q.ph) * 1.2) * Math.PI / 180);
          q.el.setAttribute("transform", `matrix(1 0 ${k.toFixed(4)} 1 ${(-k * 300).toFixed(2)} 0)`); break;
        }
        case "streak": {
          // ride the latest gust's front, a little ahead of it, fading in and out across the scene
          const k = Math.floor((t - 3) / GUST_EVERY), x = gustX(k, t) + q.ox, life = (x + 200) / 1600;
          const o = life > 0 && life < 1 ? Math.sin(life * Math.PI) * gustAt(k).strength * q.amp : 0;
          const v = (o * a).toFixed(3);
          if (v === "0.000" && q.el.style.opacity === "0") break; // between gusts the streak stays hidden and untouched
          q.el.setAttribute("transform", `translate(${x.toFixed(1)} ${q.oy})`); q.el.style.opacity = v === "0.000" ? "0" : v; break;
        }
        case "root": {
          const b = .5 - .5 * Math.cos(2 * Math.PI * t / q.f + q.ph);
          q.el.style.strokeDashoffset = (a * (.04 + .46 * b)).toFixed(3); break;
        }
        case "fall": case "rise": put(q.el, spark(q.kind, t - 4 - q.ph, q.f, q.amp, q.ox, q.oy), "fill-opacity"); break;
        case "drop": put(q.el, spark("drop", (now - q.born) / 1000, q.f, q.amp, q.ox, q.oy), "fill-opacity"); break;
        case "ring": case "scan": put(q.el, mark(q.kind, t - 4 - q.ph, q.f, q.ox, q.oy), "stroke-opacity"); break;
        case "breathe": put(q.el, settle(mark("breathe", t - 4 - q.ph, q.f, q.ox, q.oy)), "fill-opacity", false); break;
        // the dormant tree rests at its CSS .55 and eases into its breath
        case "ghost": q.el.style.opacity = (.55 + a * (.47 + .15 * Math.sin(2 * Math.PI * t / 9 + q.ph) - .55)).toFixed(3); break;
        case "mote": {
          const x = ((q.ox + t * 9 * q.f) % 1300) - 50, y = q.oy + Math.sin(t * .7 * q.f + q.ph) * 10;
          const rx = q.ox - 50; // where the markup draws it
          q.el.setAttribute("transform", `translate(${(rx + a * (x + wind(x, t) * 22 - rx)).toFixed(1)} ${(q.oy + a * (y - q.oy)).toFixed(1)})`); break;
        }
      }
    }
  };
  const run = () => {
    const go = on && seen && !document.hidden;
    if (go && !running) join(frame);
    if (!go) { leave(frame); still(); start = 0; }
    running = go;
  };
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver(([e]) => { seen = !!e?.isIntersecting; run(); }) : undefined;
  io?.observe(svg);
  document.addEventListener("visibilitychange", run);
  run();
  return {
    update(next: { on: boolean; key: unknown }) { on = next.on; dirty = true; run(); },
    destroy() { leave(frame); io?.disconnect(); document.removeEventListener("visibilitychange", run); },
  };
}
