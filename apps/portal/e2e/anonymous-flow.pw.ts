import { test, expect } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { COUNT_LABEL, chooseAccident, startAnonymousFlow } from "./support/flow.js";

/** Submit from the final step, then assert the completion page's content hash. */
async function submitAndExpectReceipt(page: Page): Promise<void> {
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);
  await expect(page.getByTestId("content-hash")).toHaveText(/^[0-9a-f]{64}$/);
}

test("anonymous at-fault-accident branch completes on a throttled mobile connection", async ({
  page,
}) => {
  const { slug } = readFixtures();

  const client = await page.context().newCDPSession(page);
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 200,
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (500 * 1024) / 8,
  });

  await startAnonymousFlow(page, slug);

  await chooseAccident(page, "Yes");
  await expect(page.getByText(COUNT_LABEL)).toBeVisible();
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");

  const count = page.getByRole("textbox", { name: /how many/i });
  await count.click();
  await count.pressSequentially("10");
  await page.getByRole("heading", { name: "Vehicle insurance quote" }).click();

  await submitAndExpectReceipt(page);
});

test("anonymous no-accident branch is ready to submit directly", async ({ page }) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);

  await chooseAccident(page, "No");

  await submitAndExpectReceipt(page);
});
