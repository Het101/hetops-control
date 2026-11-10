// Seeds for everything drawn from an id: the same id always gives the same shape, place and timing.
/** FNV-1a, folded into a Park-Miller seed (1..2^31-2). */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 2147483646) + 1;
}
/** The mock's generator: same sequence for the same seed. */
export function rng(seed: number): () => number {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}
