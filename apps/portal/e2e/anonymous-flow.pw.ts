/**
 * Anonymous entry -> branching walkthrough -> submit -> completion (task 029,
 * exit criteria 1 and 5). Drives the portal against the composed API booted in
 * globalSetup, on Playwright's Pixel 7 mobile emulation.
 *
 * Branch model note (as-built): the API serves the full compiled step document
 * for the step (ADR-18: it never prunes the stored A2UI), and the @qcms/ui
 * renderer renders exactly that document, so both questions are always in the DOM.
 * The insurance branch is therefore observable through the *flow projection*, not
 * field mount/unmount: choosing "Yes" makes q_accident_count a visible required
 * question (the primary action stays "Continue" until it is answered), while
 * choosing "No" leaves it not-required and the form immediately ready ("Submit").
 * We assert the branch through that primary-action label, which is the honest
 * signal this build exposes.
 *
 * The "Yes" path additionally throttles the network (CDP
 * Network.emulateNetworkConditions) to prove the insurance fixture still completes
 * on a slow mobile connection (exit criterion 5).
 */

import { expect, test, type Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { COUNT_LABEL, chooseAccident, startAnonymousFlow } from "./support/flow.js";

/** Submit, then assert the completion page shows a 64-hex content hash. */
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

  // Throttle to a slow mobile profile before navigating (exit criterion 5).
  const client = await page.context().newCDPSession(page);
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 200,
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (500 * 1024) / 8,
  });

  await startAnonymousFlow(page, slug);

  // Choosing "Yes" makes the follow-up number question required: the branch keeps
  // the primary action on "Continue" until it is answered.
  await chooseAccident(page, "Yes");
  await expect(page.getByText(COUNT_LABEL)).toBeVisible();
  await expect(page.getByTestId("primary-action")).toHaveText("Continue");

  // Answer the number, then blur to post it (the branch is then satisfied ->
  // "Submit"). Type key-by-key: the react-aria NumberField is a controlled input
  // that commits per keystroke, so a real type registers where a one-shot fill
  // does not. The answer posts on the field's blur, and Tab would only move focus
  // to the field's own stepper button (still inside the field), so blur by
  // clicking a neutral heading to move focus fully out of the control.
  const count = page.getByRole("textbox", { name: /how many/i });
  await count.click();
  await count.pressSequentially("10");
  await page.getByRole("heading", { name: "Vehicle insurance quote" }).click();

  await submitAndExpectReceipt(page);
});

test("anonymous no-accident branch is ready to submit directly", async ({ page }) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);

  // Choosing "No" leaves the follow-up not-required, so the form is immediately
  // ready: the primary action flips to "Submit" with no further answers.
  await chooseAccident(page, "No");

  await submitAndExpectReceipt(page);
});
