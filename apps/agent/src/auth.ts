import { timingSafeEqual } from "node:crypto";
export function bearerOk(h: string | undefined, token: string): boolean {
  if (!h?.startsWith("Bearer ")) return false;
  const a = Buffer.from(h.slice(7)), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
