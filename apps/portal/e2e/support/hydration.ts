/**
 * The single hydration wait every portal e2e entry helper owns (issue #121).
 *
 * Extracted from `kitchen-sink.ts`, where it started life (issue #31 / PR #90),
 * because `startAnonymousFlow` had the same latent race and a copy would have let
 * the next entry helper be written without one. Entry helpers call this before
 * they return, so a spec cannot interact with an un-hydrated step by omission.
 *
 * Wait until React has hydrated the step, not merely until the SSR markup is
 * visible. The portal's first paint is a real server-rendered fallback form
 * (029) - visible and fillable, but not the markup React keeps: on hydration
 * React replaces the fallback wholesale with its own render. An interaction that
 * lands in that window toggles a native control that is then unmounted, so no
 * React handler ever fires and no answer is posted. React tags each host node it owns with
 * a `__reactFiber$...` / `__reactProps$...` property when it hydrates, so the
 * presence of one on a step control is the attachment signal itself rather than
 * a proxy for it.
 *
 * The failure this prevents does not name its cause: the discarded interaction is
 * silent, and the red then shows up later as a timeout on the *first answer post*,
 * with a stack pointing at whichever shared helper awaited it. Two sessions lost
 * bisecting runs to it (PR #90, PR #97) before it was fixed structurally.
 *
 * A wait like this is worthless if it can pass without observing anything, so the
 * property name React attached is read back and asserted rather than assumed:
 * `waitForFunction` only resolves on a truthy value and throws on timeout, and the
 * assertion below pins what that value was. `hydration-wait.pw.ts` proves both
 * halves against the portal's real SSR markup: the wait rejects when pointed at a
 * step whose hydration bundle was removed (markup present, React absent) and
 * resolves on the same step served normally.
 */

import { expect, type Page } from "@playwright/test";

/**
 * The step control the wait watches. Every flow step renders it (Continue or
 * Submit), on both the insurance and kitchen-sink fixtures, and it is React-owned,
 * so it is the one node guaranteed to carry a fiber property once the step
 * hydrates.
 *
 * As built, the portal's SSR fallback form does not carry this testid at all (it
 * renders a plain `button[type=submit]`, which is what the no-JS specs drive), so
 * today the node's mere presence is already a hydration signal. The property check
 * is deliberately kept on top of that rather than simplified away: it is what keeps
 * the wait honest if the server-rendered fallback ever grows the same testid.
 */
const HYDRATION_PROBE = "[data-testid='primary-action']";

/** Options accepted by `waitForHydration`. */
export interface HydrationWaitOptions {
  /**
   * Milliseconds to wait before failing. Defaults to Playwright's own timeout;
   * only `hydration-wait.pw.ts` passes a short one, to assert a deliberately
   * non-hydrating page is rejected without burning the default wait.
   */
  readonly timeout?: number;
}

/** Wait until React has attached to the current step, and prove it observed that. */
export async function waitForHydration(
  page: Page,
  options: HydrationWaitOptions = {},
): Promise<void> {
  const marker = await page.waitForFunction(
    (probe: string) => {
      const el = document.querySelector(probe);
      if (el === null) return null;
      // Own enumerable property, set by React on the host node as it hydrates.
      return Object.keys(el).find((key) => key.startsWith("__react")) ?? null;
    },
    HYDRATION_PROBE,
    options,
  );
  expect(
    await marker.jsonValue(),
    "the hydration wait must resolve on an observed React property, never vacuously",
  ).toMatch(/^__react/);
}
