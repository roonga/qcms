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
