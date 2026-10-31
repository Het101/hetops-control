import { describe, expect, it } from "vitest";
import { GUST_EVERY, bezier, gust, gustAt, spark, wind } from "../src/lib/wind.js";

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

describe("ember keyframes in the loop", () => {
  it("bezier matches CSS easing curves", () => {
    const e = bezier(.25, .1, .25, 1); // CSS "ease"
    expect(e(0)).toBe(0); expect(e(1)).toBe(1); expect(e(.5)).toBeCloseTo(.8024, 3);
    expect(bezier(0, 0, 1, 1)(.37)).toBeCloseTo(.37, 5);
    const out = bezier(.22, 1, .36, 1); let prev = 0;
    for (let x = .05; x <= 1; x += .05) { expect(out(x)).toBeGreaterThanOrEqual(prev); prev = out(x); }
  });
  it("rests untouched in its delay, then plays the mock's fall and rise", () => {
    expect(spark("fall", -.1, 6, 20)).toBeUndefined();
    const f = spark("fall", .6, 6, 20)!; expect(f.transform).toBe("translate(2.00 12.00) rotate(32.0)"); expect(f.opacity).toBeCloseTo(.95, 6);
    expect(spark("fall", 6, 6, 20)!.opacity).toBe(0); // the cycle wraps to its first frame
    const peak = spark("rise", .45, 3, 10)!; expect(peak.opacity).toBe(1);
    expect(spark("rise", 2.999, 3, 10)!.transform).toMatch(/^translate\(10\.00 -70\.00\) scale\(0\.300/);
  });
});
