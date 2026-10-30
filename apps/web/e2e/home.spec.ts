import { test, expect } from "@playwright/test";
import { StateSchema } from "../src/lib/api.js";
import { fixtureState, mockApi } from "./fixture.js";

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
  await expect(page.locator(".list[aria-labelledby=\"h-timeline\"] .row")).toHaveCount(6);
});

test("rail: every page is a named link, tips show on keyboard focus", async ({ page }) => {
  const topology = page.getByRole("link", { name: "Topology" });
  await expect(topology).toHaveAttribute("href", "/topology");
  await topology.focus();
  await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); // keyboard focus, so :focus-visible applies
  await expect(topology.locator(".tip")).toHaveCSS("opacity", "1");
  await expect(page.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(topology).not.toHaveAttribute("aria-current");
});

test("timeline ember rows come from the event level", async ({ page }) => {
  // two status events moved into attention (chaos-api and the chaos site); the restart and the recovery stay quiet
  await expect(page.locator(".list[aria-labelledby=\"h-timeline\"] .row.now")).toHaveCount(2);
  await expect(page.locator(".list[aria-labelledby=\"h-timeline\"] .row.now").filter({ hasText: "chaos-api (lab) ok → attention" })).toHaveCount(1);
  await expect(page.locator(".list[aria-labelledby=\"h-timeline\"] .row:not(.now)").filter({ hasText: "attention → ok" })).toHaveCount(1);
});

test("a failing event log is said, not shown as empty", async ({ page }) => {
  await page.route("**/api/events?*", r => r.fulfill({ status: 503, json: { error: "down" } }));
  await page.reload();
  await expect(page.locator(".list .empty.warm")).toBeVisible();
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
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.screenshot({ path: "e2e/__screens__/home-1366.png", fullPage: true });
  });
});

test("a configured server that never connected reads UNREACHABLE", async ({ page }) => {
  const state = StateSchema.parse({ ...fixtureState, servers: { ...fixtureState.servers, staging: { ...fixtureState.servers.staging, configured: true } } });
  await page.route("**/api/state", r => r.fulfill({ json: state }));
  await page.reload();
  await expect(page.locator('.st[data-server="staging"] i')).toHaveText("● UNREACHABLE");
  await expect(page.locator('.st[data-server="lab"] i')).not.toHaveText("● UNREACHABLE");
});

test("rail tips sit above the page content", async ({ page }) => {
  await page.getByRole("link", { name: "Home" }).hover();
  const tip = page.getByRole("link", { name: "Home" }).locator(".tip");
  await expect(tip).toHaveCSS("opacity", "1");
  await page.waitForTimeout(500); // the tip slides in
  const b = (await tip.boundingBox())!; const vp = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
  // the tip ignores the pointer, which would hide it from elementFromPoint; make it hittable for the check only
  await tip.evaluate(el => { el.style.pointerEvents = "auto"; });
  expect(await tip.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x!, y!)), [b.x + b.width / 2, b.y + b.height / 2])).toBe(true);
});
