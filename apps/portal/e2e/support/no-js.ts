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
