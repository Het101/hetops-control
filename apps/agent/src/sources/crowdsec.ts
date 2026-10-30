import { readFileSync } from "node:fs";
import { request } from "node:https";
import type { Entity, Series } from "@hetops-control/contracts";
import type { Source } from "../registry.js";

// CrowdSec LAPI's bouncer API, shaped as recorded (test/fixtures/crowdsec-decisions.json): null when there are none, and
// a decision carries the time left ("duration"), not an end time or a country.
export interface CrowdsecReader { decisions(): Promise<any[] | null> }

/**
 * The LAPI speaks TLS with a certificate from its own cert-manager CA (the CA file is mounted), so this one call uses node:https
 * (fetch takes no CA). The bouncer key is read on every call (a rotated secret is picked up) and only goes into X-Api-Key;
 * errors name the status, never a body or a header.
 */
export function realCrowdsec(base: string, keyFile: string, caFile: string): CrowdsecReader {
  return {
    decisions: () => new Promise((resolve, reject) => {
      const req = request(`${base}/v1/decisions`, { ca: readFileSync(caFile), headers: { "x-api-key": readFileSync(keyFile, "utf8").trim() }, timeout: 10_000 }, res => {
        let body = "";
        res.setEncoding("utf8").on("data", c => { body += c; }).on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`GET /v1/decisions: HTTP ${res.statusCode}`));
          try { resolve(JSON.parse(body)); } catch { reject(new Error("GET /v1/decisions: not JSON")); }
        });
      });
      req.on("timeout", () => req.destroy(new Error("GET /v1/decisions: timed out"))).on("error", reject).end();
    }),
  };
}

const HOUR = 3600_000, UNITS: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 1e-3, us: 1e-6, "µs": 1e-6, ns: 1e-9 };
/** Go's time.Duration text ("1h29m59s", "2m59.5s", "-3s") in whole seconds, never below 0 */
export function seconds(d: unknown): number | undefined {
  const m = typeof d === "string" ? [...d.matchAll(/(\d+(?:\.\d+)?)(ms|us|µs|ns|h|m|s)/g)] : [];
  if (!m.length) return undefined;
  return String(d).startsWith("-") ? 0 : Math.round(m.reduce((t, [, n, u]) => t + Number(n) * UNITS[u!]!, 0));
}
/** what the owner sees of an address: an IPv4 /24 or an IPv6 /48, never the visitor's own address */
export function mask(scope: string, value: string): string {
  const v4 = /^(\d+\.\d+\.\d+)\.\d+(?:\/(\d+))?$/.exec(value);
  if (v4) return v4[2] && Number(v4[2]) <= 24 ? value : `${v4[1]}.0/24`;
  if (value.includes(":")) {
    const [ip, bits] = value.split("/"); if (bits && Number(bits) <= 48) return value;
    const groups = ip!.split("::")[0]!.split(":").filter(Boolean);
    return `${[...groups, "0", "0", "0"].slice(0, 3).join(":")}::/48`;
  }
  return scope.toLowerCase() === "ip" || scope.toLowerCase() === "range" ? "hidden" : value;   // a Country or AS decision is not personal
}

const MAX = 200;   // ponytail: the newest 200 decisions as entities (the Cloudflare rule holds 200 too); counts stay exact in the series

export function crowdsecSource(api: CrowdsecReader): Source {
  // decision id -> when this agent first saw a ban; the LAPI only knows the time left, so a new ban is dated by its first sight
  // (after an agent restart, the bans still active count in the hour of the restart)
  const firstSeen = new Map<number, number>();
  return {
    id: "crowdsec", periodMs: 60_000,
    async collect({ server, now }) {
      const t = now().getTime(), observedAt = now().toISOString();
      const list = (await api.decisions()) ?? [];
      if (!Array.isArray(list)) throw new Error("decisions is not a list");
      const live = new Set<number>();
      for (const d of list) if (Number.isInteger(d?.id) && d.type === "ban") { live.add(d.id); if (!firstSeen.has(d.id)) firstSeen.set(d.id, t); }
      for (const [id, at] of firstSeen) if (t - at > 25 * HOUR && !live.has(id)) firstSeen.delete(id);
      const entities = list.filter(d => Number.isInteger(d?.id)).sort((a, b) => b.id - a.id).slice(0, MAX).map((d): Entity => {
        const scope = String(d.scope ?? ""), shown = mask(scope, String(d.value ?? "")), left = seconds(d.duration);
        const facts: Entity["facts"] = { ip: { value: shown }, scope: { value: scope }, type: { value: String(d.type ?? "") },
          scenario: { value: String(d.scenario ?? "") }, origin: { value: String(d.origin ?? "") } };
        if (scope.toLowerCase() === "country") facts.country = { value: String(d.value) };
        if (left !== undefined) { facts.expiresIn = { value: left, unit: "s" }; facts.until = { value: new Date(t + left * 1000).toISOString() }; }
        return { id: `${server}/decision/${d.id}`, kind: "decision", server, name: shown, status: "ok", facts, links: [], actions: [], observedAt };
      });
      const end = Math.floor(t / HOUR) * HOUR, counts = new Map<number, number>();
      for (const at of firstSeen.values()) { const h = Math.floor(at / HOUR) * HOUR; counts.set(h, (counts.get(h) ?? 0) + 1); }
      const series: Series = { id: `${server}/crowdsec/bans`, server, label: "New bans per hour", unit: "bans", stepMs: HOUR, observedAt,
        points: Array.from({ length: 24 }, (_, i): [number, number] => { const h = end - (23 - i) * HOUR; return [h, counts.get(h) ?? 0]; }) };
      return { entities, series: [series] };
    },
  };
}
