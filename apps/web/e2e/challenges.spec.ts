import { expect, test } from "@playwright/test";
import { newMember, unique } from "./helpers";

test("create a challenge, join it at a pace, switch pace, appear on the leaderboard, and leave", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const ada = await newMember(browser, "Ada");
  const title = `Queues month ${unique()}`;

  // Ada builds a five-article challenge for next month.
  await ada.page.goto("/challenges/new");
  for (let i = 0; i < 5; i++) {
    await ada.page.getByLabel("Article link").fill(`https://example.com/queues-${i}`);
    await ada.page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(ada.page.locator("ol li")).toHaveCount(i + 1);
  }
  await ada.page.getByLabel("Title", { exact: true }).fill(title);
  await ada.page.getByLabel("Days").fill("7"); // light = 2, steady = 4, deep = all 5
  await ada.page.getByLabel("Topics").fill("Queues, Distributed systems");
  await ada.page.getByRole("button", { name: "Create challenge" }).click();
  await expect(ada.page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  // Guests can browse it.
  await page.goto("/challenges?when=upcoming");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("link", { name: "Sign in to join" })).toBeVisible();

  // Bob joins at the light pace and opts in to the leaderboard.
  const bob = await newMember(browser, "Bob");
  await bob.page.goto("/challenges?when=upcoming");
  await bob.page.getByRole("link", { name: title }).click();
  await bob.page.getByLabel(/^Light/).check();
  await bob.page.getByLabel(/Show my progress on the leaderboard/).check();
  await bob.page.getByRole("button", { name: "Join the challenge" }).click();
  await expect(bob.page.getByText("You're reading at the light pace.")).toBeVisible();

  // It's his active plan now, marked as part of the challenge.
  await bob.page.getByRole("button", { name: "Open in my ledger" }).click();
  await expect(bob.page.getByText(`Part of ${title}`)).toBeVisible();
  const rows = bob.page.locator("#ledger [data-id]");
  await expect(rows).toHaveCount(2);
  await rows.first().getByRole("checkbox").check();
  await bob.page.waitForTimeout(600);

  // Faster pace adds the rest of the list.
  await bob.page.goto(`/challenges/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
  await bob.page.getByText("Change pace").click();
  await bob.page.getByLabel(/^Deep/).check();
  await bob.page.getByRole("button", { name: "Switch pace" }).click();
  await expect(bob.page.getByText("You're reading at the deep pace.")).toBeVisible();
  await expect(bob.page.getByText("1 of 5 articles read")).toBeVisible();
  await expect(bob.page.getByRole("table").getByRole("link", { name: "Bob" })).toBeVisible();

  // Leaving keeps the plan.
  await bob.page.getByRole("button", { name: "Leave challenge…" }).click();
  await bob.page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(bob.page.getByRole("button", { name: "Join the challenge" })).toBeVisible();
  await bob.page.goto("/");
  await expect(bob.page.locator("#ledger [data-id]")).toHaveCount(5);
  await expect(bob.page.getByText(`Part of ${title}`)).toHaveCount(0);

  await ada.context.close();
  await bob.context.close();
});
