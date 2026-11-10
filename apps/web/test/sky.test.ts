import { describe, it, expect } from "vitest";
import { place, ritu, RITUS, sky, sunElevation } from "../src/lib/sky.js";

const IST = place("Asia/Kolkata");

describe("ritu", () => {
  it("follows the six Indian seasons, two months each, from mid-month", () => {
    const at = (iso: string) => ritu(new Date(iso)).id;
    expect(at("2026-03-20T06:00:00Z")).toBe("vasanta");
    expect(at("2026-05-20T06:00:00Z")).toBe("grishma");
    expect(at("2026-08-01T06:00:00Z")).toBe("varsha");
    expect(at("2026-11-10T06:00:00Z")).toBe("sharad");
    expect(at("2026-11-20T06:00:00Z")).toBe("hemanta");
    expect(at("2027-01-01T06:00:00Z")).toBe("hemanta");   // the year turns inside Hemanta
    expect(at("2027-02-01T06:00:00Z")).toBe("shishira");
    expect(at("2027-03-14T06:00:00Z")).toBe("shishira");
  });
  it("reads the viewer's own calendar day, not UTC's", () => {
    // 14 Nov 20:00 UTC is already 15 Nov in India: Hemanta there, still Sharad in UTC
    expect(ritu(new Date("2026-11-14T20:00:00Z"), IST).id).toBe("hemanta");
    expect(ritu(new Date("2026-11-14T20:00:00Z"), place("UTC")).id).toBe("sharad");
  });
  it("gives every ritu a name, a palette and its weather", () => {
    expect(RITUS.map(r => r.id)).toEqual(["vasanta", "grishma", "varsha", "sharad", "hemanta", "shishira"]);
    for (const r of RITUS) {
      expect(r.name).toMatch(/^[A-Z]/);
      expect(r.leaf).toHaveLength(3);
      for (const c of [...r.leaf, r.ground, r.horizon]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(RITUS.find(r => r.id === "varsha")!.weather).toBe("rain");
    expect(RITUS.find(r => r.id === "shishira")!.foliage).toBeLessThan(RITUS.find(r => r.id === "varsha")!.foliage);
  });
});

describe("sun and phase", () => {
  it("puts the sun high at Indian noon and below the horizon at Indian midnight", () => {
    expect(sunElevation(new Date("2026-11-10T06:45:00Z"), IST)).toBeGreaterThan(40);   // about 12:15 IST
    expect(sunElevation(new Date("2026-11-10T18:30:00Z"), IST)).toBeLessThan(-30);     // midnight IST
  });
  it("names dawn, day, dusk and night from the sun, and blends light smoothly", () => {
    const at = (iso: string) => sky(new Date(iso), IST);
    expect(at("2026-11-10T00:45:00Z").phase).toBe("dawn");    // about 06:15 IST, sun near the horizon, rising
    expect(at("2026-11-10T06:45:00Z").phase).toBe("day");
    expect(at("2026-11-10T12:15:00Z").phase).toBe("dusk");    // about 17:45 IST, setting
    expect(at("2026-11-10T18:30:00Z").phase).toBe("night");
    const noon = at("2026-11-10T06:45:00Z").light, night = at("2026-11-10T18:30:00Z").light;
    expect(noon).toBeCloseTo(1, 1); expect(night).toBe(0);
    expect(at("2026-11-10T00:45:00Z").light).toBeGreaterThan(0); expect(at("2026-11-10T00:45:00Z").light).toBeLessThan(1);
  });
  it("guesses a place from the time zone without asking for location, and falls back on the offset", () => {
    expect(IST.lat).toBeGreaterThan(8); expect(IST.lat).toBeLessThan(35);
    const far = place("Mars/Olympus", -300);   // unknown zone, UTC+5: longitude from the offset
    expect(far.lon).toBeCloseTo(75, 0);
  });
});
