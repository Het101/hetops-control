import { test, expect, type Page } from "@playwright/test";
import { fixtureEvents, fixtureState, mockApi, roughEvents, roughNight } from "./fixture.js";

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-30T07:42:00.000Z")); });

const shot = async (page: Page, name: string) => {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: `e2e/__screens__/${name}.png`, fullPage: true });
};
const still = (page: Page) => page.emulateMedia({ reducedMotion: "reduce" });
const noScroll = async (page: Page, w: number) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);

test("a calm morning: every built link carries traffic, staging is drawn as not built yet", async ({ page }) => {
  await mockApi(page); await page.goto("/topology");
  await expect(page.locator("main h1")).toHaveText("Every link is carrying traffic.");
  await expect(page.locator(".link-chip")).toHaveCount(9);
  await expect(page.locator(".link-chip.ok")).toHaveCount(8);
  await expect(page.locator('[data-edge="agent-staging"]')).toHaveClass(/planned/);
  await expect(page.locator('[data-node="staging"]')).toContainText("NOT CONNECTED");
  await expect(page.locator('[data-edge="logs"]')).toContainText(/9200 · [\d,]+\/min/);
  await expect(page.locator(".wires .wire.attention, .wires .wire.down")).toHaveCount(0);
  // travelling dots on the live links, none on the planned one
  expect(await page.locator("circle.flow").count()).toBeGreaterThan(8);
});

test("clicking a link opens its signals; clicking a station opens its links", async ({ page }) => {
  await mockApi(page); await page.goto("/topology");
  await page.locator('[data-edge="logs"]').click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("Lab logs to ops");
  await expect(drawer).toContainText("Logs arriving from the lab");
  await expect(drawer).toContainText("docs/min");
  await expect(drawer.getByRole("link", { name: /Kibana/ })).toHaveAttribute("href", "https://kibana-ops.hetops.dev");
  await page.keyboard.press("Escape"); await expect(drawer).toBeHidden();
  await page.locator('[data-node="ops"]').click();
  await expect(drawer).toContainText("100.89.67.82");
  await expect(drawer).toContainText("Snapshots to the ops disk");
});

test("a rough night: the failing links are ember, the headline names the worst", async ({ page }) => {
  await mockApi(page, roughNight(), roughEvents); await page.goto("/topology");
  await expect(page.locator("main h1")).toHaveText("Cloudflare Tunnel to the lab needs a look. 1 more link needs you.");
  await expect(page.locator('[data-edge="tunnel-lab"]')).toHaveClass(/attention/);
  await expect(page.locator('[data-edge="snap-r2"]')).toHaveClass(/attention/);
  await expect(page.locator(".link-chip.attention, .link-chip.down")).toHaveCount(2);
});

test("logs that stopped: the link is down, still, and the headline says since when", async ({ page }) => {
  const s = structuredClone(fixtureState), now = Date.parse(s.generatedAt);
  for (const x of s.series) x.points = x.points.map(([t, v]) => [t, t > now - 20 * 60_000 ? 0 : v]);
  await mockApi(page, s, fixtureEvents); await page.goto("/topology");
  await expect(page.locator("main h1")).toHaveText("Logs from the lab stopped 12 min ago.");
  await expect(page.locator('[data-edge="logs"]')).toHaveClass(/down/);
  await expect(page.locator('.link-chip.down')).toHaveCount(1);
});

test("no signal at all: links are unknown, never green", async ({ page }) => {
  await mockApi(page, { ...fixtureState, entities: [], series: [] }, []); await page.goto("/topology");
  await expect(page.locator("main h1")).toHaveText("Every link that reports is carrying traffic; 7 have no signal yet.");
  await expect(page.locator(".link-chip.unknown")).toHaveCount(7);
});

test("reduce motion: no dots, nothing running", async ({ page }) => {
  await still(page); await mockApi(page); await page.goto("/topology");
  await expect(page.locator(".link-chip").first()).toBeVisible();
  await expect(page.locator("circle.flow")).toHaveCount(0);
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
});

test("screenshots", async ({ page }) => {
  await still(page); await mockApi(page);
  await page.setViewportSize({ width: 1366, height: 900 }); await page.goto("/topology"); await expect(page.locator(".link-chip").first()).toBeVisible();
  await shot(page, "topology-1366"); await noScroll(page, 1366);
  await page.setViewportSize({ width: 1920, height: 1080 }); await shot(page, "topology-1920");
  await mockApi(page, roughNight(), roughEvents); await page.reload(); await expect(page.locator(".link-chip.attention").first()).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 900 }); await shot(page, "topology-1366-rough");
  await page.setViewportSize({ width: 390, height: 900 }); await shot(page, "topology-mobile"); await noScroll(page, 390);
  await expect(page.locator(".topo")).toBeHidden();
  await expect(page.locator("[data-link]")).toHaveCount(9);
});

test("live screenshot with travelling dots", async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width: 1366, height: 900 }); await page.goto("/topology");
  await expect(page.locator("circle.flow").first()).toBeVisible();
  await page.waitForTimeout(3000);
  // the viewport only: a full-page capture of running compositor animations comes out washed
  await page.screenshot({ path: "e2e/__screens__/topology-live.png" });
});
