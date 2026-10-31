import { test, expect, type Page } from "@playwright/test";
import { deployHistory, mockApi, roughEvents, roughNight } from "./fixture.js";

// the forest's wind writes transform attributes from one rAF loop; read a limb, the crown and the grass twice
const sample = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('svg.forest [data-wind="pivot"], svg.forest [data-wind="grass"]')].slice(0, 12).map(el => el.getAttribute("transform")));

test("the forest moves by default: the wind changes its transforms over time", async ({ page }) => {
  await mockApi(page, roughNight(), roughEvents); await page.goto("/");
  await expect(page.locator(".limb").first()).toBeAttached();
  await page.waitForTimeout(400);
  const a = await sample(page);
  await page.waitForTimeout(700);
  const b = await sample(page);
  expect(a.every(t => t !== null)).toBe(true);
  expect(b).not.toEqual(a);
  // the roots breathe and the wind streaks exist only while motion is on
  await expect(page.locator(".streak")).toHaveCount(5);
  expect(await page.evaluate(() => document.getAnimations().filter(x => x.playState === "running").length)).toBeGreaterThan(0);
});

test("the embers and falling leaves ride the same 30 Hz loop, not CSS animations", async ({ page }) => {
  await mockApi(page, roughNight(), roughEvents); await page.goto("/");
  await expect(page.locator(".ember-p").first()).toBeAttached();
  const read = () => page.evaluate(() => [...document.querySelectorAll("svg.forest .ember-p, svg.forest .fall")].map(el => `${el.getAttribute("transform")}|${el.getAttribute("fill-opacity")}`));
  // each particle waits out its seeded delay (up to 3 s for an ember), then moves
  await page.waitForTimeout(3500);
  const a = await read(); await page.waitForTimeout(300); const b = await read();
  expect(a.filter((x, i) => x !== b[i]).length).toBeGreaterThan(a.length / 2);
  expect(await page.evaluate(() => [...document.querySelectorAll("svg.forest .ember-p, svg.forest .fall")].flatMap(el => el.getAnimations()).length)).toBe(0);
});

test("a restart that arrives live shakes one ember leaf loose: it falls on the loop, then is gone", async ({ page }) => {
  const state = roughNight();
  await mockApi(page, state, roughEvents);
  const restart = { at: new Date().toISOString(), server: "lab", source: "kubernetes", kind: "restart", entity: "lab/app/chaos/chaos-api", summary: "chaos-api restarted" };
  await page.route("**/api/stream", r => r.fulfill({ contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ type: "state", state })}\n\ndata: ${JSON.stringify({ type: "event", event: restart })}\n\n` }));
  await page.goto("/");
  const drop = page.locator("svg.forest .drop").first();
  await expect(drop).toBeAttached();
  await page.waitForTimeout(600);
  const t = await drop.getAttribute("transform");
  expect(t).toMatch(/rotate\([\d.]+ [\d.]+ [\d.]+\)$/); // it spins about its own centre
  expect(Number(await drop.getAttribute("fill-opacity"))).toBeGreaterThan(0);
  expect(await drop.evaluate(el => el.getAnimations().length)).toBe(0);
  await expect(page.locator("svg.forest .drop")).toHaveCount(0, { timeout: 6000 });
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
  test(`reduced motion (${how}): the forest is still and the weather is gone`, async ({ page }) => {
    await mockApi(page, roughNight(), roughEvents);
    if (how === "os") await page.emulateMedia({ reducedMotion: "reduce" });
    else { await page.goto("/settings"); await page.getByText("On", { exact: true }).click(); }
    await page.goto("/");
    await expect(page.locator(".limb").first()).toBeAttached();
    const a = await sample(page);
    await page.waitForTimeout(700);
    expect(await sample(page)).toEqual(a);
    expect(a.every(t => t === null)).toBe(true);
    await expect(page.locator(".streak, .mote, .scan")).toHaveCount(0);
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
