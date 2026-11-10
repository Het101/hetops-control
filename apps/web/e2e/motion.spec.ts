import { test, expect, type Page } from "@playwright/test";
import { deployHistory, mockApi, roughEvents, roughNight } from "./fixture.js";

// Fire line moves only what is live (docs/specs/2026-11-10-fire-line.md): a burning tree's flames, the rain on a tree being put out,
// the steam off one that just came back. Calm trees and the ground are still: there is no wind loop on the map.
const running = (page: Page, sel: string) => page.locator(sel).evaluateAll(els => els.flatMap(el => el.getAnimations({ subtree: true })).filter(x => x.playState === "running").length);

test("only live state moves: a burning tree's flames flicker, calm trees stand still", async ({ page }) => {
  await mockApi(page, roughNight(), roughEvents); await page.goto("/");
  await expect(page.locator('.tree[data-burn="fire"] .flames').first()).toBeAttached();
  expect(await running(page, '.tree[data-burn="fire"]')).toBeGreaterThan(0);
  expect(await running(page, '.tree[data-burn="calm"]')).toBe(0);
});

test("rain falls on the tree while an action on it runs, and the map says so", async ({ page }) => {
  const state = roughNight();
  await mockApi(page, state, roughEvents);
  const run = { id: "00000000-0000-4000-8000-000000000001", action: "k8s.restart", label: "Restart", server: "lab", target: "lab/app/chaos/chaos-api",
    targetName: "chaos-api", actor: "patel.x.het@gmail.com", params: {}, state: "running", at: new Date().toISOString() };
  await page.route("**/api/stream", r => r.fulfill({ contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ type: "state", state })}\n\ndata: ${JSON.stringify({ type: "action", run })}\n\n` }));
  await page.goto("/");
  const t = page.locator('.tree[data-entity="lab/app/chaos/chaos-api"]');
  await expect(t).toHaveAttribute("data-burn", "rain");
  await expect(t).toHaveAttribute("aria-label", "chaos-api, being put out: Restart running");
  await expect(t.locator(".flames")).toHaveCount(0);
  expect(await t.locator(".drop").count()).toBeGreaterThan(5);
  expect(await running(page, '.tree[data-burn="rain"]')).toBeGreaterThan(0);
});

test("the knock map's land is one static layer; its marks move on the same loop", async ({ page }) => {
  await mockApi(page, roughNight(), roughEvents); await page.goto("/security");
  const map = page.locator(".world").first();
  await expect(map.locator(".knock").first()).toBeAttached();
  expect(await map.locator("svg.land *").count()).toBe(1);
  const read = () => map.locator(".knock, .knock-ring, .scan").evaluateAll(els => els.map(el => `${el.getAttribute("transform")}|${el.getAttribute("fill-opacity") ?? el.getAttribute("stroke-opacity")}`));
  await page.waitForTimeout(400); const a = await read(); await page.waitForTimeout(300); const b = await read();
  expect(a.filter((x, i) => x !== b[i]).length).toBeGreaterThan(a.length / 2);
  expect(await map.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
});

test("the hero paints first and the modules that follow move nothing: no layout shift, wide or phone", async ({ page }) => {
  await mockApi(page, roughNight(), roughEvents);
  // every shift, with what moved and from where to where, so a failure says which element and by how much
  await page.addInitScript(() => {
    const w = window as unknown as { shifts: unknown[] }; w.shifts = [];
    const name = (n: Node | null) => { const el = n instanceof Element ? n : n?.parentElement; if (!el) return "?";
      const m = el.closest("[data-module]")?.getAttribute("data-module"); return `${m ? `[${m}] ` : ""}${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "").replace(/ /g, ".")}${n instanceof Text ? ` "${n.data.slice(0, 30)}"` : ""}`; };
    const r = (b: DOMRectReadOnly) => [b.x, b.y, b.width, b.height].map(Math.round).join(",");
    new PerformanceObserver(l => { for (const e of l.getEntries() as unknown as { value: number; startTime: number; hadRecentInput: boolean; sources: { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] }[])
      if (!e.hadRecentInput) w.shifts.push({ value: e.value, at: Math.round(e.startTime), sources: e.sources.map(s => `${name(s.node)} ${r(s.previousRect)} -> ${r(s.currentRect)}`) }); }).observe({ type: "layout-shift", buffered: true });
  });
  for (const [w, h] of [[1366, 900], [412, 823]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/"); await expect(page.locator('[data-module="sites"] .site').first()).toBeAttached();
    await page.waitForTimeout(500);
    const shifts = await page.evaluate(() => (window as unknown as { shifts: { value: number }[] }).shifts);
    const cls = shifts.reduce((n, s) => n + s.value, 0);
    // the only movement left is the top bar's "connecting" turning into "live · 0 s ago", a few millionths
    expect(cls, `layout shift at ${w}: ${JSON.stringify(shifts, null, 1)}`).toBeLessThan(.001);
  }
});

for (const how of ["os", "settings"] as const) {
  test(`reduced motion (${how}): the fire, rain and steam are still, and nothing else runs`, async ({ page }) => {
    await mockApi(page, roughNight(), roughEvents);
    if (how === "os") await page.emulateMedia({ reducedMotion: "reduce" });
    else { await page.goto("/settings"); await page.getByText("On", { exact: true }).click(); }
    await page.goto("/");
    await expect(page.locator('.tree[data-burn="fire"] .flames').first()).toBeAttached();
    await page.waitForTimeout(300);
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
