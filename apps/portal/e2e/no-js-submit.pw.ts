/**
 * No-JS submission, end to end (task 044, exit criterion 1). With JavaScript
 * disabled the whole way, the respondent starts the vehicle-insurance fixture,
 * answers the at-fault-accident branch, and submits - each step a native
 * `<form method="post">` POST with a full page reload - landing on the completion
 * receipt (submittedAt + contentHash).
 *
 * The "No" branch is the path it takes: answer -> the branch keeps the follow-up
 * hidden and the flow is immediately ready -> submit, which exercises
 * start -> answer -> branch -> submit end to end with no JavaScript in play in the
 * fewest round trips. The "Yes" branch used to be unreachable here - the follow-up
 * "How many?" was a react-aria NumberField whose editable input needed JavaScript to
 * sync its form value - and since issue #18 it is not: `no-js-number.pw.ts` walks it.
 */

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
