/**
 * The single hydration wait every portal e2e entry helper owns (issue #121,
 * re-based onto a first-class marker by issue #159).
 *
 * Extracted from `kitchen-sink.ts`, where it started life (issue #31 / PR #90),
 * because `startAnonymousFlow` had the same latent race and a copy would have let
 * the next entry helper be written without one. Entry helpers call this before
 * they return, so a spec cannot interact with an un-hydrated step by omission.
 *
 * WHAT IT WAITS FOR, AND WHY IT NO LONGER GUESSES
 * Wait until React has hydrated the page, not merely until the SSR markup is
 * visible. The portal's first paint is a real server-rendered fallback form (029) -
 * visible and fillable, but not the markup React keeps: on hydration React replaces
 * the fallback wholesale with its own render. An interaction that lands in that
 * window toggles a native control that is then unmounted, so no React handler ever
 * fires and no answer is posted.
 *
 * Until #159 this asked an indirect question. It looked up
 * `[data-testid="primary-action"]` and read React's internal `__reactFiber$` /
 * `__reactProps$` property off it, which worked but coupled the harness to a
 * renderer testid that exists for an unrelated reason, and structurally could not
 * serve a page with no primary action at all - the entry page (`/f/:slug`) renders
 * a plain `<button type="submit">` in a native form, so a wait there was an
 * unconditional 30-second timeout rather than a wait (issue #391, found the
 * expensive way, and worked around with a per-call `probe` option that this change
 * retires).
 *
 * Now the page answers for itself: `components/hydration-marker.tsx` stamps
 * `data-qcms-hydrated` on `<html>` from a mount effect, and every root a spec may
 * need to wait for renders one - entry, flow, completion and the message screens.
 * On the flow page the marker is mounted on the CONTROLLED `StepFlow` rather than
 * on the shared shell, so its presence means the progressive swap has committed,
 * which is the guarantee the entry helpers actually need. That is a stronger claim
 * than the old probe made, not a weaker one: the old fiber property appeared on the
 * primary action as soon as React owned it, and this appears only after the render
 * that owns it is on screen.
 *
 * WHY THE MARKER CANNOT LIE
 * A mount effect runs only on the client, and only after React commits. It never
 * runs during a server render, so the attribute is absent from the served bytes by
 * construction rather than by a convention someone has to keep.
 * `hydration-wait.pw.ts` proves both halves against the real server: the attribute
 * is not in the SSR HTML, and it never appears on a step whose bundle was starved,
 * while the same step served normally resolves the wait and has its React-owned
 * primary action on screen when it does.
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
 * A wait like this is worthless if it can pass without observing anything, so what
 * the page reported is read back and asserted rather than assumed: `waitForFunction`
 * only resolves on a truthy value and throws on timeout, and the assertion below
 * pins what that value was.
 */

import { expect, type Page } from "@playwright/test";

import { HYDRATED_ATTRIBUTE } from "../../lib/hydration.js";

/** Options accepted by `waitForHydration`. */
export interface HydrationWaitOptions {
  /**
   * Milliseconds to wait before failing. Defaults to Playwright's own timeout;
   * only `hydration-wait.pw.ts` passes a short one, to assert a deliberately
   * non-hydrating page is rejected without burning the default wait.
   */
  readonly timeout?: number;
}

/**
 * Wait until React has attached to the page, and prove it observed that.
 *
 * There is deliberately no per-call probe option any more. Every page that needs
 * this wait carries the marker, so a caller has nothing left to choose - and that
 * option's existence was itself the bug report (#391): it made "which node stands
 * in for hydration on this page" a question every spec had to answer, and answer
 * correctly, when the page is the only thing that knows.
 */
export async function waitForHydration(
  page: Page,
  options: HydrationWaitOptions = {},
): Promise<void> {
  const marker = await page.waitForFunction(
    (attribute: string) => (document.documentElement.hasAttribute(attribute) ? attribute : null),
    HYDRATED_ATTRIBUTE,
    options,
  );
  expect(
    await marker.jsonValue(),
    "the hydration wait must resolve on an observed marker, never vacuously",
  ).toBe(HYDRATED_ATTRIBUTE);
}
