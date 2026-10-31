import type { Entity, Series } from "@hetops-control/contracts";
import { num } from "./api.js";
import { HOUR, needsYou, str } from "./pages.js";

/** Data shaping for the Sites status board; pure, so it is unit-tested. */

/** one hour of the heartbeat strip: its uptime %, or undefined when nobody watched it (drawn hollow, never up) */
export type Tick = { t: number; up?: number };
export type SiteRow = { e: Entity; host?: string; group: string; ticks: Tick[]; lat: number[]; ms?: number; pct?: number; warm: boolean };

/** the last 24 clock hours, the current one last, from the agent's <id>/uptime-1h series; hours with no point are unknown */
export function ticks(s: Series | undefined, now: number, hours = 24): Tick[] {
  const by = new Map((s?.points ?? []).map(([t, v]) => [t, v]));
  const end = Math.floor(now / HOUR) * HOUR;
  return Array.from({ length: hours }, (_, i) => { const t = end - (hours - 1 - i) * HOUR, up = by.get(t); return up === undefined ? { t } : { t, up }; });
}

/**
 * A tick's height, 0.3 to 1: a full hour is full, and an hour with down time shrinks with it, so that a 4 s blip (99.9 %) still
 * reads as a notch and a lost half hour is plainly short. Linear over the last 10 %, then held at the floor.
 */
export const tickHeight = (up: number) => (up >= 100 ? 1 : Math.max(0.3, 0.9 - (100 - up) / 10 * 0.6));

const rank = (g: string) => (g === "sites" ? 0 : 1);
/** sites as board rows: the ones that need the owner first, then by name; grouped Sites, then Products, as Gatus groups them */
export function siteRows(sites: Entity[], series: Series[], now: number): SiteRow[] {
  const s = new Map(series.map(x => [x.id, x]));
  return sites.map((e): SiteRow => {
    const lat = (s.get(`${e.id}/latency-1h`)?.points ?? []).filter(p => p[0] > now - 24 * HOUR).map(p => p[1]);
    return { e, host: str(e, "host"), group: str(e, "group") === "products" ? "products" : "sites", ticks: ticks(s.get(`${e.id}/uptime-1h`), now),
      lat, ms: num(e, "latencyMs"), pct: num(e, "uptime24h"), warm: needsYou(e.status) };
  }).sort((a, b) => rank(a.group) - rank(b.group) || Number(b.warm) - Number(a.warm) || a.e.name.localeCompare(b.e.name));
}

/** runs of consecutive hours with down time; the hour is the grain, so two blips in one hour are one incident */
export const incidents = (t: Tick[]) => t.filter((x, i) => x.up !== undefined && x.up < 100 && !(t[i - 1]?.up !== undefined && t[i - 1]!.up! < 100)).length;

/** "10/10 up · slowest Radar Cloud 212 ms · 1 incident in 24 h"; parts with nothing known are left out */
export function summary(rows: SiteRow[]): string {
  const up = rows.filter(r => r.e.status === "ok").length;
  const slow = rows.reduce<SiteRow | undefined>((m, r) => (r.ms !== undefined && (m?.ms === undefined || r.ms > m.ms) ? r : m), undefined);
  const known = rows.some(r => r.ticks.some(x => x.up !== undefined)), n = rows.reduce((k, r) => k + incidents(r.ticks), 0);
  return [`${up}/${rows.length} up`, slow ? `slowest ${slow.e.name} ${Math.round(slow.ms!)} ms` : undefined,
    known ? (n ? `${n} incident${n === 1 ? "" : "s"} in 24 h` : "no incidents in 24 h") : undefined].filter(Boolean).join(" · ");
}

/** a sparkline path through the hourly means, in a w by h box; flat when they are all equal */
export function spark(v: number[], w: number, h: number): string {
  if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  return v.map((y, i) => `${i ? "L" : "M"}${(i / (v.length - 1) * w).toFixed(1)},${(hi === lo ? h / 2 : h - 1 - (y - lo) / r * (h - 2)).toFixed(1)}`).join("");
}

export type BoardItem = { key: string; label?: string; cont?: boolean; row?: SiteRow };
const GROUPS: [string, string][] = [["sites", "SITES"], ["products", "PRODUCTS"]];
/**
 * The rows as two balanced columns, each group under its heading: split where the two sides weigh most nearly the same (a heading
 * weighs half a row), and a group that runs on into the right column repeats its heading there, so both columns start level.
 */
export function columns(rows: SiteRow[]): [BoardItem[], BoardItem[]] {
  const items: BoardItem[] = GROUPS.flatMap(([g, label]) => { const rs = rows.filter(r => r.group === g);
    return rs.length ? [{ key: g, label: `${label} · ${rs.length}` }, ...rs.map(row => ({ key: row.e.id, row }))] : []; });
  const w = (x: BoardItem) => (x.row ? 1 : 0.5), total = items.reduce((n, x) => n + w(x), 0);
  let at = 0, best = Infinity, acc = 0;
  for (let i = 0; i <= items.length; i++) {
    if (Math.abs(total - 2 * acc) < best) { best = Math.abs(total - 2 * acc); at = i; }
    if (i < items.length) acc += w(items[i]!);
  }
  const l = items.slice(0, at), r = items.slice(at);
  if (r[0]?.row) { const g = r[0].row.group; r.unshift({ key: `${g}-cont`, label: GROUPS.find(x => x[0] === g)![1], cont: true }); }
  // a heading never ends a column
  if (l.at(-1) && !l.at(-1)!.row) r.unshift(l.pop()!);
  return [l, r];
}
