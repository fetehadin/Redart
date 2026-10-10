import { expect, test, type Page } from "@playwright/test";

/** Answer link checks locally so tests don't depend on the internet. */
async function fakeInspect(page: Page) {
  await page.route("**/api/inspect?*", async (route) => {
    const url = new URL(route.request().url()).searchParams.get("url") ?? "";
    await route.fulfill({
      json: { url, checkedAt: new Date().toISOString(), status: "ok", message: "Link works.", title: "Designing Data Pipelines", words: 2856, minutes: 12, confidence: "high" },
    });
  });
}

test.beforeEach(async ({ page }) => { await fakeInspect(page); });

test("a first-time guest gets the starter plan", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Plan progress" })).toContainText("0 / 15");
  await expect(page.locator("#ledger [data-id]")).toHaveCount(15);
});

test("guest adds an article from a link, and it survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Link").fill("example.com/pipelines");
  await page.getByLabel("Link").blur();
  await expect(page.getByLabel("Title")).toHaveValue("Designing Data Pipelines");
  await expect(page.getByLabel("Read time (minutes)")).toHaveValue("12");
  await expect(page.getByText("about 12 min read · 2,856 words")).toBeVisible();
  await page.getByRole("button", { name: "Add to ledger" }).click();

  const row = page.locator("#ledger [data-id]").filter({ hasText: "Designing Data Pipelines" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("12 min read (est.)");
  await expect(page.getByRole("region", { name: "Plan progress" })).toContainText("0 / 16");

  await page.reload();
  await expect(page.locator("#ledger [data-id]").filter({ hasText: "Designing Data Pipelines" })).toBeVisible();
});

test("ticking, notes and undoing a removal", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("#ledger [data-id]").first();
  await first.getByRole("checkbox").check();
  await expect(page.getByRole("region", { name: "Plan progress" })).toContainText("1 / 15");

  await first.getByRole("textbox", { name: /Notes for/ }).fill("Log-structured storage is everywhere.");
  await page.reload();
  await expect(page.locator("#ledger [data-id]").first().getByRole("textbox", { name: /Notes for/ })).toHaveValue("Log-structured storage is everywhere.");

  const second = page.locator("#ledger [data-id]").nth(1);
  const title = await second.locator("a").first().textContent();
  await second.getByRole("button", { name: /^Remove / }).click();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await expect(page.locator("#ledger [data-id]")).toHaveCount(14);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("#ledger [data-id]")).toHaveCount(15);
  await expect(page.locator("#ledger [data-id]").nth(1)).toContainText(title!);
});

test("a new plan can start from favourites", async ({ page }) => {
  await page.goto("/");
  await page.locator("#ledger [data-id]").first().getByRole("button", { name: "Save to favourites" }).click();
  await page.getByRole("button", { name: "New plan" }).click();
  await page.getByLabel("Plan name").first().fill("Favourites month");
  await page.getByLabel("Articles to start with").selectOption("favorites");
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByLabel("Plan", { exact: true })).toHaveValue(/.+/);
  await expect(page.locator("#ledger [data-id]")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Plan progress" })).toContainText("0 / 1");
});

test("the theme choice is applied before the page paints", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Theme:/ }).click(); // system -> light
  await page.getByRole("button", { name: /^Theme:/ }).click(); // light -> dark
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("pages ship a nonce-based CSP and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const res = await page.goto("/");
  expect(res!.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  await expect(page.locator("#ledger [data-id]")).toHaveCount(15);
  expect(errors).toEqual([]);
});
