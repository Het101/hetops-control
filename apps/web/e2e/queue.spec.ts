import { test, expect } from "@playwright/test";
import { fixtureState, mockApi } from "./fixture.js";

test("the Needs-you pill is on every page; n opens the queue, the keys move, Enter takes you there", async ({ page }) => {
  await mockApi(page); await page.goto("/security");
  const pill = page.getByRole("button", { name: "1 needs you" });
  await expect(pill).toBeVisible();
  await page.keyboard.press("n");
  const q = page.getByRole("dialog", { name: "Needs you · 1" });
  await expect(q).toBeVisible();
  const row = q.locator("button.q-row").first();
  await expect(row).toBeFocused();
  await expect(row).toContainText("chaos-api is restarting on lab");
  await expect(row).toContainText("Open Apps →");   // no action described for it here: Enter goes to its page
  await page.keyboard.press("j"); await expect(row).toBeFocused();   // one item: j wraps to itself
  await page.screenshot({ path: "e2e/__screens__/queue.png", animations: "disabled" });
  await page.keyboard.press("Enter");
  await expect(q).toBeHidden();
  await expect(page).toHaveURL("/apps");
});

test("n does nothing while typing, and the pill is gone when nothing needs you", async ({ page }) => {
  await mockApi(page); await page.goto("/timeline");
  await page.getByRole("searchbox").fill("n");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calm = structuredClone(fixtureState); calm.headline = { ...calm.headline, needs: [] };
  await page.unrouteAll(); await mockApi(page, calm); await page.goto("/");
  await expect(page.locator(".q-pill")).toHaveCount(0);
});

test.describe("while you were away", () => {
  test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-30T07:42:00.000Z")); });

  test("back after hours: one line of what happened, what recovered, what still waits; dismissed, it goes", async ({ page }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem("set")) { localStorage.setItem("hetops-control.seen", String(Date.parse("2026-10-30T02:00:00.000Z"))); sessionStorage.setItem("set", "1"); } });
    await mockApi(page); await page.goto("/");
    const line = page.locator(".away");
    await expect(line).toContainText("Since Fri 02:00 UTC");
    await expect(line).toContainText("1 recovered on its own");
    await expect(line).toContainText("1 still waiting");
    await expect(line.locator("b.warm")).toHaveText("1 still waiting");   // ember only for what waits on you
    await page.screenshot({ path: "e2e/__screens__/away.png", animations: "disabled", clip: { x: 0, y: 0, width: 1366, height: 420 } });
    await line.getByRole("button", { name: "Dismiss" }).click();
    await expect(line).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".away")).toHaveCount(0);   // being here counts as seen
  });

  test("a short absence says nothing", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("hetops-control.seen", String(Date.parse("2026-10-30T07:00:00.000Z"))));
    await mockApi(page); await page.goto("/");
    await expect(page.locator(".headline")).toBeVisible();
    await expect(page.locator(".away")).toHaveCount(0);
  });
});

test("when the sign-in ends, the page says so, stops aging what it shows, and offers the way back", async ({ page }) => {
  await mockApi(page); await page.goto("/");
  await expect(page.locator(".live")).toContainText("live");
  // Access now answers everything with a redirect to its login page, as it does once the session has expired
  const login = { status: 302, headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/control.hetops.dev" } };
  await page.unroute("**/api/stream"); await page.unroute("**/api/state");
  await page.route("**/api/stream", r => r.fulfill(login)); await page.route("**/api/state", r => r.fulfill(login));
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const alert = page.locator(".signed-out");
  await expect(alert).toContainText("Your sign-in has ended.", { timeout: 70_000 });
  await expect(page.locator(".live")).toContainText("signed out · showing");
  await expect(alert.getByRole("button", { name: "Sign in again" })).toBeVisible();
});
