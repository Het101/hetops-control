import { test, expect, type Page } from "@playwright/test";
import { deployHistory, fixtureEvents, fixtureState, mockApi, roughEvents, roughNight } from "./fixture.js";

// Home counts days and ages from the fixture's morning (07:42 UTC)
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-30T07:42:00.000Z")); });
const mod = (page: Page, name: string) => page.locator(`[data-module="${name}"]`);
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: `e2e/__screens__/${name}.png`, fullPage: true });
};

test("a calm morning: the modules whose sources report, and none of the ones still landing", async ({ page }) => {
  await mockApi(page); await page.goto("/");
  // the error budget and CrowdSec have not reported yet: not shown, no mock data
  await expect(mod(page, "budget")).toHaveCount(0);
  await expect(mod(page, "knocks")).toHaveCount(0);
  // deploys: 2 days of events held, so 12 of the 14 days are hollow; nothing waits, so no ember
  await expect(mod(page, "deploys").locator(".cap-track.unknown")).toHaveCount(12);
  await expect(mod(page, "deploys").locator(".cap")).toHaveCount(1); // today: 2 Argo syncs and 2 rollouts
  await expect(mod(page, "deploys").locator(".cap.hot")).toHaveCount(0);
  await expect(mod(page, "deploys").locator("h4")).toContainText("4 in 14 d");
  // log flow: both streams, the 40-min gap hatched once
  await expect(mod(page, "logs").locator("path.l1")).toHaveCount(2);
  await expect(mod(page, "logs").locator("path.l2")).toHaveCount(2);
  await expect(mod(page, "logs").locator("rect.gap")).toHaveCount(1);
  await expect(mod(page, "logs").locator("h4")).toContainText("/min");
  await expect(mod(page, "backups").locator("a.row")).toHaveCount(2);
  await expect(mod(page, "backups").locator(".row.now")).toHaveCount(0);
  await expect(mod(page, "sites").locator(".cell")).toHaveCount(10);
  await expect(mod(page, "sites").locator(".cell.hot")).toHaveCount(0);
  await expect(mod(page, "sites").locator("h4")).toContainText("10/10 up");
});

test("each module links to its page", async ({ page }) => {
  await mockApi(page, roughNight(), roughEvents); await page.goto("/");
  for (const [m, path] of [["deploys", "/timeline"], ["budget", "/alerts"], ["logs", "/security"], ["knocks", "/security"], ["backups", "/backups"], ["sites", "/apps"]] as const)
    await expect(mod(page, m).locator("a.to")).toHaveAttribute("href", path);
  await mod(page, "backups").locator("a.row").first().click();
  await expect(page).toHaveURL(/\/backups$/);
  await expect(page.locator("main h1")).toHaveText("1 backup needs you.");
  await page.goBack();
  await mod(page, "knocks").getByRole("link", { name: "Open Security" }).click();
  await expect(page).toHaveURL(/\/security$/);
});

test("a rough night: the budget, silver bans, and ember only where the owner is needed", async ({ page }) => {
  await mockApi(page, roughNight(), [...roughEvents, ...deployHistory]); await page.goto("/");
  await expect(mod(page, "budget").locator(".budget-num")).toContainText("58");
  await expect(mod(page, "budget").locator(".budget-num.warm")).toHaveCount(0);
  await expect(mod(page, "knocks").locator(".knock")).toHaveCount(7);
  await expect(mod(page, "knocks").locator(".knock").first()).toHaveCSS("fill", "rgb(201, 199, 193)"); // --quiet, never ember
  await expect(mod(page, "knocks").locator("h4")).toContainText("37 banned");
  await expect(mod(page, "deploys").locator(".cap-track.unknown")).toHaveCount(0);
  await expect(mod(page, "deploys").locator(".cap.hot")).toHaveCount(1);
  await expect(mod(page, "deploys").locator(".wait-row")).toContainText("radar-cloud has 7a5cba8 waiting for a deploy");
  const sec = mod(page, "backups").locator('[data-backup="ops/backup/nightly-security"]');
  await expect(sec).toHaveClass(/now/); await expect(sec).toContainText("FAILED"); await expect(sec).toContainText("r2-security is not reachable");
  await expect(mod(page, "sites").locator(".cell.hot")).toHaveCount(1);
  await expect(mod(page, "sites").locator(".cell.hot")).toContainText("ThreadVault");
});

