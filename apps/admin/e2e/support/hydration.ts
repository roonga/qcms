/**
 * The admin browser suite's hydration wait (issue #210).
 *
 * ## What it is for
 *
 * Every admin screen is served as complete, interactive HTML before React runs. That is a
 * product property worth having and the auth loop depends on it, but it means "the page"
 * names two different states, and typing into the first one is thrown away when the second
 * arrives: react-aria's `TextField` renders a CONTROLLED input seeded empty, so the commit
 * that attaches React writes that empty value over whatever was typed. On the two-factor
 * challenge the field is `required`, so the Enter that follows is stopped by the browser's
 * own constraint validation - no submit event, no request, no error, nothing to read. The
 * spec then times out on a screen it believed it had left (issue #210, measured: 12 wipes
 * in 20 attempts, hydration landing 76-404ms after the document commit on an idle machine).
 *
 * ## Why a wait rather than a retry
 *
 * `fillStable` already retries a fill whose value did not stick, and a retry is the right
 * shape for a `next dev` recompile that replaces the document out of nowhere. It is the
 * wrong shape for this, because this is not unpredictable: there is an exact moment after
 * which typing is safe, the page knows when it arrives, and waiting for it removes the race
 * instead of paying for it repeatedly. A retry also cannot help the case that actually
 * fails here, where the value is wiped between the fill and the keystroke that submits it.
 *
 * ## The signal
 *
 * `components/hydration-marker.tsx` stamps `data-qcms-hydrated` on `<html>` from a mount
 * effect in the root layout. A mount effect never runs on the server, so the attribute is
 * absent from the served bytes by construction; `hydration-wait.pw.ts` proves that against
 * the real server rather than against the theory, and proves the wait rejects a page whose
 * bundle never ran.
 */

import { expect, type Page } from "@playwright/test";

import { HYDRATED_ATTRIBUTE } from "../../lib/hydration.js";

/** Options accepted by {@link waitForHydration}. */
export interface HydrationWaitOptions {
  /**
   * Milliseconds to wait before failing. Defaults to Playwright's own timeout; only
   * `hydration-wait.pw.ts` passes one, so that a page which must never satisfy the wait is
   * rejected without burning the suite default.
   */
  readonly timeout?: number;
}

/**
 * Wait until React has attached to the current admin page, and prove it observed that.
 *
 * The value the page reported is read back and asserted rather than assumed: a wait that
 * can resolve without observing anything is worth nothing, and `waitForFunction` resolving
 * on a truthy value is the only thing that separates the two.
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

/**
 * Hold every script response until the caller releases it, so a spec decides exactly when
 * React attaches. Install it BEFORE the navigation, pair it with
 * `goto(url, { waitUntil: "commit" })`, and always `release()` in a `finally`.
 *
 * ## Why the control has to be this precise
 *
 * Because the window is not "before hydration", it is "hydration lands **between** the
 * typing and the submit". Type into the server render and never hydrate, and the value is
 * intact and the native form POST succeeds - the screen works with no JavaScript at all,
 * which is the whole point of it. Hydrate first and the typing goes through React. Only
 * the interleaving loses: the value is typed, the attaching commit overwrites it with
 * react-aria's empty state, and the Enter that follows submits an empty `required` field.
 * A regression test therefore has to schedule that interleaving rather than hope for it.
 *
 * ## Three amplifiers that do not produce it, measured rather than assumed
 *
 * **`Emulation.setCPUThrottlingRate`**, which is how the portal reproduces its version of
 * this race, does not. The portal's failure is a single click issued the moment a
 * navigation settles, so throttling delays hydration and nothing else. The admin's is a
 * keyboard sequence - two tabs, six keystrokes, another tab, Enter - dispatched into the
 * same throttled renderer, so throttling slows the typing by about as much as it slows
 * hydration. Four unwaited runs at rate 6 all passed.
 *
 * **A fixed script delay with a default `goto`** does not: `waitUntil: "load"` waits for
 * every subresource, so the navigation swallows the delay and hands back a hydrated page.
 * One unwaited run at a three-second delay passed for exactly that.
 *
 * **A fixed script delay with `waitUntil: "commit"`** does not either, and this is the
 * instructive one: it moves hydration to AFTER the whole sequence, Enter included, so the
 * pre-hydration native submit simply works. Two unwaited runs passed, faster than the
 * waited ones.
 *
 * All three are written down because each looks like a working amplifier from the outside,
 * and each would have shipped a regression test that cannot fail.
 */
export function holdScripts(page: Page): { release: () => void } {
  let open = (): void => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  void page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await gate;
    await route.continue();
  });
  return {
    release: () => {
      open();
    },
  };
}
