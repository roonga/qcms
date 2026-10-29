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
