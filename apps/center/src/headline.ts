import { ServerIdSchema, type ActionRefSchema, type CenterState, type Entity, type ServerId } from "@hetops-control/contracts";
import type { z } from "zod";

export type ActionRef = z.infer<typeof ActionRefSchema>;
export type Need = { entity: string; server: ServerId; text: string; detail: string; action?: ActionRef };
export type Headline = { title: string; emphasis?: string; detail: string; needs: Need[] };

const hhmm = (iso: unknown) => typeof iso === "string" && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString().slice(11, 16) : undefined;
const times = (n: number) => n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
const things = (n: number, one: string, many: string) => `${n} ${n === 1 ? `thing ${one}` : `things ${many}`}`;

function detailOf(e: Entity): string {
  const n = Number(e.facts.restarts24h?.value ?? 0);
  if (n > 0) { const at = hhmm(e.facts.lastRestartAt?.value); return `${e.name} restarted ${times(n)}${at ? ` at ${at}` : ""}`; }
  return `${e.name} ${e.statusReason ?? e.status}`;
}

export function headline(s: CenterState): Headline {
  const servers = ServerIdSchema.options;
  // a server that was connected and went silent; "not connected yet" (staging in stage 1) is neither a need nor a headline
  const lost = servers.filter(id => !s.servers[id].reachable && s.servers[id].statusReason?.startsWith("agent unreachable"));
  const bad = s.entities.filter(e => (e.status === "down" || e.status === "attention") && e.kind !== "server" && e.kind !== "cluster")
    .sort((a, b) => Number(b.status === "down") - Number(a.status === "down") || Date.parse(b.observedAt) - Date.parse(a.observedAt));
  // a reachable server that is attention/down only by roll-up (stale readings) still gets one line
  const rolled = servers.filter(id => s.servers[id].reachable && ["attention", "down"].includes(s.servers[id].status) && !bad.some(e => e.server === id));
  const items = [
    ...bad.map(e => ({ down: e.status === "down", need: { entity: e.id, server: e.server, text: `${e.name} on ${e.server}`, detail: detailOf(e), ...(e.actions[0] ? { action: e.actions[0] } : {}) } as Need })),
    ...rolled.map(id => ({ down: s.servers[id].status === "down", need: { entity: id, server: id, text: `${id} needs a look`, detail: s.servers[id].statusReason ?? s.servers[id].status } as Need })),
  ];
  const needs = [...lost.map(id => ({ entity: id, server: id, text: `We can't see ${id}`, detail: `agent silent since ${hhmm(s.servers[id].since) ?? "?"}` } as Need)), ...items.map(i => i.need)];
  const top = items.slice(0, 2).map(i => `${i.need.detail}.`);
  const detail = top.length ? top.join(" ") : lost.length ? lost.map(id => `${id} is not reporting.`).join(" ") : "Every server is reporting.";
  const downN = items.filter(i => i.down).length;
  if (lost.length) return { title: `We can't see ${lost.join(" and ")}.`, emphasis: `Its agent has been silent since ${hhmm(s.servers[lost[0]!].since) ?? "?"}.`, detail, needs };
  if (downN) return { title: "Something is down.", emphasis: `${things(downN, "needs", "need")} you now.`, detail, needs };
  if (items.length) return { title: "The estate is healthy.", emphasis: `${things(items.length, "is", "are")} waiting on you.`, detail, needs };
  return { title: "The estate is healthy.", detail, needs };
}
