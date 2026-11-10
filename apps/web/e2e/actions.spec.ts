import { test, expect, type Page } from "@playwright/test";
import type { ActionRun, Entity } from "@hetops-control/contracts";
import { fixtureState, mockApi } from "./fixture.js";

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-30T07:42:00.000Z")); });
const at = "2026-10-30T07:42:00.000Z";
const params = { type: "object" as const, properties: {}, additionalProperties: false as const };

function withSync(risk: "safe" | "disruptive" = "safe") {
  const s = structuredClone(fixtureState);
  const app = s.entities.find(e => e.kind === "argo-app" && e.server === "lab") as Entity;
  Object.assign(app, { status: "attention", statusReason: "OutOfSync for 14 min", actions: [{ id: "argo.sync", label: "Sync", risk }] });
  app.facts.sync = { value: "OutOfSync" };
  s.actions = [{ server: "lab", id: "argo.sync", label: "Sync", description: "Asks Argo CD to sync.", targets: ["argo-app"], risk, preview: true, params }];
  s.headline = { ...s.headline, needs: [{ entity: app.id, server: "lab", text: `${app.name} on lab`, detail: "OutOfSync for 14 min", action: app.actions[0] }] };
  return { s, app };
}
type Verb = { action: string; label: string; server: "lab" | "ops" };
const SYNC: Verb = { action: "argo.sync", label: "Sync", server: "lab" };
// end: what the stream brings next (null: nothing, the run stays running)
async function wire(page: Page, app: Entity, end: Partial<ActionRun> | null = { state: "succeeded", finishedAt: at, result: { ok: true, summary: "Sync started" } }, verb = SYNC) {
  const sent: { kind: string; headers: Record<string, string>; body: any }[] = [];
  await page.route("**/api/actions/preview", r => { sent.push({ kind: "preview", headers: r.request().headers(), body: r.request().postDataJSON() });
    return r.fulfill({ json: { text: `Syncs ${app.name} on lab to main. Nothing is pruned.` } }); });
  await page.route("**/api/actions", async r => {
    const headers = r.request().headers(); sent.push({ kind: "run", headers, body: r.request().postDataJSON() });
    const run: ActionRun = { id: headers["idempotency-key"]!, ...verb, target: app.id, targetName: app.name,
      actor: "het@hetops.dev", params: {}, state: "running", at };
    // the stream's next connection (retry 100 ms) carries the result, as the center would
    await page.unroute("**/api/stream");
    let told = false;   // like the center, the result goes out once; later connections carry nothing new
    await page.route("**/api/stream", rr => { const first = !told; told = true;
      return rr.fulfill({ contentType: "text/event-stream", body: `retry: 100\n${first && end ? `data: ${JSON.stringify({ type: "action", run: { ...run, ...end } })}\n` : ""}\n` }); });
    return r.fulfill({ status: 202, json: { run } });
  });
  return sent;
}

test("a safe action: the exact preview, one confirming click, live progress and the result", async ({ page }) => {
  const { s, app } = withSync(); await mockApi(page, s); const sent = await wire(page, app);
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  const dlg = page.getByRole("dialog", { name: `Sync ${app.name}` });
  await expect(dlg).toContainText(`Syncs ${app.name} on lab to main. Nothing is pruned.`);
  await dlg.getByRole("button", { name: "Sync", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator(".toast")).toContainText(`${app.name} on lab`);
  await expect(page.locator(".toast")).toContainText("Sync started", { timeout: 10_000 });
  const run = sent.find(x => x.kind === "run")!;
  expect(run.headers["x-hetops-action"]).toBe("1");
  expect(run.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(run.body).toEqual({ action: "argo.sync", target: app.id, params: {} });
});

test("the confirm button waits for the preview, and focus stays in the dialog", async ({ page }) => {
  const { s, app } = withSync(); await mockApi(page, s);
  let answer!: () => void; const held = new Promise<void>(r => (answer = r));
  await page.route("**/api/actions/preview", async r => { await held; return r.fulfill({ json: { text: "Syncs it." } }); });
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  const dlg = page.getByRole("dialog"); const go = dlg.getByRole("button", { name: "Sync", exact: true });
  await expect(dlg).toContainText("what will happen");
  await expect(go).toBeDisabled();
  answer(); await expect(dlg).toContainText("Syncs it."); await expect(go).toBeEnabled();
  // the modal makes the page inert: Tab cycles through the dialog (and the browser's own UI), never the page behind it
  await page.evaluate(() => { (window as any).outside = 0; (window as any).inside = 0;
    document.addEventListener("focusin", e => { (e.target as Element).closest("dialog.act-dlg") ? (window as any).inside++ : (window as any).outside++; }); });
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => [(window as any).inside > 2, (window as any).outside])).toEqual([true, 0]);
});

