import { expect, test } from "./support/gates.js";

import { readFixtures } from "./support/fixtures.js";

test.use({ javaScriptEnabled: false });

test("the flow page SSR-renders real step content with JavaScript disabled", async ({ page }) => {
  const { slug } = readFixtures();

  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);

  await expect(page.getByText("Any at-fault accident in the last 3 years?")).toBeVisible();
});
