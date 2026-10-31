import { describe, expect, it } from "vitest";
import { GUST_EVERY, gust, gustAt, wind } from "../src/lib/wind.js";

const peakX = (t: number) => { let best = -1, x0 = 0; for (let x = -400; x <= 1600; x += 10) { const g = gust(x, t); if (g > best) { best = g; x0 = x; } } return x0; };

describe("wind", () => {
  it("is deterministic for the same moment", () => { expect(wind(600, 12.3)).toBe(wind(600, 12.3)); expect(gustAt(5)).toEqual(gustAt(5)); });
  it("each gust travels left to right across the scene", () => {
    const { t0 } = gustAt(3);
    expect(peakX(t0 + 2.5)).toBeLessThan(peakX(t0 + 4)); expect(peakX(t0 + 4)).toBeLessThan(peakX(t0 + 5.5));
  });
  it("stays calm between gusts and bounded inside them", () => {
    for (let t = 0; t < GUST_EVERY * 6; t += .37) for (let x = 0; x <= 1200; x += 100) {
      expect(wind(x, t)).toBeGreaterThan(-.6); expect(wind(x, t)).toBeLessThan(2.6);
    }
  });
});
