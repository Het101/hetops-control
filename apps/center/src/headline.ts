import { ServerIdSchema, type CenterState, type Entity, type Headline, type Need, type ServerId } from "@hetops-control/contracts";

export type { Headline, Need };

// every time is UTC and says so
const hhmm = (iso: unknown) => typeof iso === "string" && !Number.isNaN(Date.parse(iso)) ? `${new Date(iso).toISOString().slice(11, 16)} UTC` : "an unknown time";
const times = (n: number) => n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
const things = (n: number, one: string, many: string) => `${n} ${n === 1 ? `thing ${one}` : `things ${many}`}`;

function detailOf(e: Entity): string {
  const n = Number(e.facts.restarts24h?.value ?? 0);
  if (n > 0) { const at = e.facts.lastRestartAt?.value; return `${e.name} restarted ${times(n)}${at ? ` at ${hhmm(at)}` : ""}`; }
  return `${e.name} ${e.statusReason ?? e.status}`;
}

const GRACE_MS = 60_000;

// sev: 3 down, 2 attention or blind (we cannot see it, which is never fine)
type Item = { sev: 2 | 3; blind: boolean; at: number; line: string; need: Need };

export function headline(s: CenterState): Headline {
  const servers = ServerIdSchema.options;
  // a server that was connected (it has an agent version) and went silent; staging "not connected yet" is neither a need nor a headline
  const lost = servers.filter(id => !s.servers[id].reachable && s.servers[id].agentVersion !== undefined);
  // configured but never connected, and past the 60 s grace after the center started (its `since`): it is blind to us, which is a need
  const never = servers.filter(id => { const v = s.servers[id]; return v.configured && !v.reachable && v.agentVersion === undefined && Date.parse(s.generatedAt) - Date.parse(v.since) >= GRACE_MS; });
  const items: Item[] = [];
  for (const e of s.entities) {
    if (e.status !== "down" && e.status !== "attention") continue;
    const detail = detailOf(e);
    items.push({ sev: e.status === "down" ? 3 : 2, blind: false, at: Date.parse(e.observedAt), line: detail,
      need: { entity: e.id, server: e.server, text: `${e.name} on ${e.server}`, detail, ...(e.actions[0] ? { action: e.actions[0] } : {}) } });
  }
  for (const id of servers) {
    const v = s.servers[id]; if (!v.reachable) continue;
    const at = Date.parse(v.since);
    for (const src of v.failingSources ?? []) {
      const text = `We can't read ${id}'s ${src.id}`; const detail = src.error ?? "the source is failing";
      items.push({ sev: 2, blind: true, at, line: `${text}: ${detail}`, need: { entity: `${id}/source/${src.id}`, server: id, text, detail } });
    }
    const covered = items.some(i => i.need.server === id);
    if (!covered && v.status === "unknown" && v.statusReason !== "starting") {
      const text = `${id} is reachable but reports nothing yet`;
      items.push({ sev: 2, blind: true, at, line: text, need: { entity: id, server: id, text, detail: v.statusReason ?? "no data" } });
    } else if (!covered && (v.status === "attention" || v.status === "down")) { // e.g. stale readings
      const text = `${id} needs a look`;
      items.push({ sev: v.status === "down" ? 3 : 2, blind: v.status === "attention", at, line: `${id}: ${v.statusReason ?? v.status}`, need: { entity: id, server: id, text, detail: v.statusReason ?? v.status } });
    }
  }
  items.sort((a, b) => b.sev - a.sev || b.at - a.at);
  const neverNeeds: Need[] = never.map(id => ({ entity: id, server: id, text: `We can't reach ${id}`,
    detail: `its agent has not answered since the center started at ${hhmm(s.servers[id].since)}${s.servers[id].lastError ? ` — ${s.servers[id].lastError}` : ""}` }));
  const needs: Need[] = [...neverNeeds, ...lost.map(id => ({ entity: id, server: id, text: `We can't see ${id}`, detail: `agent silent since ${hhmm(s.servers[id].since)}` })), ...items.map(i => i.need)];
  const top = items.slice(0, 2).map(i => `${i.line}.`);
  const gone = [...lost, ...never];
  const detail = top.length ? top.join(" ") : gone.length ? gone.map(id => `${id} is not reporting.`).join(" ") : "Every server is reporting.";
  const downN = items.filter(i => i.sev === 3).length;
  if (gone.length) return { title: `We can't see ${gone.join(" and ")}.`, emphasis: lost.length ? `Its agent has been silent since ${hhmm(s.servers[lost[0]!].since)}.` : `Its agent has not answered since the center started.`, detail, needs };
  if (downN) return { title: "Something is down.", emphasis: `${things(downN, "needs", "need")} you now.`, detail, needs };
  if (items.some(i => i.blind)) return { title: "Something can't be seen.", emphasis: `${things(items.length, "needs", "need")} you.`, detail, needs };
  if (items.length) return { title: "The estate is healthy.", emphasis: `${things(items.length, "is", "are")} waiting on you.`, detail, needs };
  return { title: "The estate is healthy.", detail, needs };
}
