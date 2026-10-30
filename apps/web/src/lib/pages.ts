import type { Entity, Event, Series, ServerId, Status } from "@hetops-control/contracts";
import type { State } from "./api.js";

/** Data shaping for the Timeline, Alerts, Apps, Backups and Security pages; pure, so it is unit-tested. */

type Facts = { facts: Record<string, { value: unknown }> } | undefined;
export const str = (e: Facts, key: string): string | undefined => { const v = e?.facts[key]?.value; return typeof v === "string" && v ? v : undefined; };
export const time = (e: Facts, key: string): number | undefined => { const v = str(e, key); const t = v ? Date.parse(v) : NaN; return Number.isNaN(t) ? undefined : t; };
/** attention and down are the only states that need the owner (ember) */
export const needsYou = (s: Status | undefined) => s === "attention" || s === "down";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** "45 s", "12 min", "3 h 12 min", "2 d 4 h" */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return m ? `${h} h ${m} min` : `${h} h`; }
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return h ? `${d} d ${h} h` : `${d} d`;
}
export const ago = (at: string | number, now: number) => `${span(now - (typeof at === "number" ? at : Date.parse(at)))} ago`;
export const hhmm = (at: string | number) => new Date(at).toISOString().slice(11, 16);

/** case-insensitive substring over any of the fields */
export const matches = (q: string, ...fields: (string | undefined)[]) => { const n = q.trim().toLowerCase(); return !n || fields.some(f => f?.toLowerCase().includes(n)); };
/** distinct values with their counts, most common first */
export function facets<T>(items: T[], key: (x: T) => string): { v: string; n: number }[] {
  const m = new Map<string, number>(); for (const x of items) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m].map(([v, n]) => ({ v, n })).sort((a, b) => b.n - a.n || a.v.localeCompare(b.v));
}
/** an empty selection is "all" */
export const picked = (sel: string[], v: string) => !sel.length || sel.includes(v);

/** Which servers report a source, and which of them fail it (the page says "can't read" rather than show stale numbers). */
export function sourceState(state: State | undefined, id: string) {
  const out = { reporting: [] as ServerId[], failing: [] as { server: ServerId; error: string }[] };
  if (!state) return out;
  for (const [server, v] of Object.entries(state.servers) as [ServerId, State["servers"][ServerId]][]) {
    const x = v.sources?.find(s => s.id === id), f = v.failingSources?.find(s => s.id === id);
    if (x) out.reporting.push(server);
    if (f || (x && !x.ok && (x.error || x.lastRunAt))) out.failing.push({ server, error: f?.error ?? x?.error ?? "failing" });
  }
  return out;
}

/* ---------- Timeline ---------- */
export const levelOf = (e: Event) => e.level ?? "none";
export const hotEvent = (e: Event) => needsYou(e.level);
export type EventFilter = { server: string[]; kind: string[]; source: string[]; level: string[]; q: string; day?: string; hour?: number };
export const keyOf = (e: Event) => `${e.at}|${e.server}|${e.summary}|${e.entity ?? ""}`;
export function filterEvents(events: Event[], f: EventFilter): Event[] {
  return events.filter(e => picked(f.server, e.server) && picked(f.kind, e.kind) && picked(f.source, e.source) && picked(f.level, levelOf(e))
    && (!f.day || e.at.startsWith(f.day)) && (f.hour === undefined || Number(e.at.slice(11, 13)) === f.hour)
    && matches(f.q, e.summary, e.entity, e.actor, e.source, e.server));
}
/** the UTC days that have events, newest first */
export const eventDays = (events: Event[]) => [...new Set(events.map(e => e.at.slice(0, 10)))].sort().reverse();
/** 24 hourly buckets of one UTC day: all events, and the ones that went to attention or down */
export function hourly(events: Event[], day: string): { hour: number; n: number; hot: number }[] {
  const b = Array.from({ length: 24 }, (_, hour) => ({ hour, n: 0, hot: 0 }));
  for (const e of events) if (e.at.startsWith(day)) { const x = b[Number(e.at.slice(11, 13))]!; x.n++; if (hotEvent(e)) x.hot++; }
  return b;
}
/** events (newest first) grouped by their UTC hour, in order */
export function byHour(events: Event[]): { key: string; day: string; label: string; events: Event[] }[] {
  const out: { key: string; day: string; label: string; events: Event[] }[] = [];
  for (const e of events) {
    const key = e.at.slice(0, 13);
    if (out.at(-1)?.key !== key) out.push({ key, day: e.at.slice(0, 10), label: `${e.at.slice(11, 13)}:00`, events: [] });
    out.at(-1)!.events.push(e);
  }
  return out;
}

