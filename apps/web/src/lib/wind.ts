import { hash, rng } from "./forest.js";

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

type Part = { el: SVGGraphicsElement; kind: string; x: number; ox: number; oy: number; amp: number; ph: number; f: number };
const n = (v: string | undefined, d = 0) => (v === undefined ? d : Number(v));

/**
 * Svelte action on the forest svg: one requestAnimationFrame loop drives every element marked data-wind, writing one
 * transform attribute per group (never layout). It stops when `on` is false (reduced motion), when the tab is hidden and
 * while the forest is scrolled out of view. `key` changes when the trees are regrown, so the parts are collected again.
 *   data-wind="pivot"   rotate around (data-ox, data-oy) by data-amp degrees per unit of wind at data-x, plus a slow own sway
 *   data-wind="flutter" a leaf cluster's small own circle, livelier in a gust
 *   data-wind="grass"   a run of blades skewed from the ground line
 *   data-wind="streak"  a faint streak riding the gust front
 *   data-wind="mote"    a drifting mote carried by the breeze
 *   data-wind="root"    a root that grows and shrinks over data-f seconds (stroke-dashoffset on a pathLength 1 path)
 *   data-wind="ghost"   the dormant tree's slow breath (opacity)
 * Roots and the ghost live here rather than in CSS so the whole scene repaints at the loop's 30 Hz, not at 60.
 */
export function windy(svg: SVGSVGElement, p: { on: boolean; key: unknown }) {
  let parts: Part[] = [], raf = 0, on = p.on, seen = true, t0 = performance.now();
  const collect = () => {
    parts = [...svg.querySelectorAll<SVGGraphicsElement>("[data-wind]")].map(el => {
      const d = el.dataset;
      return { el, kind: d.wind!, x: n(d.x), ox: n(d.ox), oy: n(d.oy), amp: n(d.amp, 1), ph: n(d.ph), f: n(d.f, 1) };
    });
  };
  const still = () => {
    for (const q of parts) { q.el.removeAttribute("transform"); q.el.style.removeProperty("stroke-dashoffset"); q.el.style.removeProperty("opacity"); if (q.kind === "streak") q.el.style.opacity = "0"; }
  };
  let last = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // the wind is slow, so 30 updates a second read as smooth; repainting the forest at 60 would double its cost for nothing
    if (now - last < 30) return;
    last = now;
    const t = (now - t0) / 1000 + 4; // start just before the first gust
    for (const q of parts) {
      switch (q.kind) {
        case "pivot": {
          const a = q.amp * (wind(q.x, t) + .3 * Math.sin(t * .9 * q.f + q.ph));
          q.el.setAttribute("transform", `rotate(${a.toFixed(3)} ${q.ox} ${q.oy})`); break;
        }
        case "flutter": {
          const g = .6 + Math.max(0, wind(q.x, t)) * 1.4, w = t * 2.1 * q.f + q.ph;
          q.el.setAttribute("transform", `translate(${(Math.sin(w) * 1.3 * g + wind(q.x, t) * 1.6).toFixed(2)} ${(Math.cos(w * 1.3) * .9 * g).toFixed(2)})`); break;
        }
        case "grass": {
          const k = Math.tan((wind(q.x, t) * 7 + Math.sin(t * 2.4 + q.ph) * 1.2) * Math.PI / 180);
          q.el.setAttribute("transform", `matrix(1 0 ${k.toFixed(4)} 1 ${(-k * 300).toFixed(2)} 0)`); break;
        }
        case "streak": {
          // ride the latest gust's front, a little ahead of it, fading in and out across the scene
          const k = Math.floor((t - 3) / GUST_EVERY), x = gustX(k, t) + q.ox, life = (x + 200) / 1600;
          const o = life > 0 && life < 1 ? Math.sin(life * Math.PI) * gustAt(k).strength * q.amp : 0;
          q.el.setAttribute("transform", `translate(${x.toFixed(1)} ${q.oy})`); q.el.style.opacity = o.toFixed(3); break;
        }
        case "root": {
          const b = .5 - .5 * Math.cos(2 * Math.PI * t / q.f + q.ph);
          q.el.style.strokeDashoffset = (.04 + .46 * b).toFixed(3); break;
        }
        case "ghost": q.el.style.opacity = (.47 + .15 * Math.sin(2 * Math.PI * t / 9 + q.ph)).toFixed(3); break;
        case "mote": {
          const x = ((q.ox + t * 9 * q.f) % 1300) - 50, y = q.oy + Math.sin(t * .7 * q.f + q.ph) * 10;
          q.el.setAttribute("transform", `translate(${(x + wind(x, t) * 22).toFixed(1)} ${y.toFixed(1)})`); break;
        }
      }
    }
  };
  const run = () => {
    cancelAnimationFrame(raf); raf = 0;
    if (on && seen && !document.hidden) raf = requestAnimationFrame(frame); else still();
  };
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver(([e]) => { seen = !!e?.isIntersecting; run(); }) : undefined;
  io?.observe(svg);
  document.addEventListener("visibilitychange", run);
  collect(); run();
  return {
    update(next: { on: boolean; key: unknown }) { on = next.on; collect(); run(); },
    destroy() { cancelAnimationFrame(raf); io?.disconnect(); document.removeEventListener("visibilitychange", run); },
  };
}
