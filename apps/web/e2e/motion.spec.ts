import { test, expect, type Page } from "@playwright/test";
import { deployHistory, mockApi, roughEvents, roughNight } from "./fixture.js";

// the forest's wind writes transform attributes from one rAF loop; read a limb, the crown and the grass twice
const sample = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('svg.forest [data-wind="pivot"], svg.forest [data-wind="grass"]')].slice(0, 12).map(el => el.getAttribute("transform")));

test("the forest moves by default: the wind changes its transforms over time", async ({ page }) => {
  await mockApi(page, roughNight(), roughEvents); await page.goto("/");
  await expect(page.locator(".limb").first()).toBeAttached();
  await page.waitForTimeout(400);
  const a = await sample(page);
  await page.waitForTimeout(700);
  const b = await sample(page);
  expect(a.every(t => t !== null)).toBe(true);
  expect(b).not.toEqual(a);
  // the roots breathe and the wind streaks exist only while motion is on
  await expect(page.locator(".streak")).toHaveCount(5);
  expect(await page.evaluate(() => document.getAnimations().filter(x => x.playState === "running").length)).toBeGreaterThan(0);
});

test("the embers and falling leaves ride the same 30 Hz loop, not CSS animations", async ({ page }) => {
  await mockApi(page, roughNight(), roughEvents); await page.goto("/");
  await expect(page.locator(".ember-p").first()).toBeAttached();
  const read = () => page.evaluate(() => [...document.querySelectorAll("svg.forest .ember-p, svg.forest .fall")].map(el => `${el.getAttribute("transform")}|${el.getAttribute("fill-opacity")}`));
  // each particle waits out its seeded delay (up to 3 s for an ember), then moves
  await page.waitForTimeout(3500);
  const a = await read(); await page.waitForTimeout(300); const b = await read();
  expect(a.filter((x, i) => x !== b[i]).length).toBeGreaterThan(a.length / 2);
  expect(await page.evaluate(() => [...document.querySelectorAll("svg.forest .ember-p, svg.forest .fall")].flatMap(el => el.getAnimations()).length)).toBe(0);
});

for (const how of ["os", "settings"] as const) {
  test(`reduced motion (${how}): the forest is still and the weather is gone`, async ({ page }) => {
    await mockApi(page, roughNight(), roughEvents);
    if (how === "os") await page.emulateMedia({ reducedMotion: "reduce" });
    else { await page.goto("/settings"); await page.getByText("On", { exact: true }).click(); }
    await page.goto("/");
    await expect(page.locator(".limb").first()).toBeAttached();
    const a = await sample(page);
    await page.waitForTimeout(700);
    expect(await sample(page)).toEqual(a);
    expect(a.every(t => t === null)).toBe(true);
    await expect(page.locator(".streak, .mote, .scan")).toHaveCount(0);
    expect(await page.evaluate(() => document.getAnimations().filter(x => x.playState === "running").length)).toBe(0);
  });
}

test("the rail stays put while a long page scrolls, the gear still in view", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await mockApi(page, roughNight(), [...roughEvents, ...deployHistory]); await page.goto("/apps");
  await expect(page.locator(".tile").first()).toBeVisible();
  const rail = page.getByRole("navigation", { name: "Pages" });
  const before = (await rail.boundingBox())!;
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
  const after = (await rail.boundingBox())!;
  // sub-pixel scroll rounding aside, the rail has not moved or shrunk
  for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(after[k] - before[k])).toBeLessThan(1);
  await expect(page.getByRole("link", { name: "Settings" })).toBeInViewport();
  await expect(page.getByRole("link", { name: "Home" })).toBeInViewport();
});

test("no page scrolls sideways, wide or phone", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockApi(page, roughNight(), [...roughEvents, ...deployHistory]);
  for (const [w, h] of [[1366, 900], [1920, 1080], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const p of ["/", "/topology", "/timeline", "/alerts", "/apps", "/backups", "/security", "/settings"]) {
      await page.goto(p); await expect(page.locator("main h1")).toBeAttached();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${p} at ${w}`).toBeLessThanOrEqual(w);
    }
  }
});
