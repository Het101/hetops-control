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
async function wire(page: Page, app: Entity, end: Partial<ActionRun> = { state: "succeeded", finishedAt: at, result: { ok: true, summary: `sync of ${app.name} started` } }) {
  const sent: { kind: string; headers: Record<string, string>; body: any }[] = [];
  await page.route("**/api/actions/preview", r => { sent.push({ kind: "preview", headers: r.request().headers(), body: r.request().postDataJSON() });
    return r.fulfill({ json: { text: `Syncs ${app.name} on lab to main. Nothing is pruned.` } }); });
  await page.route("**/api/actions", async r => {
    const headers = r.request().headers(); sent.push({ kind: "run", headers, body: r.request().postDataJSON() });
    const run: ActionRun = { id: headers["idempotency-key"]!, action: "argo.sync", label: "Sync", server: "lab", target: app.id, targetName: app.name,
      actor: "het@hetops.dev", params: {}, state: "running", at };
    // the stream's next connection (retry 100 ms) carries the result, as the center would
    await page.unroute("**/api/stream");
    let told = false;   // like the center, the result goes out once; later connections carry nothing new
    await page.route("**/api/stream", rr => { const first = !told; told = true;
      return rr.fulfill({ contentType: "text/event-stream", body: `retry: 100\n${first ? `data: ${JSON.stringify({ type: "action", run: { ...run, ...end } })}\n` : ""}\n` }); });
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
  await expect(page.locator(".toast")).toContainText(app.name);
  await expect(page.locator(".toast")).toContainText(`sync of ${app.name} started`, { timeout: 10_000 });
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

test("a failed run's toast is ember and stays until dismissed", async ({ page }) => {
  const { s, app } = withSync(); await mockApi(page, s);
  await wire(page, app, { state: "failed", finishedAt: at, error: "no answer in 60 s; the result is unknown, check " + app.name });
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sync", exact: true }).click();
  const toast = page.locator(".toast");
  await expect(toast).toHaveClass(/warm/, { timeout: 10_000 });
  await expect(toast).toContainText("the result is unknown");
  await toast.getByRole("button", { name: "Dismiss" }).click();
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

test("reduced motion: toasts appear without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { s, app } = withSync(); await mockApi(page, s); await wire(page, app);
  await page.goto("/apps");
  await page.getByRole("button", { name: `Sync ${app.name}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sync", exact: true }).click();
  await expect(page.locator(".toast")).toBeVisible();
  expect(await page.locator(".toast").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
});

test.describe("screenshots", () => {
  const silence = { type: "object" as const, additionalProperties: false as const, properties: {
    hours: { type: "string" as const, enum: ["1", "4", "24"], default: "4", description: "For how long, in hours" },
    note: { type: "string" as const, maxLength: 200, description: "Why (shown beside it)" } } };
  test("the dialog: base, disruptive, and a failed toast", async ({ page }) => {
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

    const f = withSync(); await page.unrouteAll(); await mockApi(page, f.s);
    await wire(page, f.app, { state: "failed", finishedAt: at, error: `no answer in 60 s; the result is unknown, check ${f.app.name}` });
    await page.goto("/apps");
    await page.getByRole("button", { name: `Sync ${f.app.name}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sync", exact: true }).click();
    await expect(page.locator(".toast.warm")).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: "e2e/__screens__/action-failed.png", animations: "disabled" });
  });
});
