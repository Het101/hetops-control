import { test, expect } from "@playwright/test";
import { fixtureState, mockApi } from "./fixture.js";

const PAGES = [["Topology", "/topology"], ["Timeline", "/timeline"], ["Alerts", "/alerts"], ["Apps", "/apps"],
  ["Backups", "/backups"], ["Security", "/security"], ["Settings", "/settings"], ["Home", "/"]] as const;

test.beforeEach(async ({ page }) => { await mockApi(page); });

test("every rail item navigates, renders its page and becomes the active one", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".headline")).toBeVisible();
  for (const [name, path] of PAGES) {
    const link = page.getByRole("link", { name, exact: true });
    await link.click();
    await expect(page).toHaveURL(path);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("main h1")).toBeFocused(); // the change is announced
    await expect(page).toHaveTitle(`${name} · HetOps Control`);
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(link).toHaveClass(/pressed/);
    await expect(page.locator('.rail [aria-current="page"]')).toHaveCount(1);
  }
});

test("pages without a source say so, with no sample data", async ({ page }) => {
  await page.goto("/backups");
  await expect(page.locator(".kicker")).toHaveText("BACKUPS");
  await expect(page.locator(".waiting h4")).toContainText("NO SOURCE REPORTING YET");
  await expect(page.locator(".waiting .row")).toHaveCount(0);
});

test("Settings opens and shows agents, sources, identity and about", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL("/settings");
  await expect(page.locator('[data-server="lab"]')).toContainText("agent 0.1.0");
  await expect(page.locator('[data-server="lab"] .tag')).toHaveText("CONNECTED");
  await expect(page.locator('[data-server="staging"] .tag')).toHaveText("NOT CONFIGURED");
  await expect(page.locator('[data-source="ops/argo"]')).toContainText("every 1 min");
  await expect(page.locator('[data-source="lab/kubernetes"] .tag')).toHaveText("OK");
  await expect(page.getByText("het@hetops.dev")).toBeVisible();
  await expect(page.locator(".facts")).toContainText("8b74612");
});

test("Settings: an unreachable agent and a failing source are said, in ember", async ({ page }) => {
  const s = structuredClone(fixtureState);
  s.servers.ops = { ...s.servers.ops, reachable: false, lastError: "connect ECONNREFUSED", sources: undefined };
  s.servers.lab.sources = [{ id: "argo", periodMs: 60_000, ok: false, lastRunAt: "2026-10-30T07:41:00.000Z", error: "forbidden" }];
  await mockApi(page, s);
  await page.goto("/settings");
  await expect(page.locator('[data-server="ops"] .tag.warm')).toHaveText("UNREACHABLE");
  await expect(page.locator('[data-server="ops"]')).toContainText("last error: connect ECONNREFUSED");
  await expect(page.locator('[data-source="lab/argo"] .tag.warm')).toHaveText("FAILING");
  await expect(page.getByLabel("SOURCES")).toContainText("Unreachable: its sources cannot be read.");
});

test("deep links load the page directly", async ({ page }) => {
  for (const [name, path] of PAGES) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
  }
});

test("back and forward walk the history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Alerts" }).click(); await expect(page).toHaveURL("/alerts");
  await page.getByRole("link", { name: "Settings" }).click(); await expect(page).toHaveURL("/settings");
  await page.goBack(); await expect(page).toHaveURL("/alerts");
  await expect(page.locator(".kicker")).toHaveText("ALERTS");
  await page.goBack(); await expect(page).toHaveURL("/");
  await expect(page.locator(".headline")).toBeVisible();
  await page.goForward(); await expect(page).toHaveURL("/alerts");
  await expect(page.getByRole("link", { name: "Alerts" })).toHaveAttribute("aria-current", "page");
});

test("keyboard: Enter on a focused rail item navigates", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Security" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/security");
});

test("an unknown route is a friendly 404 with a way home", async ({ page }) => {
  await page.goto("/nowhere");
  await expect(page.locator(".kicker")).toHaveText("404 · NOT ON THE MAP");
  await expect(page.locator("main h1")).toContainText("/nowhere");
  await expect(page.locator('.rail [aria-current="page"]')).toHaveCount(0);
  await page.getByRole("link", { name: "Back to Home" }).click();
  await expect(page).toHaveURL("/");
});

test("rail tips stay above the content on every page", async ({ page }) => {
  await page.goto("/settings");
  const tip = page.getByRole("link", { name: "Apps" }).locator(".tip");
  await page.getByRole("link", { name: "Apps" }).hover();
  await expect(tip).toHaveCSS("opacity", "1");
  await page.waitForTimeout(500);
  const b = (await tip.boundingBox())!;
  await tip.evaluate(el => { el.style.pointerEvents = "auto"; });
  expect(await tip.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x!, y!)), [b.x + b.width / 2, b.y + b.height / 2])).toBe(true);
});

test("reduce motion On stills every animation, and is remembered", async ({ page }) => {
  await page.goto("/settings");
  await page.getByText("On", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.locator("circle.leaf").first()).toBeAttached();
  await page.reload();
  await expect(page.locator("circle.leaf").first()).toBeAttached();
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
});

test("compact density tightens the modules", async ({ page }) => {
  await page.goto("/settings");
  await page.getByText("Compact", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator(".mod").first()).toHaveCSS("padding-top", "14px");
});

test("screenshot of Settings", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/settings");
  await expect(page.getByText("het@hetops.dev")).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: "e2e/__screens__/settings.png", fullPage: true });
  await page.getByRole("link", { name: "Security" }).click();
  await expect(page.locator(".waiting")).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/empty-page.png", fullPage: true });
});
