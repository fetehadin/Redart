import { expect, test } from "@playwright/test";
import { fakeInspect, PASSWORD, signUp } from "./helpers";

test.beforeEach(async ({ page }) => { await fakeInspect(page); });

test("signing up brings the guest's reading along", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("#ledger [data-id]").first();
  const title = (await first.locator("a").first().textContent())!;
  await first.getByRole("checkbox").check();
  await first.getByRole("textbox", { name: /Notes for/ }).fill("Read this on the train.");
  await page.waitForTimeout(600); // let the note save locally

  await signUp(page, "Ada");
  await page.goto("/");
  const row = page.locator("#ledger [data-id]").filter({ hasText: title });
  await expect(row.getByRole("checkbox")).toBeChecked();
  await expect(row.getByRole("textbox", { name: /Notes for/ })).toHaveValue("Read this on the train.");
  await expect(page.getByRole("region", { name: "Plan progress" })).toContainText("1 / 15");
});

test("a member's ledger follows them to another device", async ({ page, browser }) => {
  const { email } = await signUp(page, "Grace", { bringGuest: false });
  await page.goto("/");
  await page.getByLabel("Link").fill("example.com/sync");
  await page.getByLabel("Link").blur();
  await expect(page.getByLabel("Title")).toHaveValue("Fetched title");
  await page.getByRole("button", { name: "Add to ledger" }).click();
  await expect(page.locator("#ledger [data-id]").filter({ hasText: "Fetched title" })).toBeVisible();
  const row = page.locator("#ledger [data-id]").filter({ hasText: "Fetched title" });
  await row.getByRole("checkbox").check();
  await row.getByRole("textbox", { name: /Notes for/ }).fill("Synced note");

  // A fresh browser: nothing local, everything from the account.
  const other = await browser.newContext();
  const phone = await other.newPage();
  await fakeInspect(phone);
  await phone.goto("/signin");
  await phone.getByLabel("Email").fill(email);
  await phone.getByLabel("Password").fill(PASSWORD);
  await phone.getByRole("button", { name: "Sign in" }).click();
  await expect(phone.getByRole("region", { name: "Plan progress" })).toContainText("1 / 16");
  const synced = phone.locator("#ledger [data-id]").filter({ hasText: "Fetched title" });
  await expect(synced.getByRole("checkbox")).toBeChecked();
  await expect(synced.getByRole("textbox", { name: /Notes for/ })).toHaveValue("Synced note");
  await other.close();
});

test("wrong password says so, and signing out returns to the device's guest ledger", async ({ page }) => {
  const { email, handle } = await signUp(page, "Linus", { bringGuest: false });
  await page.getByRole("button", { name: `@${handle}` }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.locator("#ledger [data-id]")).toHaveCount(15);

  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
});

test("settings: profile, privacy and topics save", async ({ page }) => {
  const { handle } = await signUp(page, "Barbara", { bringGuest: false });
  await page.goto("/settings");
  await page.getByLabel("Name", { exact: true }).fill("Barbara L.");
  await page.getByLabel("About you").fill("Distributed systems and coffee.");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  await page.getByLabel(/Private\./).check();
  await expect(page.getByText("Your account is private now.")).toBeVisible();

  await page.getByLabel("Add a topic").fill("Postgres");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Save topics" }).click();
  await expect(page.getByText("Reading topics saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Barbara L.");
  await expect(page.getByLabel(/Private\./)).toBeChecked();
  await expect(page.getByRole("list", { name: "Your topics" })).toContainText("Postgres");
  await expect(page.getByRole("button", { name: `@${handle}` })).toBeVisible();
});

test("settings needs an account", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/signin\?next=%2Fsettings|\/signin\?next=\/settings/);
});
