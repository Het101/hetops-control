// The sky over the forest: the six Indian seasons (ritus) and the sun, from the viewer's own clock and time zone.
// Nothing here asks for a location: the time zone names a place close enough for dawn and dusk to land on the right minutes.

export type RituId = "vasanta" | "grishma" | "varsha" | "sharad" | "hemanta" | "shishira";
export type Weather = "blossom" | "haze" | "rain" | "clear" | "mist" | "frost";
export type Phase = "dawn" | "day" | "dusk" | "night";
export type Ritu = {
  id: RituId; name: string; english: string;
  /** leaf tones, light to deep; never near ember (#f2702f), which is kept for what needs you */
  leaf: [string, string, string];
  ground: string; horizon: string;
  /** how full the canopy is, 0 to 1: monsoon lush, winter sparse */
  foliage: number;
  weather: Weather;
  /** the second colour in the canopy this season: blossom, gold, or none */
  accent?: string;
};

// From mid-month to mid-month, two months each; Hemanta crosses the new year
export const RITUS: Ritu[] = [
  { id: "vasanta", name: "Vasanta", english: "spring", leaf: ["#a6cf7a", "#6bad55", "#3e7d3c"], ground: "#4a5a32", horizon: "#f2d9b0", foliage: .85, weather: "blossom", accent: "#f3cbd8" },
  { id: "grishma", name: "Grishma", english: "summer", leaf: ["#b3b56a", "#86924a", "#5b6a34"], ground: "#7d6a44", horizon: "#f6d692", foliage: .7, weather: "haze" },
  { id: "varsha", name: "Varsha", english: "monsoon", leaf: ["#4fb06a", "#2f8a4f", "#1d5a35"], ground: "#2f4a2c", horizon: "#a9bcc0", foliage: 1, weather: "rain" },
  { id: "sharad", name: "Sharad", english: "autumn", leaf: ["#86bf6a", "#4f9150", "#2f6640"], ground: "#4d5a34", horizon: "#f0cf98", foliage: .9, weather: "clear", accent: "#d8c068" },
  { id: "hemanta", name: "Hemanta", english: "early winter", leaf: ["#9eab6c", "#6f8350", "#4d5d3a"], ground: "#56563c", horizon: "#d9cbb6", foliage: .65, weather: "mist", accent: "#c7a35a" },
  { id: "shishira", name: "Shishira", english: "winter", leaf: ["#a89a6a", "#827556", "#5b5a3e"], ground: "#66625a", horizon: "#cdd6df", foliage: .35, weather: "frost" },
];
const START: [number, number, RituId][] = [[3, 15, "vasanta"], [5, 15, "grishma"], [7, 15, "varsha"], [9, 15, "sharad"], [11, 15, "hemanta"], [1, 15, "shishira"]];

export type Place = { zone: string; lat: number; lon: number };
// a handful of zones, each a point in the middle of where people in it live; anything else: longitude from the offset
const ZONES: Record<string, [number, number]> = {
  "Asia/Kolkata": [20.6, 78.9], "Asia/Calcutta": [20.6, 78.9], "Asia/Dubai": [25.2, 55.3], "Asia/Singapore": [1.35, 103.8],
  "Europe/London": [51.5, -0.1], "Europe/Berlin": [52.5, 13.4], "America/New_York": [40.7, -74], "America/Los_Angeles": [34.1, -118.2],
  "Australia/Sydney": [-33.9, 151.2], "UTC": [0, 0], "Etc/UTC": [0, 0],
};
const validZone = (z: string) => { try { new Intl.DateTimeFormat("en", { timeZone: z }); return true; } catch { return false; } };

/** Where the viewer probably is, from the browser's time zone (and its offset, in getTimezoneOffset's minutes, as a fallback) */
export function place(zone = Intl.DateTimeFormat().resolvedOptions().timeZone, offsetMin = new Date().getTimezoneOffset()): Place {
  const z = ZONES[zone];
  return z ? { zone, lat: z[0], lon: z[1] } : { zone: validZone(zone) ? zone : "UTC", lat: 20, lon: -offsetMin / 4 };
}

/** The viewer's month (1-12) and day in their own zone */
function monthDay(at: Date, p: Place): [number, number] {
  const parts = new Intl.DateTimeFormat("en", { timeZone: p.zone, month: "numeric", day: "numeric" }).formatToParts(at);
  return [Number(parts.find(x => x.type === "month")!.value), Number(parts.find(x => x.type === "day")!.value)];
}

export function ritu(at: Date, p: Place = place()): Ritu {
  const [m, d] = monthDay(at, p), md = m * 100 + d;
  const order = [...START].sort((a, b) => a[0] * 100 + a[1] - (b[0] * 100 + b[1]));   // Jan 15 Shishira first
  let id: RituId = "hemanta";   // 1 Jan to 14 Jan: still Hemanta, from the year before
  for (const [sm, sd, r] of order) if (md >= sm * 100 + sd) id = r;
  return RITUS.find(r => r.id === id)!;
}

const rad = Math.PI / 180;
/** The sun's height above the horizon in degrees (NOAA's approximation: within a fraction of a degree, plenty for a sky) */
export function sunElevation(at: Date, p: Place): number {
  const start = Date.UTC(at.getUTCFullYear(), 0, 1), n = Math.floor((at.getTime() - start) / 86_400_000) + 1;
  const hour = at.getUTCHours() + at.getUTCMinutes() / 60 + at.getUTCSeconds() / 3600;
  const g = 2 * Math.PI / 365 * (n - 1 + (hour - 12) / 24);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = ((hour * 60 + eq + 4 * p.lon) / 4 - 180) * rad;
  const cz = Math.sin(p.lat * rad) * Math.sin(decl) + Math.cos(p.lat * rad) * Math.cos(decl) * Math.cos(ha);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cz))) / rad;
}

export type Sky = { phase: Phase; elevation: number; rising: boolean; light: number; ritu: Ritu };
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Everything the scene needs from the clock: phase, the sun's height, whether it is rising, a 0-1 daylight, and the season */
export function sky(at: Date, p: Place = place()): Sky {
  const elevation = sunElevation(at, p), rising = sunElevation(new Date(at.getTime() + 600_000), p) > elevation;
  const phase: Phase = elevation < -6 ? "night" : elevation > 6 ? "day" : rising ? "dawn" : "dusk";
  return { phase, elevation, rising, light: elevation < -6 ? 0 : smooth(-6, 10, elevation), ritu: ritu(at, p) };
}

const PIN: Record<Phase, [number, boolean]> = { dawn: [2, true], day: [48, true], dusk: [2, false], night: [-32, false] };
/** A sky pinned for a preview or a test: ?ritu=varsha&phase=night; anything not named keeps the real value */
export function pinned(s: Sky, q: URLSearchParams): Sky {
  const r = RITUS.find(x => x.id === q.get("ritu")), p = q.get("phase") as Phase | null, at = p && PIN[p];
  if (!r && !at) return s;
  const [elevation, rising] = at ?? [s.elevation, s.rising];
  return { ...s, ritu: r ?? s.ritu, elevation, rising, phase: at ? p! : s.phase, light: elevation < -6 ? 0 : smooth(-6, 10, elevation) };
}
