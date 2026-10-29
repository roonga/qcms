import { expect, test } from "./support/gates.js";

import { ACCIDENT_LABEL, FORM_HEADING } from "./support/flow.js";
import { readFixtures } from "./support/fixtures.js";
import { stepSubmit } from "./support/no-js.js";

test.use({ javaScriptEnabled: false });

test("a JS-disabled respondent completes and submits the fixture via native form POSTs", async ({
  page,
}) => {
  const { slug } = readFixtures();

  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);

  await expect(page.getByRole("heading", { name: FORM_HEADING })).toBeVisible();
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();

  await page.getByText("No", { exact: true }).click();

  await stepSubmit(page).click();

  await page.waitForURL(/\/done/);
  await expect(page.getByTestId("content-hash")).toHaveText(/^[0-9a-f]{64}$/);
});
