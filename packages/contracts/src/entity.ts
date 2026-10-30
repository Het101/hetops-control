import { z } from "zod";
export const ServerIdSchema = z.enum(["lab", "staging", "ops"]);
export const StatusSchema = z.enum(["ok", "attention", "down", "unknown"]);
/**
 * Entity kinds and the facts each one carries (facts stay an open record; the *Facts types below are what the web reads).
 *  alert    firing: 1 (count), severity: "critical"|"warning"|"info", since: ISO time
 *  site     httpStatus: number, latencyMs: ms, tlsDaysLeft: days, uptime30d: %
 *  backup   ageHours: hours, sizeBytes: bytes, lastOk: ISO time, restoreVerified: boolean
 *  deploy   revision: string, health: string, syncStatus: string, ageMin: minutes
 *  slo      objective: % (target), current: % (measured), budgetLeft: % of error budget, windowDays: days
 *  decision a CrowdSec ban: ip, scenario, origin, expiresIn: seconds
 */
export const EntityKindSchema = z.enum(["server", "cluster", "node", "app", "argo-app", "site", "alert", "backup", "check", "deploy", "slo", "decision"]);
type F<T> = { value: T; unit?: string; max?: number };
export type AlertFacts = { firing?: F<number>; severity?: F<string>; since?: F<string> };
export type SiteFacts = { httpStatus?: F<number>; latencyMs?: F<number>; tlsDaysLeft?: F<number>; uptime30d?: F<number> };
export type BackupFacts = { ageHours?: F<number>; sizeBytes?: F<number>; lastOk?: F<string>; restoreVerified?: F<boolean> };
export type DeployFacts = { revision?: F<string>; health?: F<string>; syncStatus?: F<string>; ageMin?: F<number> };
export type SloFacts = { objective?: F<number>; current?: F<number>; budgetLeft?: F<number>; windowDays?: F<number> };
export type DecisionFacts = { ip?: F<string>; scenario?: F<string>; origin?: F<string>; expiresIn?: F<number> };
export const FactSchema = z.object({ value: z.union([z.number(), z.string(), z.boolean()]), unit: z.string().optional(), max: z.number().optional() });
export const LinkSchema = z.object({ label: z.string(), href: z.string().url() });
export const ActionRefSchema = z.object({ id: z.string(), label: z.string(), risk: z.enum(["safe", "disruptive"]) });
export const EntitySchema = z.object({
  id: z.string().min(1), kind: EntityKindSchema, server: ServerIdSchema, name: z.string(),
  status: StatusSchema, statusReason: z.string().optional(),
  facts: z.record(FactSchema), links: z.array(LinkSchema), actions: z.array(ActionRefSchema),
  observedAt: z.string().datetime(), parent: z.string().optional(),
  source: z.string().optional(), // id of the agent source that produced it; the center ages by its period
});
export type ServerId = z.infer<typeof ServerIdSchema>; export type Status = z.infer<typeof StatusSchema>;
export type EntityKind = z.infer<typeof EntityKindSchema>; export type Fact = z.infer<typeof FactSchema>;
export type Link = z.infer<typeof LinkSchema>;
export type Entity = z.infer<typeof EntitySchema>;
const rank: Record<Status, number> = { ok: 0, unknown: 1, attention: 2, down: 3 };
export function worst(s: Status[]): Status { return s.length ? s.reduce((a, b) => (rank[b] > rank[a] ? b : a)) : "unknown"; }