/* ---------- Alerts ---------- */
export const SEVERITIES = ["critical", "warning", "info"] as const;
export type Severity = typeof SEVERITIES[number];
export type Alarm = { entity: Entity; severity: Severity; detail: string; since?: number; source: string };
/**
 * Everything firing: Alertmanager alerts (firing > 0) by their severity, plus checks and sites that fail (down is critical,
 * attention a warning) or that cannot be read (info: never healthy when blind). `since` is the alert's own start, else when
 * the event log saw the entity move to its current status. Most severe first, then the longest firing.
 */
export function alarms(entities: Entity[], events: Event[]): Alarm[] {
  const out: Alarm[] = [];
  const movedAt = (e: Entity) => { const ev = events.find(x => x.entity === e.id && x.kind === "status" && x.level === e.status); return ev ? Date.parse(ev.at) : undefined; };
  for (const e of entities) {
    if (e.kind === "alert") {
      const firing = e.facts.firing?.value; if (typeof firing === "number" && firing <= 0) continue;
      const sev = str(e, "severity"), severity: Severity = sev === "critical" || sev === "warning" ? sev : "info";
      out.push({ entity: e, severity, detail: str(e, "summary") ?? e.statusReason ?? "", since: time(e, "since") ?? movedAt(e), source: e.source ?? "alertmanager" });
    } else if ((e.kind === "check" || e.kind === "site") && e.status !== "ok") {
      const severity: Severity = e.status === "down" ? "critical" : e.status === "attention" ? "warning" : "info";
      out.push({ entity: e, severity, detail: e.statusReason ?? e.status, since: movedAt(e), source: e.source ?? e.kind });
    }
  }
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  return out.sort((a, b) => rank(a.severity) - rank(b.severity) || (a.since ?? Infinity) - (b.since ?? Infinity) || a.entity.name.localeCompare(b.entity.name));
}

/* ---------- Apps ---------- */
/** pod pips for a workload: ready ones, then the missing ones; capped, with the rest as +N */
export function pips(ready: number, desired: number, cap = 10): { pips: ("up" | "missing")[]; more: number } {
  const total = Math.max(ready, desired, 0), shown = Math.min(total, cap);
  return { pips: Array.from({ length: shown }, (_, i) => (i < ready ? "up" : "missing")), more: total - shown };
}
export function serverApps(entities: Entity[], server: ServerId) {
  const apps = entities.filter(e => e.server === server && e.kind === "app" && e.source !== "coolify");
  const argo = entities.filter(e => e.server === server && e.kind === "argo-app");
  const n = (e: Entity, k: string) => { const v = e.facts[k]?.value; return typeof v === "number" ? v : 0; };
  return { apps: apps.length, ready: apps.reduce((s, e) => s + n(e, "pods"), 0), desired: apps.reduce((s, e) => s + Math.max(n(e, "podsDesired"), n(e, "pods")), 0),
    restarts: apps.reduce((s, e) => s + n(e, "restarts24h"), 0), argo: argo.length, synced: argo.filter(e => str(e, "sync") === "Synced" && str(e, "health") === "Healthy").length,
    needs: [...apps, ...argo].filter(e => needsYou(e.status)).length };
}

/* ---------- Backups ---------- */
export const BACKUP_WINDOW_H = 26;
/** age against the 26 h window (1 = due), the next run countdown, and whether the last run failed after the last success */
export function backupView(e: Entity, now: number) {
  const ok = time(e, "lastOk"), bad = time(e, "lastFailure"), next = time(e, "nextRun");
  const ageH = ok === undefined ? undefined : (now - ok) / HOUR;
  return { ok, bad, next, ageH, frac: ageH === undefined ? 1 : Math.min(ageH / BACKUP_WINDOW_H, 1), overdue: ageH === undefined || ageH > BACKUP_WINDOW_H,
    failedLast: bad !== undefined && (ok === undefined || bad > ok), nextIn: next === undefined ? undefined : next - now };
}
export const countdown = (ms: number | undefined) => ms === undefined ? "not scheduled" : ms <= 0 ? `due ${span(-ms)} ago` : `in ${span(ms)}`;