test("cancel asks nothing", async ({ page }) => {
  const { s, app } = withSync(); await mockApi(page, s); const sent = await wire(page, app);
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(sent.filter(x => x.kind === "run")).toEqual([]);
});

test("a disruptive action needs the target's name typed", async ({ page }) => {
  const { s, app } = withSync("disruptive"); await mockApi(page, s); const sent = await wire(page, app);
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  const dlg = page.getByRole("dialog"); const go = dlg.getByRole("button", { name: "Sync", exact: true });
  await expect(dlg).toContainText("Nothing is pruned.");
  await expect(go).toBeDisabled();
  await dlg.getByRole("textbox").fill(app.name.toUpperCase()); await expect(go).toBeDisabled();
  await dlg.getByRole("textbox").fill(app.name); await go.click();
  await expect(dlg).toBeHidden();
  expect(sent.find(x => x.kind === "run")!.body.confirm).toBe(app.name);
});

test("a refused start stays in the dialog with the center's reason", async ({ page }) => {
  const { s, app } = withSync(); await mockApi(page, s); await wire(page, app);
  await page.route("**/api/actions", r => r.fulfill({ status: 429, headers: { "retry-after": "42" }, json: { error: "rate limited; try again in 42 s" } }));
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText("Nothing is pruned.");
  await dlg.getByRole("button", { name: "Sync", exact: true }).click();
  await expect(dlg.getByRole("alert")).toHaveText("rate limited; try again in 42 s");
  await expect(dlg).toBeVisible();
});

test("a failed run's toast is ember, reads in plain words, and stays until dismissed", async ({ page }) => {
  const { s, app } = withSync(); await mockApi(page, s);
  await wire(page, app, { state: "failed", finishedAt: at, error: "no answer in 60 s; the result is unknown, check " + app.name });
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sync", exact: true }).click();
  const toast = page.locator(".toast");
  await expect(toast).toHaveAttribute("data-tone", "failed", { timeout: 10_000 });
  await expect(toast.locator(".toast-h")).toHaveText("No answer from lab");
  await expect(toast.locator(".toast-why")).toHaveText(`No answer in 60 s; the result is unknown, check ${app.name}`);
  expect(await toast.locator(".tg").evaluate(el => getComputedStyle(el).stroke)).toBe("rgb(240, 88, 42)");   // ember, only here
  await page.waitForTimeout(7000);   // longer than a success stays
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Dismiss No answer from lab" }).click();
  await expect(toast).toHaveCount(0);
});

test("Needs you opens the same dialog; a knob without an offer stays dimmed and opens nothing", async ({ page }) => {
  const { s, app } = withSync(); await mockApi(page, s); await wire(page, app);
  await page.goto("/");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  await expect(page.getByRole("dialog", { name: `Sync ${app.name}` })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/apps");   // the fixture's other Argo apps offer nothing
  const knob = page.locator(".knob.act[aria-disabled='true']").first();
  await expect(knob).toHaveAttribute("aria-label", /not offered for this one/);
  await knob.click({ force: true }); await expect(page.getByRole("dialog")).toBeHidden();   // force: Playwright refuses aria-disabled itself
  // the two never look alike: the one that can run names its verb on a surface; the one that can't has no surface, a dashed ring
  const can = page.getByRole("button", { name: `Sync ${app.name}`, exact: true });
  await expect(can).toHaveText("Sync");
  expect(await can.evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");   // a filled surface
  expect(await knob.evaluate(e => [getComputedStyle(e).boxShadow, getComputedStyle(e).borderStyle])).toEqual(["none", "dashed"]);
  await expect(knob).toHaveText("");
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator(".grid").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: "e2e/__screens__/knobs-can-and-cant.png", animations: "disabled" });
});

test("an acknowledged check shows who and until when, in silver", async ({ page }) => {
  const s = structuredClone(fixtureState);
  const c = s.entities.find(e => e.kind === "site" || e.kind === "check")!;
  Object.assign(c, { status: "down", statusReason: "HTTP 502" });
  s.acks = [{ entity: c.id, server: c.server, status: "down", actor: "het@hetops.dev", at, until: "2026-10-30T11:42:00.000Z", note: "deploying" }];
  await mockApi(page, s);
  await page.goto("/alerts");
  const row = page.locator(".row", { hasText: "acknowledged by" });
  await expect(row).toContainText("acknowledged by het@hetops.dev until 11:42 UTC · deploying");
  await expect(row).not.toHaveClass(/\bnow\b/);
});

