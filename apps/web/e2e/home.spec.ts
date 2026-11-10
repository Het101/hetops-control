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
  await expect(page.locator(".headline")).toContainText("The estate is healthy");
  await expect(page.locator(".headline em")).toHaveText("1 thing is waiting on you");
  await expect(page.locator(".needs h2")).toHaveText("Needs you · 1");
  await expect(page.locator(".needs .need-go")).toHaveText(/^Open Appss*→$/);   // no action here: its page, never a dead button
  await expect(page.locator(".needs .need-go")).toHaveAttribute("href", "/apps");
});

test("three compartments on the map, each saying what it holds; staging is in fog", async ({ page }) => {
  await expect(page.locator(".map .compartment")).toHaveCount(3);
  await expect(page.locator('.compartment[data-server="lab"] .c-line')).toHaveText(/^\d+ workloads · 34\/35 pods$/);
  await expect(page.locator('.compartment[data-server="staging"]')).toHaveAttribute("data-burn", "fog");
  await expect(page.locator('.compartment[data-server="staging"] .c-line')).toHaveText("in fog · agent not connected");
  // every workload is a drawn tree, grouped by namespace: roots, trunk, branches and leaves
  const tree = page.locator('.compartment[data-server="lab"] .tree').first();
  await expect(tree.locator(".roots")).toHaveCount(1);
  expect(await tree.locator("use").count()).toBeGreaterThan(60);
});

test("the struggling app burns: its tree is on fire, named under its grove, and says why", async ({ page }) => {
  const t = page.locator('.tree[data-entity="lab/app/chaos/chaos-api"]');
  await expect(t).toHaveAttribute("data-burn", "fire");
  await expect(t.locator(".flames")).toHaveCount(1);
  await expect(t).toHaveAttribute("aria-label", /^chaos-api, burning/);
  await expect(page.locator('.t-why[data-burn="fire"]', { hasText: "chaos-api" })).toHaveCount(1);
  // nothing else burns on a calm night: only orange where the owner is needed
  await expect(page.locator('.tree[data-burn="fire"]')).toHaveCount(1);
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

test("timeline ember rows are the incidents still open; a recovered one is silver and says when", async ({ page }) => {
  // chaos-api moved into attention and is still there; the chaos site did too, then recovered at 06:41, so it is history
  const tl = page.locator(".list[aria-labelledby=\"h-timeline\"]");
  await expect(tl.locator(".row.now")).toHaveCount(1);
  await expect(tl.locator(".row:not(.now)").filter({ hasText: "chaos.hetops.dev (ops) ok → attention" })).toContainText("Recovered 06:41");
  await expect(page.locator(".list[aria-labelledby=\"h-timeline\"] .row.now").filter({ hasText: "chaos-api (lab) ok → attention" })).toHaveCount(1);
  // the recovery is folded into its incident: one row, and its steps open under it
  const inc = tl.locator("button.row.incident").filter({ hasText: "chaos.hetops.dev (ops) ok → attention" });
  await inc.click();
  await expect(tl.locator(".steps")).toContainText("attention → ok");
});

test("a failing event log is said, not shown as empty", async ({ page }) => {
  await page.route("**/api/events?*", r => r.fulfill({ status: 503, json: { error: "down" } }));
  await page.reload();
  await expect(page.locator(".list .empty.warm")).toBeVisible();
});

test.describe("reduced motion", () => {
  test("no animation runs", async ({ page }) => {
    await expect(page.locator(".map .tree").first()).toBeAttached();
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
  });

  test("screenshot of the final frame", async ({ page }) => {
    await expect(page.locator(".map .tree").first()).toBeAttached();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: "e2e/__screens__/home.png", fullPage: true });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.screenshot({ path: "e2e/__screens__/home-1366.png", fullPage: true });
  });
});

test("a configured server that never connected reads Unreachable", async ({ page }) => {
  const state = StateSchema.parse({ ...fixtureState, servers: { ...fixtureState.servers, staging: { ...fixtureState.servers.staging, configured: true } } });
  await page.route("**/api/state", r => r.fulfill({ json: state }));
  await page.reload();
  await expect(page.locator('.compartment[data-server="staging"] .c-line')).toHaveText("in fog · unreachable");
  await expect(page.locator('.compartment[data-server="lab"] .c-line')).not.toContainText("unreachable");
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
