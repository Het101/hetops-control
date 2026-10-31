import { test, expect } from "@playwright/test";
import { mockApi, roughEvents, roughNight } from "./fixture.js";

test("the fonts are the app's own: no request leaves for Google Fonts, or for any other host", async ({ page, baseURL }) => {
  const away: string[] = [];
  page.on("request", r => { if (new URL(r.url()).origin !== new URL(baseURL!).origin) away.push(r.url()); });
  await mockApi(page, roughNight(), roughEvents);
  for (const p of ["/", "/topology", "/settings"]) { await page.goto(p); await expect(page.locator("main h1")).toBeAttached(); }
  // the faces really arrive, from this origin
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter(f => f.status === "loaded").map(f => `${f.family.replace(/"/g, "")} ${f.weight}`).sort());
  expect(loaded).toEqual(expect.arrayContaining(["Fraunces 500 600", "IBM Plex Mono 400", "IBM Plex Mono 500", "Plus Jakarta Sans 400 600"]));
  expect(away.filter(u => /fonts\.(googleapis|gstatic)\.com/.test(u))).toEqual([]);
  expect(away).toEqual([]);
});