test("a failing source says so in ember and shows no numbers", async ({ page }) => {
  const s = roughNight();
  s.servers.lab.failingSources = [{ id: "crowdsec", error: "LAPI answered 403" }, { id: "slo", error: "Prometheus timed out" }];
  s.servers.ops.failingSources = [{ id: "elasticsearch", error: "connect ECONNREFUSED" }, { id: "snapshots", error: "connect ECONNREFUSED" }, { id: "gatus", error: "HTTP 502" }];
  await mockApi(page, s);
  await page.route("**/api/events?*", r => r.fulfill({ status: 503, json: { error: "down" } }));
  await page.goto("/");
  for (const [m, title] of [["deploys", "Can't read the event log."], ["budget", "Can't read the error budget."], ["logs", "Can't read Elasticsearch."],
    ["knocks", "Can't read CrowdSec."], ["backups", "Can't read the snapshots."], ["sites", "Can't read Gatus."]] as const) {
    await expect(mod(page, m).locator(".wait.warm")).toContainText(title);
  }
  await expect(page.locator(".capsules, .terrain, .world, .slider, [data-module] a.row, .cell")).toHaveCount(0);
  await expect(mod(page, "knocks")).toContainText("LAPI answered 403");
});

test("reporting with nothing to show: honest empty states", async ({ page }) => {
  const s = structuredClone(fixtureState);
  s.servers.lab.sources = [...s.servers.lab.sources!, { id: "crowdsec", periodMs: 60_000, ok: true }, { id: "slo", periodMs: 60_000, ok: true }];
  await mockApi(page, s, fixtureEvents.filter(e => e.kind !== "deploy" && e.kind !== "sync")); await page.goto("/");
  await expect(mod(page, "budget").locator(".wait")).toContainText("No SLO reported.");
  await expect(mod(page, "knocks").locator(".note")).toContainText("Nothing is banned right now");
  await expect(mod(page, "knocks").locator(".knock")).toHaveCount(0);
  await expect(mod(page, "deploys").locator(".note")).toContainText("No deploys in the events held.");
});

test("reduced motion: Home is still, the knock rings are not drawn", async ({ page }) => {
  await mockApi(page, roughNight(), [...roughEvents, ...deployHistory]);
  await page.goto("/settings"); await page.getByText("On", { exact: true }).click();
  await page.goto("/");
  await expect(mod(page, "knocks").locator(".knock").first()).toBeAttached();
  await expect(page.locator(".knock-ring")).toHaveCount(0);
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
});

test.describe("screenshots", () => {
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });
  for (const [w, h] of [[1366, 900], [1920, 1080]] as const) {
    test(`${w} px, calm and rough`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await mockApi(page); await page.goto("/"); await expect(mod(page, "sites").locator(".cell").first()).toBeVisible(); await shot(page, `home-${w}`);
      await mockApi(page, roughNight(), [...roughEvents, ...deployHistory]); await page.reload();
      await expect(mod(page, "knocks").locator(".knock").first()).toBeAttached(); await shot(page, `home-${w}-rough`);
    });
  }
  test("phone, no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page, roughNight(), [...roughEvents, ...deployHistory]); await page.goto("/");
    await expect(mod(page, "knocks").locator(".knock").first()).toBeAttached();
    await shot(page, "home-mobile");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // the hero stacks: Needs-you sits below the headline, not over it
    const head = (await page.locator(".headline").boundingBox())!, needs = (await page.locator(".needs").boundingBox())!;
    expect(needs.y).toBeGreaterThanOrEqual(head.y + head.height);
  });
});
