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

test("Settings opens and shows agents, sources, identity and about", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL("/settings");
  await expect(page.locator('[data-server="lab"]')).toContainText("agent 0.1.0");
  await expect(page.locator('[data-server="lab"] .tag')).toHaveText("Connected");
  await expect(page.locator('[data-server="staging"] .tag')).toHaveText("Not connected");
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
  await expect(page.locator('[data-server="ops"] .tag.warm')).toHaveText("Unreachable");
  await expect(page.locator('[data-server="ops"]')).toContainText("last error: connect ECONNREFUSED");
  await expect(page.locator('[data-source="lab/argo"] .tag.warm')).toHaveText("Failing");
  await expect(page.getByLabel("Sources")).toContainText("Unreachable: its sources cannot be read.");
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
  await expect(page.locator(".kicker")).toHaveText("Alerts");
  await page.goBack(); await expect(page).toHaveURL("/");
  await expect(page.locator(".headline")).toBeVisible();
  await page.goForward(); await expect(page).toHaveURL("/alerts");
  await expect(page.getByRole("link", { name: "Alerts" })).toHaveAttribute("aria-current", "page");
});

test("keyboard: Enter on a focused rail item navigates", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Security", exact: true }).focus();
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
  await expect(page.locator(".map .tree").first()).toBeAttached();
  await page.reload();
  await expect(page.locator(".map .tree").first()).toBeAttached();
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
});

test("compact density tightens the modules", async ({ page }) => {
  await page.goto("/settings");
  await page.getByText("Compact", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator(".mod").first()).toHaveCSS("padding-top", "16px");
});

test("screenshot of Settings", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/settings");
  await expect(page.getByText("het@hetops.dev")).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: "e2e/__screens__/settings.png", fullPage: true });
});

test("on a phone every page is reachable: four in the bottom bar, the rest in More, nothing off-screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const bar = page.locator(".rail");
  for (const name of ["Home", "Timeline", "Alerts", "Apps"]) await expect(bar.getByRole("link", { name, exact: true })).toBeInViewport();
  const more = page.getByRole("button", { name: "More pages" });
  await expect(more).toBeInViewport();
  const box = (await bar.boundingBox())!;
  expect(box.y + box.height).toBeCloseTo(844, 0);   // at the foot, under the thumb
  await more.click();
  const sheet = page.locator("#more-pages");
  await expect(sheet.getByRole("link")).toHaveText(["Topology", "Backups", "Security", "Settings"]);
  await page.screenshot({ path: "e2e/__screens__/nav-phone-more.png", animations: "disabled" });
  await sheet.getByRole("link", { name: "Security" }).click();
  await expect(page).toHaveURL("/security");
  await expect(sheet).toBeHidden();
  await expect(more).toHaveClass(/\bon\b/);   // More says where you are
  await expect(page.locator("main h1")).toBeVisible();
  // the last module clears the bar
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const last = (await page.locator("main > *").last().boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual((await bar.boundingBox())!.y + 1);
});

test("a desktop has no More: every page sits in the rail", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "More pages" })).toBeHidden();
  await expect(page.locator(".rail a.nav")).toHaveCount(8);
  for (const l of await page.locator(".rail a.nav").all()) await expect(l).toBeVisible();
});

test("a server's own page: from its name on the map, its compartment zoomed in, load over the day, workloads, sources and timeline", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-30T07:42:00.000Z"));
  await page.goto("/");
  await page.getByRole("link", { name: "Open Lab's page" }).click();
  await expect(page).toHaveURL("/servers/lab");
  await expect(page).toHaveTitle("Lab · HetOps Control");
  await expect(page.locator("main h1")).toHaveText("Lab needs a look");
  // its compartment fills the map, one tree per workload; a tree opens its drawer
  await expect(page.locator('.srv-tree svg.map[data-map="lab"]')).toBeVisible();
  await expect(page.locator(".map .compartment")).toHaveCount(1);
  await page.locator('.tree[data-entity="lab/app/chaos/chaos-api"]').click();
  await expect(page.getByRole("dialog")).toContainText("chaos-api");
  await expect(page.locator('.tree[data-entity="lab/app/chaos/chaos-api"]')).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Escape");
  const load = page.locator('[aria-labelledby="sv-load"]');
  await expect(load.locator("h2")).toContainText("Since");      // lab's agent has kept 9 h, and the page says so
  await expect(load.locator("path.cpu-l")).toHaveCount(1);
  await expect(load.locator("path.mem-l")).toHaveCount(1);
  await expect(page.locator('[aria-labelledby="sv-work"] button.row')).toContainText(["chaos-api"]);
  await expect(page.locator('[aria-labelledby="sv-work"] .calm')).toContainText("The other 19 are healthy");
  await expect(page.locator('[aria-labelledby="sv-src"] .row').first()).toBeVisible();
  await expect(page.locator('[aria-labelledby="h-timeline"]')).toContainText("Timeline · lab");
  await page.screenshot({ path: "e2e/__screens__/server-lab.png", fullPage: true, animations: "disabled" });
  await page.goto("/servers/ops");
  await expect(page.locator('[aria-labelledby="sv-load"] h2')).toContainText("24 H");
  await page.goto("/servers/staging");
  await expect(page.locator("main h1")).toHaveText("Staging is not connected");
  await page.goto("/servers/nope");
  await expect(page.locator("main h1")).toContainText("no page at /servers/nope");   // an unknown server is a 404
});
