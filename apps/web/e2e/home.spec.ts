import { test, expect, type Page } from "@playwright/test";
import { StateSchema } from "../src/lib/api.js";
import { fixtureEvents, fixtureState } from "./fixture.js";

// the center is mocked: the state, the last events, and a stream that sends one state then ends (the page re-opens it)
async function mockApi(page: Page) {
  const state = StateSchema.parse(fixtureState);
  await page.route("**/api/state", r => r.fulfill({ json: state }));
  await page.route("**/api/events?*", r => r.fulfill({ json: fixtureEvents }));
  await page.route("**/api/stream", r => r.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "state", state })}\n\n` }));
}

test.beforeEach(async ({ page }, info) => {
  await mockApi(page);
  // test.use({ reducedMotion }) did not reach the headless shell here; emulate it on the page before loading
  if (info.titlePath.includes("reduced motion")) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
});

test("the headline renders from the state", async ({ page }) => {
  await expect(page.locator(".headline")).toContainText("The estate is healthy.");
  await expect(page.locator(".headline em")).toHaveText("1 thing is waiting on you.");
  await expect(page.locator(".needs h3")).toHaveText("NEEDS YOU · 1");
  await expect(page.locator(".ember-btn")).toBeDisabled();
});

test("three stations with their status words", async ({ page }) => {
  await expect(page.locator(".st")).toHaveCount(3);
  await expect(page.locator('.st[data-server="lab"] i')).toHaveText("● SMOULDERING · 2 restarts");
  await expect(page.locator('.st[data-server="staging"] i')).toHaveText("● NOT CONNECTED");
  await expect(page.locator('.st[data-server="ops"] i')).toHaveText("● HEALTHY");
});

test("the struggling app grows ember leaves", async ({ page }) => {
  await expect(page.locator("circle.leaf").first()).toBeAttached();
  expect(await page.locator("circle.leaf.ember").count()).toBeGreaterThan(0);
  await expect(page.locator(".list .row")).toHaveCount(6);
});

test.describe("reduced motion", () => {
  test("no animation runs", async ({ page }) => {
    await expect(page.locator("circle.leaf").first()).toBeAttached();
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
  });

  test("screenshot of the final frame", async ({ page }) => {
    await expect(page.locator("circle.leaf").first()).toBeAttached();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: "e2e/__screens__/home.png", fullPage: true });
  });
});
