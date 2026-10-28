/**
 * The single hydration wait every portal e2e entry helper owns. Entry helpers call it
 * before they return, so a spec cannot interact with an un-hydrated step by omission.
 *
 * It waits for React to have hydrated, not merely for the SSR markup to be visible: the
 * portal's first paint is a real fallback form, and on hydration React replaces it
 * wholesale, so an interaction landing in that window toggles a control that is then
 * unmounted and no answer is posted. The failure does not name its cause, showing up
 * later as a timeout on the first answer post.
 *
 * The page answers for itself through the `data-qcms-hydrated` marker, which cannot lie:
 * a mount effect runs only on the client and only after React commits, so the attribute
 * is absent from the served bytes by construction. On the flow page the marker is on the
 * controlled render rather than the shared shell, so its presence means the progressive
 * swap has committed, which is the guarantee the entry helpers need.
 *
 * Reproducing the race needs `Emulation.setCPUThrottlingRate` armed before the first
 * navigation: `page.waitForURL` defaults to waiting for load, so throttling afterwards
 * or delaying script responses yields a green false negative rather than a weak repro.
 *
 * What the page reported is read back and asserted rather than assumed, because a wait
 * that can pass without observing anything is worthless.
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
