/**
 * Reduced-motion and 200%-zoom checks on the flow page (task 030). These are the
 * flow-level visual-accessibility criteria a component library cannot own:
 * respecting `prefers-reduced-motion`, and staying usable (no horizontal scroll,
 * controls reachable) when a low-vision user runs the page at 200% zoom, which on
 * a mobile viewport manifests as a much narrower effective width.
 */

import { expect, test } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL } from "./support/flow.js";

test("reduced-motion: transitions collapse to near-instant on the flow page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);

  // The skip link's slide transition is neutralized under reduced motion: the
  // reset collapses it to ~0 (reported as "0s" or "1e-05s"), never 0.15s.
  const skipTransition = await page
    .getByRole("link", { name: "Skip to content" })
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(Number.parseFloat(skipTransition)).toBeLessThanOrEqual(0.02);

  // Start the flow to confirm it remains fully functional under reduced motion.
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
});

test("200% zoom: the flow reflows without horizontal scrolling and controls stay reachable", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();

  // Emulate 200% zoom on top of the mobile viewport: reflow, not zoom-scroll.
  await page.evaluate(() => {
    document.documentElement.style.setProperty("zoom", "2");
  });

  // No horizontal overflow of the page body (WCAG 1.4.10 reflow). Allow a 1px
  // rounding slack.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // The primary control is still visible and operable at this magnification.
  await expect(page.getByTestId("primary-action")).toBeVisible();
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
});
