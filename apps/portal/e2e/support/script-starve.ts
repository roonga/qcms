/**
 * Serve a page its real server-rendered markup with no client bundle behind it
 * (issues #159, #160).
 *
 * WHY THIS EXISTS AS A HELPER
 * Three specs now need the same fixture: the hydration wait's non-vacuity proof
 * (`hydration-wait.pw.ts`), the entry-page axe scan and the 200%-zoom reflow
 * measurement (`a11y-axe.pw.ts`, `a11y-visual.pw.ts`). All three need the portal's
 * no-JS fallback ON A PAGE WHOSE OWN JAVASCRIPT STILL RUNS, which is a narrower
 * thing than `test.use({ javaScriptEnabled: false })` gives: with scripting off,
 * `page.evaluate` is unavailable, so nothing can set the zoom, read `scrollWidth`,
 * or poll for a marker. Starving only the SCRIPT resource type leaves the page
 * scriptable from the test's side while React never runs.
 *
 * WHY AN EMPTY 200 AND NOT `abort()`
 * An aborted request surfaces as a `net::ERR_FAILED` console error, and the shared
 * browser gate would red the test for the wrong reason. An empty JavaScript body is
 * a successful load of nothing. `no-store` keeps that empty body out of the HTTP
 * cache, so lifting the starvation really does refetch the bundle rather than
 * replaying the blank one - the step page reuses the entry page's bundle, so
 * without that header the "served normally" half of a proof is not served normally.
 *
 * WHY THE COUNT IS RETURNED
 * "The page could not hydrate" has to be the browser's own request accounting, not
 * an inspection of markup. A spec that asserts the count is above zero cannot pass
 * vacuously by accidentally serving a page that CAN hydrate - which is exactly how
 * a starvation fixture goes quiet when a bundle URL changes shape.
 */

import type { Page } from "@playwright/test";

/** A live starvation, and the two things a spec does with one. */
export interface ScriptStarvation {
  /** How many script requests have been answered with an empty body so far. */
  readonly starvedCount: () => number;
  /**
   * Stop starving. Scripts requested after this resolve normally, so the caller can
   * re-navigate and get a page that genuinely hydrates.
   */
  readonly restore: () => void;
}

/**
 * Answer every script request on `page` with an empty 200 until {@link
 * ScriptStarvation.restore} is called. Install it BEFORE the first navigation.
 */
export async function starveScripts(page: Page): Promise<ScriptStarvation> {
  let starving = true;
  let starved = 0;
  await page.route("**/*", async (route) => {
    if (starving && route.request().resourceType() === "script") {
      starved += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "cache-control": "no-store" },
        body: "",
      });
      return;
    }
    await route.continue();
  });
  return {
    starvedCount: () => starved,
    restore: () => {
      starving = false;
    },
  };
}
