/**
 * No-JS submission, end to end (task 044, exit criterion 1). With JavaScript
 * disabled the whole way, the respondent starts the vehicle-insurance fixture,
 * answers the at-fault-accident branch, and submits - each step a native
 * `<form method="post">` POST with a full page reload - landing on the completion
 * receipt (submittedAt + contentHash).
 *
 * The fixture's follow-up "How many?" is a react-aria NumberField whose editable
 * input needs JavaScript to sync its form value, so the no-JS completion path is
 * the "No" branch (the boolean is a native radio that serializes without JS):
 * answer -> the branch keeps the follow-up hidden and the flow immediately ready
 * -> submit. This exercises start -> answer -> branch -> submit end to end with no
 * JavaScript in play.
 */

import { expect, test } from "./support/gates.js";

import { ACCIDENT_LABEL, FORM_HEADING } from "./support/flow.js";
import { readFixtures } from "./support/fixtures.js";

test.use({ javaScriptEnabled: false });

test("a JS-disabled respondent completes and submits the fixture via native form POSTs", async ({
  page,
}) => {
  const { slug } = readFixtures();

  // Start: the entry Start control is a native form POST to the BFF (029).
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);

  // The step SSR-paints the real question inside a natively submittable form.
  await expect(page.getByRole("heading", { name: FORM_HEADING })).toBeVisible();
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();

  // Answer "No" by clicking the visible option label (the real radio input sits
  // under a decorative indicator). Native label association checks it without JS.
  await page.getByText("No", { exact: true }).click();

  // Submit the whole step: a native <button type=submit> POSTs the form to the
  // BFF /step route, which forwards the answer, sees the flow is ready, submits
  // the session, and 303-redirects to the receipt. A full page reload, no JS.
  await page.locator('form button[type="submit"]').click();

  await page.waitForURL(/\/done/);
  await expect(page.getByTestId("content-hash")).toHaveText(/^[0-9a-f]{64}$/);
});
