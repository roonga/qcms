/**
 * SSR with JavaScript disabled (task 029, exit criterion 2). The flow page must
 * paint the step's *real* content server-side, before (and without) hydration.
 *
 * This whole file runs in a JS-disabled context. The anonymous Start control is a
 * native `<form method=post>` to the BFF start-session route, so it works without
 * JS: the browser POSTs, follows the 303 into `/s/:sessionId`, and the server
 * renders the step. We then assert the SSR HTML contains the question label with
 * no JavaScript in play.
 *
 * No-JS *submission* is now wired too (task 044): the SSR paints a natively
 * submittable `<form>` and a respondent can complete and submit the fixture
 * without JavaScript. That end-to-end flow is covered by `no-js-submit.pw.ts`;
 * this spec keeps the narrower guarantee that first paint is real step content.
 */

import { expect, test } from "./support/gates.js";

import { readFixtures } from "./support/fixtures.js";

test.use({ javaScriptEnabled: false });

test("the flow page SSR-renders real step content with JavaScript disabled", async ({ page }) => {
  const { slug } = readFixtures();

  await page.goto(`/f/${slug}`);
  // Native form POST (no JS): submit the Start control and follow the redirect.
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);

  // The step label is present in the server-rendered HTML, no hydration needed.
  await expect(page.getByText("Any at-fault accident in the last 3 years?")).toBeVisible();
});
