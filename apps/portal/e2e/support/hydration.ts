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
 * Reproducing the race, a trap paid for twice (issues #121, #137): `page.waitForURL`
 * defaults to `waitUntil: "load"`, so at normal speed hydration is usually already
 * complete when it resolves. Throttling the CPU *after* the navigation, or delaying
 * script responses with `page.route` (the step page reuses the entry page's cached
 * bundle), therefore yields a green false negative rather than a weak repro. Arm
 * `Emulation.setCPUThrottlingRate` BEFORE the first `goto`: rate 6 reproduces it every
 * run, while rate 20 is worse, reddening an unrelated Submit `toPass` for scaffold
 * reasons rather than the race.
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
  /**
   * The node to read React's attachment from, when the default is not on the page.
   *
   * The default probes a STEP control, so it is the wrong question on any page that
   * is not a step: the form entry page (`/f/<slug>`) renders no `primary-action` at
   * all, and waiting for one there hangs until the test times out rather than
   * failing with a useful message (issue #391, found the expensive way).
   *
   * A caller passing one is making the same claim the default makes and must make
   * it truthfully: the node has to be **React-owned**, or the wait watches something
   * React never touches. Prefer the element whose hydration the test actually
   * depends on.
   */
  readonly probe?: string;
}

/** Wait until React has attached to the page, and prove it observed that. */
export async function waitForHydration(
  page: Page,
  options: HydrationWaitOptions = {},
): Promise<void> {
  const { probe = HYDRATION_PROBE, ...waitOptions } = options;
  const marker = await page.waitForFunction(
    (selector: string) => {
      const el = document.querySelector(selector);
      if (el === null) return null;
      // Own enumerable property, set by React on the host node as it hydrates.
      return Object.keys(el).find((key) => key.startsWith("__react")) ?? null;
    },
    probe,
    waitOptions,
  );
  expect(
    await marker.jsonValue(),
    "the hydration wait must resolve on an observed React property, never vacuously",
  ).toMatch(/^__react/);
}
