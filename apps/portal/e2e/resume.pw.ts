/**
 * Resume (task 029, exit criterion 1). Revisiting `/s/:sessionId` with the valid
 * httpOnly session cookie resumes at the current step: the SSR flow page renders
 * the step content again after a full reload, no client state required.
 */

import { expect, test } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";

test("reloading the flow page resumes the session from the cookie", async ({ page }) => {
  const { slug } = readFixtures();

  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText("Any at-fault accident in the last 3 years?")).toBeVisible();

  // A full reload re-runs the SSR flow page; the session cookie resumes the step.
  await page.reload();
  await expect(page).toHaveURL(/\/s\/ses_/);
  await expect(page.getByText("Any at-fault accident in the last 3 years?")).toBeVisible();
});
