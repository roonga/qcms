import { chromium } from "@playwright/test";

import { HYDRATED_ATTRIBUTE } from "../../../admin/lib/hydration.js";
import { ADMIN_BASE_URL } from "../../../admin/e2e/support/harness-config.js";

/**
 * Compile the admin's first page before any test owns it.
 *
 * `next dev` compiles a route on its first request and then issues a reload, which arrives
 * as a SECOND navigation to the same URL. Whichever test touches the admin first inherits
 * that reload, and a reload lands under `page.evaluate` as "Execution context was
 * destroyed, most likely because of a navigation" rather than as a failed assertion. It is
 * a race rather than a constant, so it moves between specs as the app's first compile grows
 * and reads as a different defect each time.
 *
 * The page here is discarded, so the reload happens to nobody. Two loads rather than one:
 * the first pays for the compile and absorbs the reload, the second proves the route is
 * served warm.
 *
 * This warms the admin only. The portal's first screen showed no instance of the pattern
 * across five full runs, and warming a route on no evidence would be a second thing to keep
 * working.
 */
export async function warmAdminFirstPaint(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (let pass = 0; pass < 2; pass++) {
      await page.goto(`${ADMIN_BASE_URL}/sign-in`, { waitUntil: "load" });
      await page.waitForFunction(
        (attribute: string) => document.documentElement.hasAttribute(attribute),
        HYDRATED_ATTRIBUTE,
        { timeout: 120_000 },
      );
    }
  } finally {
    await browser.close();
  }
}
