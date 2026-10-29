import { chromium } from "@playwright/test";

import { ADMIN_BASE_URL } from "../../../admin/e2e/support/harness-config.js";
import { HYDRATED_ATTRIBUTE } from "../../../admin/lib/hydration.js";

/**
 * Compile and hydrate the admin's first page, so no test inherits `next dev`'s
 * first-request reload as a destroyed execution context under its own `page.evaluate`.
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
