import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Entity, ServerId, Status } from "@hetops-control/contracts";
import type { Source } from "../registry.js";

// Bedrock's nightly drift check (hetops-k8s-lab bedrock/roles/drift/files/bedrock-drift) runs on the lab for the whole fleet and
// writes one file per inventory host: "clean" or "drift". The file's mtime is when that host was last checked.
export interface BedrockReader { hosts(): Promise<{ host: string; state: string; at: number }[]> }

export const realBedrock = (dir: string): BedrockReader => ({
  hosts: async () => Promise.all((await readdir(dir)).map(async host => {
    const f = join(dir, host);
    return { host, state: (await readFile(f, "utf8")).trim(), at: (await stat(f)).mtimeMs };
  })),
});

// the inventory's host names (bedrock/inventory.ini) and the server each one is
const HOSTS: [string, ServerId][] = [["my-workspace", "lab"], ["vm2", "staging"], ["hetops-3", "ops"]];
const HOUR = 3600_000, STALE_H = 26;   // the timer runs daily at 02:30 UTC, plus slack

/** One check per server, all reported by the lab agent (an agent reports its own server only), so staging's drift shows without an agent there. */
export function bedrockSource(api: BedrockReader): Source {
  return {
    id: "bedrock", periodMs: 5 * 60_000,
    async collect({ server, now }) {
      const t = now().getTime(), observedAt = now().toISOString();
      const files = new Map((await api.hosts()).map(h => [h.host, h]));
      const entities = HOSTS.map(([host, of]): Entity => {
        const f = files.get(host), facts: Entity["facts"] = { host: { value: of }, hostname: { value: host } };
        let status: Status = "ok", statusReason: string | undefined;
        if (!f) { status = "unknown"; statusReason = "no drift check on record"; }
        else {
          const age = (t - f.at) / HOUR;
          facts.lastRun = { value: new Date(f.at).toISOString() }; facts.ageHours = { value: Math.round(age * 10) / 10, unit: "h" };
          if (f.state !== "clean" && f.state !== "drift") { status = "unknown"; statusReason = `unreadable drift state "${f.state.slice(0, 20)}"`; }
          else if (age > STALE_H) { status = "unknown"; statusReason = `no drift check for ${Math.floor(age)} h`; }
          // drift: ok here, the center's rule raises it (apps/center/src/rules.ts); a stale result is not reported as clean
          else facts.drift = { value: f.state === "drift" };
        }
        return { id: `${server}/check/bedrock-${of}`, kind: "check", server, name: `Bedrock drift: ${of}`, status,
          ...(statusReason ? { statusReason } : {}), facts, links: [], actions: [], observedAt };
      });
      return { entities };
    },
  };
}