// the owner's first live run: Backups → nightly-all → Snapshot now, answered with the snapshot's name
const SNAP: Verb = { action: "snapshot.now", label: "Snapshot now", server: "ops" };
const SNAPSHOT = "nightly-all-2026.10.31-sj23udz2tsmlglae5shriw";
const started: Partial<ActionRun> = { state: "succeeded", finishedAt: at, result: { ok: true, summary: "Snapshot started", ref: SNAPSHOT } };
function withSnapshot() {
  const s = structuredClone(fixtureState);
  const b = s.entities.find(e => e.kind === "backup" && e.name === "nightly-all") as Entity;
  b.actions = [{ id: "snapshot.now", label: "Snapshot now", risk: "safe" }];
  s.actions = [{ server: "ops", id: "snapshot.now", label: "Snapshot now", description: "Runs the snapshot policy once, now.", targets: ["backup"], risk: "safe", preview: true, params }];
  return { s, b };
}
async function snapshot(page: Page, end: Partial<ActionRun> | null) {
  const { s, b } = withSnapshot(); await mockApi(page, s); await wire(page, b, end, SNAP);
  await page.goto("/backups");
  await page.getByRole("button", { name: "Snapshot nightly-all now" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Snapshot now", exact: true }).click();
  return page.locator(".toast");
}

test("a run's toast goes from running to done in place, then leaves by itself", async ({ page }) => {
  const toast = await snapshot(page, started);
  await expect(toast).toHaveCount(1);
  await expect(toast.locator(".toast-h")).toHaveText("Snapshot started", { timeout: 10_000 });
  await expect(toast).toHaveCount(1);   // the same card, changed in place
  await expect(toast).toHaveAttribute("data-tone", "done");
  await expect(toast.locator(".toast-l")).toHaveText("nightly-all on ops · 07:42 UTC");
  await expect(toast.locator(".toast-life")).toBeAttached();
  await expect(toast).toHaveCount(0, { timeout: 9000 });
});

test("a running toast is quiet silver, has no dismiss, and no link to the page it is on", async ({ page }) => {
  const toast = await snapshot(page, null);
  await expect(toast.locator(".toast-h")).toHaveText("Snapshot now…");
  await expect(toast).toHaveAttribute("data-tone", "running");
  await expect(toast.getByRole("button", { name: /Dismiss/ })).toHaveCount(0);
  await expect(toast.getByRole("link")).toHaveCount(0);   // already on Backups
  expect(await toast.locator(".tg").evaluate(el => getComputedStyle(el).stroke)).toBe("rgb(180, 180, 185)");
});

test("hovering holds a success; leaving lets it go", async ({ page }) => {
  const toast = await snapshot(page, started);
  await expect(toast.locator(".toast-h")).toHaveText("Snapshot started", { timeout: 10_000 });
  await toast.hover();
  await expect(toast).toHaveAttribute("data-held", "");
  await page.waitForTimeout(7000);
  await expect(toast).toBeVisible();
  await page.mouse.move(10, 10);
  await expect(toast).toHaveCount(0, { timeout: 9000 });
});

test("the ref is truncated in the middle, whole in its tooltip, copies, and the next step leads to Backups", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const toast = await snapshot(page, started);
  await expect(toast.locator(".toast-h")).toHaveText("Snapshot started", { timeout: 10_000 });
  await toast.hover();   // hold it while we look
  const ref = toast.locator(".toast-ref .mono");
  await expect(ref).toHaveText("nightly-all-2026.10.31-sj23…5shriw");
  await expect(ref).toHaveAttribute("title", SNAPSHOT);
  expect(await ref.evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(20);   // one line, never wrapped
  await toast.getByRole("button", { name: "Copy the snapshot name" }).click();
  await expect(toast.getByRole("button", { name: "Copied the snapshot name" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SNAPSHOT);
  await page.getByRole("link", { name: "Apps", exact: true }).click();   // the rail
  await toast.getByRole("link", { name: "View in Backups" }).click();
  await expect(page).toHaveURL(/\/backups$/);
});

test("a failure is announced assertively", async ({ page }) => {
  await snapshot(page, { state: "failed", finishedAt: at, error: "Elasticsearch did not name the snapshot" });
  await expect(page.getByRole("alert")).toHaveText("Snapshot now failed. Elasticsearch did not name the snapshot. nightly-all on ops · 07:42 UTC", { timeout: 10_000 });
});

test("at most three toasts; older ones fold into one line", async ({ page }) => {
  const { s, app } = withSync(); await mockApi(page, s);
  // four failed runs through the stream, as four runs on four targets would arrive
  const four = [0, 1, 2, 3].map(i => ({ id: `0000000${i}-1111-4111-8111-111111111111`, ...SYNC, target: app.id, targetName: `app-${i}`, actor: "het@hetops.dev",
    params: {}, state: "failed", at, finishedAt: at, error: "refused" }));
  await page.unroute("**/api/stream");
  await page.route("**/api/stream", r => r.fulfill({ contentType: "text/event-stream",
    body: `retry: 100000\n\n${four.map(x => `data: ${JSON.stringify({ type: "action", run: x })}\n\n`).join("")}` }));
  await page.goto("/apps");
  await expect(page.locator(".toast")).toHaveCount(3, { timeout: 10_000 });
  await expect(page.locator(".toast").first()).toContainText("app-3");
  await page.getByRole("button", { name: "1 earlier" }).click();
  await expect(page.locator(".toast")).toHaveCount(4);
});

test("reduced motion: toasts arrive and leave without animating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const toast = await snapshot(page, started);
  await expect(toast.locator(".toast-h")).toHaveText("Snapshot started", { timeout: 10_000 });
  expect(await toast.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(toast.locator(".toast-life")).toHaveCount(0);   // the countdown line is motion too; the timer still runs
  await toast.getByRole("button", { name: "Dismiss Snapshot started" }).click();
  await expect(toast).toHaveCount(0);
});

test.describe("toast screenshots", () => {
  for (const [w, h] of [[1366, 900], [390, 844]] as const) {
    test(`running, done and failed at ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      let toast = await snapshot(page, null);
      await expect(toast).toHaveAttribute("data-tone", "running"); await page.waitForTimeout(500);
      await page.screenshot({ path: `e2e/__screens__/toast-running-${w}.png` });

      await page.unrouteAll(); toast = await snapshot(page, started);
      await expect(toast).toHaveAttribute("data-tone", "done", { timeout: 10_000 }); await page.waitForTimeout(1200);
      await page.screenshot({ path: `e2e/__screens__/toast-done-${w}.png` });

      await page.unrouteAll(); toast = await snapshot(page, { state: "failed", finishedAt: at, error: "no answer in 60 s; the result is unknown, check nightly-all" });
      await expect(toast).toHaveAttribute("data-tone", "failed", { timeout: 10_000 }); await page.waitForTimeout(500);
      await page.screenshot({ path: `e2e/__screens__/toast-failed-${w}.png` });
    });
  }
});

test("a toggle is the app's own control, not the browser's white box, and its label flips it", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { s, app } = withSync(); s.actions![0]!.params = { type: "object", additionalProperties: false,
    properties: { hard: { type: "boolean", default: false, description: "Also drop Argo CD's cached manifests (a hard refresh)" } } };
  await mockApi(page, s); const sent = await wire(page, app);
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  const box = page.getByRole("dialog").getByRole("checkbox", { name: "Hard" });
  expect(await box.evaluate(e => getComputedStyle(e).appearance)).toBe("none");
  await page.screenshot({ path: "e2e/__screens__/action-toggle-off.png", animations: "disabled" });
  await page.getByRole("dialog").getByText("Hard", { exact: true }).click();
  await expect(box).toBeChecked();
  await page.screenshot({ path: "e2e/__screens__/action-toggle-on.png", animations: "disabled" });
  await page.getByRole("dialog").getByRole("button", { name: "Sync", exact: true }).click();
  await expect.poll(() => sent.find(x => x.kind === "run")?.body.params).toEqual({ hard: true });
});

test.describe("screenshots", () => {
  const silence = { type: "object" as const, additionalProperties: false as const, properties: {
    hours: { type: "string" as const, enum: ["1", "4", "24"], default: "4", description: "For how long, in hours" },
    note: { type: "string" as const, maxLength: 200, description: "Why (shown beside it)" } } };
  test("the dialog: base and disruptive", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const { s, app } = withSync(); s.actions![0]!.params = silence; await mockApi(page, s); await wire(page, app);
    await page.goto("/apps");
    await page.getByRole("button", { name: `Sync ${app.name}` }).click();
    await expect(page.getByRole("dialog")).toContainText("Nothing is pruned.");
    await page.screenshot({ path: "e2e/__screens__/action-dialog.png", animations: "disabled" });

    const d = withSync("disruptive"); await page.unrouteAll(); await mockApi(page, d.s); await wire(page, d.app);
    await page.goto("/apps");
    await page.getByRole("button", { name: `Sync ${d.app.name}` }).click();
    await expect(page.getByRole("dialog")).toContainText("Nothing is pruned.");
    await page.getByRole("dialog").getByRole("textbox").fill(d.app.name.slice(0, 3));
    await page.screenshot({ path: "e2e/__screens__/action-dialog-disruptive.png", animations: "disabled" });

  });
});
