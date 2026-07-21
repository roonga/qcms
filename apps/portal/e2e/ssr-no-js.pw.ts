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
 * Known limitation (documented, not a gap to fix here): no-JS *answer submission*
 * is not wired. The shared @qcms/ui renderer owns the field `<form>` and the
 * compiled A2UI document cannot carry a per-question POST action without a 028
 * change, so this spec asserts only the SSR content, never a no-JS answer POST.
 */

import { expect, test } from "@playwright/test";

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
