/**
 * Anonymous entry -> branching walkthrough -> submit -> completion (task 029,
 * updated for explicit navigation, ADR-28 / task 045). Drives the portal against
 * the composed API booted in globalSetup, on Playwright's Pixel 7 mobile
 * emulation.
 *
 * Branch model note (as-built): the insurance fixture is a SINGLE visible step, so
 * the primary action is always "Submit" (Submit appears only on the final step,
 * and the only step is the final one). The API serves the full compiled step
 * document (ADR-18) and the @qcms/ui renderer renders exactly that, so both
 * questions are in the DOM; the branch is observable through the *flow
 * projection*: choosing "Yes" makes q_accident_count a visible required question
 * (a Submit is then blocked with the error summary until it is answered), while
 * choosing "No" leaves it not-required and the form immediately submittable.
 * Answering never advances or collapses the step (ADR-28).
 *
 * The "Yes" path additionally throttles the network (CDP
 * Network.emulateNetworkConditions) to prove the insurance fixture still completes
 * on a slow mobile connection.
 */

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

  // Throttle to a slow mobile profile before navigating.
  const client = await page.context().newCDPSession(page);
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 200,
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (500 * 1024) / 8,
  });

  await startAnonymousFlow(page, slug);

  // Choosing "Yes" makes the follow-up number question visible + required (the
  // single-step form still shows "Submit"). Blocked-submit is covered by the
  // dedicated a11y-axe error-summary spec; here we just complete the flow.
  await chooseAccident(page, "Yes");
  await expect(page.getByText(COUNT_LABEL)).toBeVisible();
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");

  // Answer the number, then blur to post it (the branch is then satisfied). Type
  // key-by-key: the react-aria NumberField commits per keystroke. The answer posts
  // on blur, so blur by clicking a neutral heading to move focus fully out.
  const count = page.getByRole("textbox", { name: /how many/i });
  await count.click();
  await count.pressSequentially("10");
  await page.getByRole("heading", { name: "Vehicle insurance quote" }).click();

  await submitAndExpectReceipt(page);
});

test("anonymous no-accident branch is ready to submit directly", async ({ page }) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);

  // Choosing "No" leaves the follow-up not-required, so the single step is
  // immediately submittable with no further answers.
  await chooseAccident(page, "No");

  await submitAndExpectReceipt(page);
});
