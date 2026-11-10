import { describe, it, expect } from "vitest";
import { parsePrefs, reduces } from "../src/lib/prefs.js";

describe("prefs", () => {
  it("falls back per field on anything unreadable", () => {
    expect(parsePrefs(null)).toEqual({ motion: "system", density: "comfortable" });
    expect(parsePrefs("not json")).toEqual({ motion: "system", density: "comfortable" });
    expect(parsePrefs('"x"')).toEqual({ motion: "system", density: "comfortable" });
    expect(parsePrefs('{"motion":"on","density":"huge"}')).toEqual({ motion: "on", density: "comfortable" });
    expect(parsePrefs('{"motion":"off","density":"compact"}')).toEqual({ motion: "off", density: "compact" });
  });
  it("system follows the OS; on and off override it", () => {
    expect(reduces("system", true)).toBe(true); expect(reduces("system", false)).toBe(false);
    expect(reduces("on", false)).toBe(true); expect(reduces("off", true)).toBe(false);
  });
});
