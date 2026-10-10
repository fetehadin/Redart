import { expect, type Browser, type Page } from "@playwright/test";

export const PASSWORD = "a long enough passphrase";
export const unique = () => Math.random().toString(36).slice(2, 8);

/** Answer link checks locally so tests don't depend on the internet. */
export async function fakeInspect(page: Page) {
  await page.route("**/api/inspect?*", (route) => route.fulfill({
    json: { url: "", checkedAt: new Date().toISOString(), status: "ok", message: "Link works.", title: "Fetched title", words: 1190, minutes: 5, confidence: "high" },
  }));
}

export async function signUp(page: Page, name: string, opts: { bringGuest?: boolean } = {}) {
  const handle = `${name.toLowerCase()}_${unique()}`;
  const email = `${handle}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Handle").fill(handle);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  const bring = page.getByLabel(/Bring the .* into my account/);
  if (opts.bringGuest === false && await bring.isVisible()) await bring.uncheck();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: `@${handle}` })).toBeVisible();
  return { handle, email };
}

/** A separate browser (its own cookies and storage) with a freshly signed-up member. */
export async function newMember(browser: Browser, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await fakeInspect(page);
  const who = await signUp(page, name, { bringGuest: false });
  return { context, page, ...who };
}
