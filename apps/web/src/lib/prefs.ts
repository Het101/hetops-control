import { writable } from "svelte/store";

/** Reduce motion: system follows the OS, on stills everything, off keeps motion even when the OS asks to reduce. */
export type Prefs = { motion: "system" | "on" | "off"; density: "comfortable" | "compact" };
const KEY = "hetops-control.prefs";

/** Anything unreadable falls back to the defaults, one field at a time. */
export function parsePrefs(raw: string | null | undefined): Prefs {
  let p: Partial<Record<keyof Prefs, unknown>> = {};
  try { const v: unknown = JSON.parse(raw ?? "{}"); if (v && typeof v === "object") p = v; } catch { /* defaults */ }
  return { motion: p.motion === "on" || p.motion === "off" ? p.motion : "system", density: p.density === "compact" ? "compact" : "comfortable" };
}
export const reduces = (pref: Prefs["motion"], os: boolean) => pref === "system" ? os : pref === "on";

// storage can be blocked (private mode, site data off): the page still works, the choice just does not stick
const read = () => { try { return parsePrefs(localStorage.getItem(KEY)); } catch { return parsePrefs(null); } };
export const prefs = writable(read());
prefs.subscribe(p => {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* not kept */ }
  if (typeof document === "undefined") return;
  // tokens.css reads these: data-motion overrides the OS media query, data-density tightens spacing
  const d = document.documentElement.dataset;
  if (p.motion === "system") delete d.motion; else d.motion = p.motion;
  d.density = p.density;
});
