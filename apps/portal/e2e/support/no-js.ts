/**
 * Driving helpers for the specs that run with `javaScriptEnabled: false`.
 *
 * One place for the two things every no-JS step case gets wrong on its own:
 *
 * - **Waiting for the navigation the POST produces.** A native form submission the
 *   browser REFUSES looks, from the test's side, exactly like one that submitted and
 *   changed nothing: same page, same markup, no error. Every assertion after a
 *   submit therefore has to be made on the page the 303 landed on, which means
 *   waiting for the served response rather than for a timeout (the #920 lane lost
 *   hours to this, and issue #974's own reproduction turns on it).
 * - **Scoping the submit to the step card.** Since issue #195 the header's
 *   appearance controls are a second native form on the page with a
 *   `<noscript>`-revealed submit of their own, so an unscoped
 *   `form button[type="submit"]` matches two elements.
 */

import type { Page } from "@playwright/test";

/** The step form's own submit control (never the header's, issue #195). */
export function stepSubmit(page: Page) {
  return page.getByTestId("step-card").locator('form button[type="submit"]');
}

/** Submit the step's native form and wait for the page the 303 lands on. */
export async function submitStep(page: Page): Promise<void> {
  const served = page.waitForResponse(
    (response) => response.request().isNavigationRequest() && response.status() === 200,
  );
  await stepSubmit(page).click();
  await served;
}

/**
 * Start counting the whole-step POSTs this page makes, so "the browser blocked it"
 * is a counted fact rather than an absence observed for an arbitrary length of time.
 *
 * Scoped to the step route: anonymous entry is a native form POST of its own (issue
 * #579), so an unscoped counter starts at one.
 */
export function countStepPosts(page: Page): () => number {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/s\/ses_[^/]+\/step$/.test(new URL(request.url()).pathname)
    ) {
      posts.push(request.url());
    }
  });
  return () => posts.length;
}

/**
 * Walk the kitchen sink's no-JS render from the entry page to the step holding the
 * OPTIONAL number (`q_annual_km`, on "Your cover"), answering each step's required
 * questions on the way.
 *
 * Two steps of setup rather than none, because the number is on the last step and
 * every step before it has a required question. It is worth the walk: the number is
 * the control the styling assertions are about, and no earlier step carries one that
 * is not behind a branch.
 *
 * The caller decides how scripting is suppressed. With `javaScriptEnabled: false`
 * this is the respondent's own experience; with `starveScripts` (a page that is
 * scriptable from the test's side while React never runs) it is the same markup with
 * computed styles readable, which is what the theming and font assertions need.
 */
export async function walkToOptionalNumber(page: Page, slug: string): Promise<void> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await page.locator('input[name="q_full_name"]').fill("Ada Lovelace");
  await page.locator('input[name="q_dob"]').fill("1990-05-17");
  await submitStep(page);
  await page.getByText("No", { exact: true }).click();
  await page.getByText("Breakdown", { exact: true }).click();
  await submitStep(page);
}
