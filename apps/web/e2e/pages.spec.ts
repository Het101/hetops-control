import { test, expect, type Page } from "@playwright/test";
import { fixtureState, mockApi, roughEvents, roughNight } from "./fixture.js";

// the pages count time from the fixture's morning (07:42 UTC), so "for 2 h 32 min" is stable
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-30T07:42:00.000Z")); });

const shot = async (page: Page, name: string) => {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: `e2e/__screens__/${name}.png`, fullPage: true });
};
// screenshots are taken still, so they show the settled page
const still = (page: Page) => page.emulateMedia({ reducedMotion: "reduce" });

test.describe("Timeline", () => {
  test.beforeEach(async ({ page }) => { await mockApi(page); });

  test("the merged feed, grouped by hour, filters by chip and search, and opens a drawer", async ({ page }) => {
    await page.goto("/timeline");
    await expect(page.locator("main h1")).toContainText("events across 2 servers");
    await expect(page.locator(".hour-h").first()).toContainText("07:00");
    const rows = page.locator(".feed button.row");
    await expect(rows).toHaveCount(12);
    await page.getByRole("group", { name: "Server" }).getByRole("button", { name: /ops/ }).click();
    await expect(rows).toHaveCount(7);
    await page.keyboard.press("/");
    await expect(page.getByRole("searchbox")).toBeFocused();
    await page.keyboard.type("snapshot");
    await expect(rows).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(rows).toHaveCount(7);
    // the status change into attention is ember, and its drawer shows the entity it moved
    await page.getByRole("group", { name: "Server" }).getByRole("button", { name: /ops/ }).click();
    const hot = page.locator(".feed button.row.now");
    await expect(hot).toHaveCount(2);
    await hot.filter({ hasText: "chaos-api" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("chaos-api (lab) ok → attention");
    await expect(drawer).toContainText("2 restarts in 24h");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("the day scrubber narrows the list to an hour", async ({ page }) => {
    await page.goto("/timeline");
    await page.getByRole("button", { name: /^03:00, 3 events, 1 needing a look/ }).click();
    await expect(page.locator(".feed button.row")).toHaveCount(3);
    await page.getByRole("button", { name: "clear" }).click();
    await expect(page.locator(".feed button.row")).toHaveCount(12);
  });

  test("no events: a designed empty state", async ({ page }) => {
    await mockApi(page, fixtureState, []);
    await page.goto("/timeline");
    await expect(page.locator(".wait")).toContainText("No events yet.");
  });

  test("screenshot", async ({ page }) => { await still(page); await page.goto("/timeline"); await expect(page.locator(".feed button.row").first()).toBeVisible(); await shot(page, "timeline"); });
});

test.describe("Alerts", () => {
  test("a calm morning: nothing firing, every check passing, sources not yet reporting said honestly", async ({ page }) => {
    await mockApi(page); await page.goto("/alerts");
    await expect(page.locator("main h1")).toHaveText("Nothing is firing.");
    await expect(page.locator(".wait").first()).toContainText("No error budget reporting yet.");
    await expect(page.getByText("Alertmanager is not reporting yet")).toBeVisible();
    await expect(page.locator(".pill")).toHaveCount(19);
    await expect(page.locator(".pill.warm")).toHaveCount(0);
  });

  test("a rough night: firing alerts and failing checks by severity, with since and a link out", async ({ page }) => {
    await mockApi(page, roughNight(), roughEvents); await page.goto("/alerts");
    await expect(page.locator("main h1")).toHaveText("4 things are firing.");
    const rows = page.locator(".row[data-severity]");
    await expect(rows.nth(0)).toContainText("ThreadVault");
    await expect(rows.nth(0)).toHaveAttribute("data-severity", "critical");
    await expect(rows.nth(0)).toContainText("for 2 h 32 min");
    await expect(rows.nth(1)).toContainText("NodeFilesystemAlmostFull");
    await expect(page.locator('.row[data-severity="warning"]')).toHaveCount(2);
    await expect(page.locator('.row[data-severity="warning"]').nth(0)).toContainText("KubePodCrashLooping"); // firing since 03:14, before the drift at 06:00
    await expect(page.locator('.row[data-severity="info"]')).toContainText("CPUThrottlingHigh");
    await expect(page.getByRole("link", { name: "Grafana for KubePodCrashLooping" })).toHaveAttribute("href", /grafana/);
    await expect(page.getByRole("button", { name: /Silence KubePodCrashLooping: arrives in stage 2/ })).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(".budget-num")).toContainText("58");
    await page.getByRole("group", { name: "Server" }).getByRole("button", { name: /ops/ }).click();
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole("button").first().click();
    await expect(page.getByRole("dialog")).toContainText("http status");
  });

  test("screenshots", async ({ page }) => {
    await still(page); await mockApi(page); await page.goto("/alerts"); await expect(page.locator(".pill").first()).toBeVisible(); await shot(page, "alerts");
    await mockApi(page, roughNight(), roughEvents); await page.reload(); await expect(page.locator(".row[data-severity]").first()).toBeVisible(); await shot(page, "alerts-rough");
  });
});

test.describe("Apps", () => {
  test.beforeEach(async ({ page }) => { await mockApi(page); });

  test("per-server tallies, Argo cards, workload tiles with pods and restarts, and sites with uptime", async ({ page }) => {
    await page.goto("/apps");
    await expect(page.locator("main h1")).toContainText("1 needs you.");
    await expect(page.locator('.srv[data-server="lab"]')).toContainText("restarts 24 h");
    await expect(page.locator('.srv[data-server="staging"]')).toContainText("Not connected yet.");
    await expect(page.locator(".card")).toHaveCount(5);
    await expect(page.locator('.tile[data-app="lab/app/chaos/chaos-api"]')).toHaveClass(/hot/);
    await expect(page.locator('.tile[data-app="lab/app/chaos/chaos-api"]')).toContainText("2 restarts");
    await expect(page.locator('.tile[data-app="lab/app/clinic/api"] .pips i.up')).toHaveCount(3);
    await expect(page.locator(".site")).toHaveCount(10);
    await expect(page.locator('.site[data-site="ops/site/sites_chaos"]')).toContainText("98.61%");
    await expect(page.locator('.site[data-site="ops/site/sites_chaos"] .beats i')).toHaveCount(24);
    await page.locator('.site[data-site="ops/site/sites_chaos"] .site-open').click();
    await expect(page.getByRole("dialog")).toContainText("uptime 24h");
    await page.keyboard.press("Escape");
    await expect(page.getByText("Coolify is not reporting yet.")).toBeVisible();
  });

  test("search and the state chip filter every section", async ({ page }) => {
    await page.goto("/apps");
    await page.keyboard.press("/"); await page.keyboard.type("argocd");
    await expect(page.locator(".tile")).toHaveCount(5);
    await expect(page.locator(".site")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("group", { name: "State" }).getByRole("button", { name: /needs you/ }).click();
    await expect(page.locator(".tile")).toHaveCount(1);
    await page.locator(".tile").click();
    await expect(page.getByRole("dialog")).toContainText("restarts 24h");
  });

  test("screenshots, wide and phone", async ({ page }) => {
    await still(page); await page.goto("/apps"); await expect(page.locator(".tile").first()).toBeVisible(); await shot(page, "apps");
    await page.setViewportSize({ width: 390, height: 900 }); await shot(page, "apps-mobile");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe("Backups", () => {
  test("each policy as a player row: age ring, last ok, next run countdown, history", async ({ page }) => {
    await mockApi(page); await page.goto("/backups");
    await expect(page.locator("main h1")).toHaveText("Every backup succeeded in the last 26 hours.");
    const row = page.locator('[data-backup="ops/backup/nightly-security"]');
    await expect(row).toContainText("01:45 UTC");
    await expect(row).toContainText("30 kept");
    await expect(row).toContainText("1 failed");
    await expect(row.locator(".arc-age.warm")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Run nightly-all now: arrives in stage 2" })).toHaveAttribute("aria-disabled", "true");
  });

  test("a failed run is ember and says why", async ({ page }) => {
    await mockApi(page, roughNight(), roughEvents); await page.goto("/backups");
    await expect(page.locator("main h1")).toHaveText("1 backup needs you.");
    const row = page.locator('[data-backup="ops/backup/nightly-security"]');
    await expect(row).toHaveClass(/now/);
    await expect(row).toContainText("repository r2-security is not reachable");
    await expect(row.locator(".arc-age.warm")).toHaveCount(1);
    await row.locator(".open").click();
    await expect(page.getByRole("dialog")).toContainText("nightly-security failed");
  });

  test("no snapshot source: an honest empty state", async ({ page }) => {
    const s = structuredClone(fixtureState);
    s.entities = s.entities.filter(e => e.kind !== "backup"); s.servers.ops.sources = s.servers.ops.sources!.filter(x => x.id !== "snapshots");
    await mockApi(page, s); await page.goto("/backups");
    await expect(page.locator(".wait")).toContainText("No backup source reporting yet.");
  });

  test("screenshots", async ({ page }) => {
    await still(page); await mockApi(page); await page.goto("/backups"); await expect(page.locator("[data-backup]").first()).toBeVisible(); await shot(page, "backups");
    await mockApi(page, roughNight(), roughEvents); await page.reload(); await expect(page.locator(".row.now")).toBeVisible(); await shot(page, "backups-rough");
  });
});

test.describe("Security", () => {
  test("before the lab sources land: the map waits, the security log stream is live", async ({ page }) => {
    await mockApi(page); await page.goto("/security");
    await expect(page.locator(".overlay")).toContainText("CrowdSec is not reporting yet.");
    await expect(page.getByText("Bedrock drift is not reporting yet.")).toBeVisible();
    await expect(page.locator(".terrain path.l1")).toHaveCount(2); // one segment each side of the gap
    await expect(page.locator(".terrain rect.gap")).toHaveCount(1);
    await expect(page.locator(".knock")).toHaveCount(0);
  });

  test("with CrowdSec and Bedrock: bans on the map, scenarios, recent bans, drift and audit", async ({ page }) => {
    await mockApi(page, roughNight(), roughEvents); await page.goto("/security");
    await expect(page.locator("main h1")).toHaveText("37 sources are banned from 7 countries.");
    await expect(page.locator(".knock")).toHaveCount(7);
    await expect(page.locator(".map-mod .note")).toContainText("2 without a country");
    await expect(page.locator(".bar-row").first()).toContainText("crowdsecurity/ssh-bf");
    await expect(page.locator(".spark path")).not.toHaveCount(0);
    await expect(page.locator('[aria-labelledby="s-drift"] .tag.warm')).toHaveText("DRIFTED");
    await expect(page.getByText("Falco: shell spawned")).toBeVisible();
  });

  test("screenshots", async ({ page }) => {
    await still(page); await mockApi(page); await page.goto("/security"); await expect(page.locator(".terrain")).toBeVisible(); await shot(page, "security");
    await mockApi(page, roughNight(), roughEvents); await page.reload(); await expect(page.locator(".knock").first()).toBeVisible(); await shot(page, "security-rough");
    await page.setViewportSize({ width: 390, height: 900 }); await shot(page, "security-mobile");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test("every page is still with reduce motion on", async ({ page }) => {
  await mockApi(page, roughNight(), roughEvents);
  await page.goto("/settings");
  await page.getByText("On", { exact: true }).click();
  for (const p of ["/timeline", "/alerts", "/apps", "/backups", "/security"]) {
    await page.goto(p);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator(".knock-ring")).toHaveCount(0);
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
  }
});
