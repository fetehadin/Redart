import { expect, test } from "@playwright/test";
import { newMember } from "./helpers";

test("a follower sees finished reading in their feed, adds it to their plan, and gets a recommendation in their inbox", async ({ browser }) => {
  test.setTimeout(120_000);
  const ada = await newMember(browser, "Ada");
  const bob = await newMember(browser, "Bob");

  await bob.page.goto("/feed");
  await expect(bob.page.getByRole("heading", { name: "Nobody to follow yet" })).toBeVisible();
  await bob.page.goto(`/u/${ada.handle}`);
  await bob.page.getByRole("button", { name: "Follow" }).click();
  await expect(bob.page.getByRole("button", { name: `Unfollow @${ada.handle}` })).toBeVisible();

  // Ada finishes an article from a second plan, so it's new to Bob.
  await ada.page.goto("/");
  await ada.page.getByRole("button", { name: "New plan" }).click();
  await ada.page.getByLabel("Plan name").first().fill("Ada's picks");
  await ada.page.getByRole("button", { name: "Create plan" }).click();
  await ada.page.getByLabel("Link").fill("example.com/ada-pick");
  await ada.page.getByLabel("Link").blur();
  await expect(ada.page.getByLabel("Title")).toHaveValue("Fetched title");
  await ada.page.getByRole("button", { name: "Add to ledger" }).click();
  const row = ada.page.locator("#ledger [data-id]").filter({ hasText: "Fetched title" });
  await row.getByRole("checkbox").check();
  await ada.page.waitForTimeout(600);

  await bob.page.goto("/feed");
  const entry = bob.page.locator("li").filter({ hasText: "finished reading" });
  await expect(entry).toContainText("Fetched title");
  await entry.getByRole("button", { name: "Add to my plan" }).click();
  await expect(entry.getByText("In your plan ✓")).toBeVisible();
  await bob.page.goto("/");
  await expect(bob.page.locator("#ledger [data-id]").filter({ hasText: "Fetched title" })).toBeVisible();

  // Ada recommends it to Bob directly (he follows her).
  await ada.page.reload();
  await row.getByRole("button", { name: "Recommend Fetched title" }).click();
  await ada.page.getByLabel("Recommend to").selectOption(bob.handle);
  await ada.page.getByLabel("Why it's worth reading (optional)").fill("Short and very clear.");
  await ada.page.getByRole("button", { name: "Recommend", exact: true }).click();
  await expect(ada.page.getByText(`Sent to @${bob.handle}.`)).toBeVisible();

  await bob.page.goto("/");
  await expect(bob.page.getByRole("link", { name: "Inbox, 1 new" })).toBeVisible();
  await bob.page.getByRole("link", { name: "Inbox, 1 new" }).click();
  await expect(bob.page.getByText("recommended something for you.")).toBeVisible();
  await expect(bob.page.getByText("Short and very clear.")).toBeVisible();
  await expect(bob.page.getByRole("link", { name: "Inbox", exact: true })).toBeVisible(); // badge cleared

  await ada.context.close();
  await bob.context.close();
});
