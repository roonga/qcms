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