/* ---------- Security ---------- */
/** The mock's land boxes ([lon from, lon to, lat from, lat to]) and projection: a dotted world, not a geography lesson. */
const LAND = [[-170, -50, 15, 72], [-82, -34, -56, 13], [-18, 52, -35, 37], [-10, 40, 36, 71], [40, 150, 5, 75], [95, 155, -45, -10], [68, 90, 6, 30]] as const;
export const project = (lon: number, lat: number, w: number, h: number): [number, number] => [Math.round((lon + 180) / 360 * w * 10) / 10, Math.round((80 - lat) / 140 * h * 10) / 10];
export function landDots(w: number, h: number, step = 6) {
  const out: [number, number][] = [];
  for (let la = 75; la >= -55; la -= step) for (let lo = -175; lo <= 175; lo += step)
    if (LAND.some(([a, b, c, d]) => lo >= a && lo <= b && la >= c && la <= d)) out.push(project(lo, la, w, h));
  return out;
}
/** where the lab sits on the map (as in the mock) */
export const LAB_AT: [number, number] = [72.9, 19.1];
/** approximate centroids [lon, lat] by ISO 3166 alpha-2; a country not listed is counted, not placed */
export const COUNTRY: Record<string, [number, number]> = {
  US: [-98, 39], CA: [-106, 56], MX: [-102, 23], BR: [-52, -10], AR: [-64, -34], CL: [-71, -30], CO: [-74, 4], PE: [-75, -9], VE: [-66, 7],
  GB: [-2, 54], IE: [-8, 53], FR: [2, 46], DE: [10, 51], NL: [5.3, 52.1], BE: [4.5, 50.5], LU: [6.1, 49.8], CH: [8.2, 46.8], AT: [14.5, 47.5],
  IT: [12.5, 42.8], ES: [-3.7, 40.4], PT: [-8, 39.5], SE: [15, 62], NO: [9, 61], FI: [26, 64], DK: [10, 56], PL: [19, 52], CZ: [15.5, 49.8],
  RO: [25, 46], BG: [25.5, 42.7], HU: [19.5, 47.2], GR: [22, 39], UA: [31, 49], BY: [28, 53.5], RU: [37.6, 55.7], TR: [35, 39], LT: [24, 55.2],
  LV: [25, 57], EE: [25, 58.7], MD: [28.5, 47], RS: [21, 44], HR: [16, 45.2], SK: [19.5, 48.7], SI: [15, 46.1],
  CN: [104, 35], HK: [114.2, 22.3], TW: [121, 23.7], JP: [139.7, 35.7], KR: [127.8, 36.5], KP: [127, 40], IN: [78, 22], PK: [69, 30], BD: [90, 24],
  VN: [106, 16], TH: [101, 15], MY: [102, 4], SG: [103.8, 1.35], ID: [113, -1], PH: [122, 12], KH: [105, 12.5], MM: [96, 21], NP: [84, 28],
  LK: [80.7, 7.9], IR: [53, 32], IQ: [44, 33], SA: [45, 24], AE: [54, 24], IL: [35, 31.5], KZ: [67, 48], UZ: [64, 41], MN: [104, 46],
  AU: [134, -25], NZ: [174, -41], ZA: [24, -29], NG: [8, 9.5], EG: [30, 27], KE: [38, 0.5], MA: [-7, 32], DZ: [3, 28], TN: [9.5, 34], GH: [-1, 8],
};
export type Knock = { country: string; n: number; x: number; y: number };
/** CrowdSec decisions per country, placed on a w×h map; the ones without a known country are counted apart */
export function knocks(decisions: Entity[], w: number, h: number): { placed: Knock[]; unplaced: number } {
  const placed: Knock[] = []; let unplaced = 0;
  for (const { v, n } of facets(decisions, d => (str(d, "country") ?? "").toUpperCase())) {
    const at = COUNTRY[v];
    if (!at) { unplaced += n; continue; }
    const [x, y] = project(at[0], at[1], w, h); placed.push({ country: v, n, x, y });
  }
  return { placed, unplaced };
}

/* ---------- series ---------- */
/**
 * An area chart of a series as path segments: a gap longer than 1.5 steps breaks the line (the gap stays visible, never
 * bridged), and the x axis spans [from, to]. Returns the segments' area and line paths and the largest value.
 */
export function areas(s: Series, w: number, h: number, from: number, to: number, max?: number) {
  const pts = s.points.filter(([t]) => t >= from && t <= to);
  const top = max ?? Math.max(1, ...pts.map(p => p[1]));
  const X = (t: number) => Math.round((t - from) / Math.max(to - from, 1) * w * 10) / 10, Y = (v: number) => Math.round((h - v / top * (h - 4)) * 10) / 10;
  const segs: [number, number][][] = [];
  for (const p of pts) { const last = segs.at(-1)?.at(-1); if (!last || p[0] - last[0] > s.stepMs * 1.5) segs.push([]); segs.at(-1)!.push(p); }
  return { top, segments: segs.map(seg => {
    const line = seg.map(([t, v], i) => `${i ? "L" : "M"}${X(t)} ${Y(v)}`).join(" ");
    return { line, area: `${line} L${X(seg.at(-1)![0])} ${h} L${X(seg[0]![0])} ${h} Z` };
  }), gaps: segs.slice(1).map((seg, i) => [X(segs[i]!.at(-1)![0]), X(seg[0]![0])] as [number, number]) };
}
export const sumSeries = (s: Series | undefined, from: number) => (s?.points ?? []).reduce((n, [t, v]) => (t >= from ? n + v : n), 0);
export { DAY, HOUR };
