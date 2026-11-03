import { expect, type Page } from "@playwright/test";

import { HYDRATED_ATTRIBUTE } from "../../lib/hydration.js";

export interface HydrationWaitOptions {
  // Defaults to Playwright's timeout; use a short override for a page expected never to hydrate.
  readonly timeout?: number;
}

// The HTML parser creates noscript children only when scripting is disabled.
// page.evaluate still runs in an isolated world, so it cannot detect that browser mode.
async function scriptingDisabled(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.querySelectorAll("noscript")].some((tag) => tag.childElementCount > 0),
  );
}

// Pre-hydration interactions can be lost or overwritten; wait for the application's mount signal.
export async function waitForHydration(
  page: Page,
  options: HydrationWaitOptions = {},
): Promise<void> {
  if (await scriptingDisabled(page)) return;
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

// Install before goto with waitUntil: "commit", and release in finally.
// To reproduce the wipe, hydrate between typing and submitting, rather than delaying the whole sequence.
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
