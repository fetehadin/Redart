import { expect, test } from "@playwright/test";
import { newMember } from "./helpers";

test("a private reader approves a follower, who then sees their reading but never their notes", async ({ browser }) => {
  const ada = await newMember(browser, "Ada");
  const bob = await newMember(browser, "Bob");

  // Ada goes private and finishes an article with a note.
  await ada.page.goto("/settings");
  await ada.page.getByLabel(/Private\./).check();
  await expect(ada.page.getByText("Your account is private now.")).toBeVisible();
  await ada.page.goto("/");
  const row = ada.page.locator("#ledger [data-id]").first();
  const title = (await row.locator("a").first().textContent())!;
  await row.getByRole("checkbox").check();
  await row.getByRole("textbox", { name: /Notes for/ }).fill("Ada's private thoughts");
  await ada.page.waitForTimeout(1000);

  // Bob finds Ada and asks to follow.
  await bob.page.goto("/people");
  await bob.page.getByLabel("Search by name or handle").fill(ada.handle);
  await bob.page.getByRole("button", { name: "Ask to follow" }).click();
  await expect(bob.page.getByRole("button", { name: `Cancel follow request to @${ada.handle}` })).toBeVisible();
  await bob.page.goto(`/u/${ada.handle}`);
  await expect(bob.page.getByText("Your request is waiting.")).toBeVisible();

  // Ada accepts.
  await ada.page.goto("/people");
  await ada.page.getByRole("button", { name: "Accept" }).click();
  await expect(ada.page.getByText(`@${bob.handle} can now see your reading.`)).toBeVisible();

  // Bob sees what Ada read, but not her note.
  await bob.page.goto(`/u/${ada.handle}`);
  await expect(bob.page.getByRole("heading", { name: "Recently finished" })).toBeVisible();
  await expect(bob.page.getByRole("link", { name: title })).toBeVisible();
  await expect(bob.page.getByText("1 article").first()).toBeVisible();
  await expect(bob.page.getByText("Ada's private thoughts")).toHaveCount(0);

  await ada.context.close();
  await bob.context.close();
});

test("hiding a plan hides it from followers; blocking hides people from each other", async ({ browser }) => {
  const ada = await newMember(browser, "Ada");
  const bob = await newMember(browser, "Bob");

  await bob.page.goto(`/u/${ada.handle}`);
  await bob.page.getByRole("button", { name: "Follow" }).click();
  await expect(bob.page.getByRole("button", { name: `Unfollow @${ada.handle}` })).toBeVisible();
  await expect(bob.page.getByText("Backend & AI reading — 30 days")).toBeVisible();

  await ada.page.goto("/");
  await ada.page.getByText("Plan settings").click();
  await ada.page.getByLabel(/Show this plan and what I finish/).uncheck();
  await expect(ada.page.getByText("This plan is hidden from followers.")).toBeVisible();
  await ada.page.waitForTimeout(500);

  await bob.page.reload();
  await expect(bob.page.getByText("No plans to show yet.")).toBeVisible();

  await ada.page.goto(`/u/${bob.handle}`);
  await ada.page.getByRole("button", { name: "Block…" }).click();
  await ada.page.getByRole("button", { name: "Block", exact: true }).click();
  await expect(ada.page.getByRole("button", { name: "Unblock" })).toBeVisible();

  await bob.page.reload();
  await expect(bob.page.getByText("There's no page at this address.")).toBeVisible();

  await ada.context.close();
  await bob.context.close();
});

test("guests see only a profile's header", async ({ browser, page }) => {
  const ada = await newMember(browser, "Ada");
  await page.goto(`/u/${ada.handle}`);
  await expect(page.getByRole("heading", { name: "Ada" })).toBeVisible();
  await expect(page.getByText(`Sign in to see what @${ada.handle} is reading.`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to follow" })).toBeVisible();
  await ada.context.close();
});
