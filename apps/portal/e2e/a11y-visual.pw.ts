/**
 * Reduced-motion and 200%-zoom checks on the flow page (task 030). These are the
 * flow-level visual-accessibility criteria a component library cannot own:
 * respecting `prefers-reduced-motion`, and staying usable (no horizontal scroll,
 * controls reachable) when a low-vision user runs the page at 200% zoom, which on
 * a mobile viewport manifests as a much narrower effective width.
 *
 * WHICH RENDER IS BEING MEASURED, AND WHY IT IS NOW TWO TESTS (issue #160)
 * The portal's first paint is a real native no-JS form which React then replaces
 * WHOLESALE on hydration (029, #121). The reflow measurement below used to compute
 * `scrollWidth - clientWidth` before anything in the test implied hydration, so it
 * measured whichever render happened to be on screen - and if the two ever differed
 * in layout, the WCAG 1.4.10 assertion would be made against markup no JS user
 * encounters.
 *
 * The fix is not a bare hydration wait. The fallback is legitimate coverage in its
 * own right: a respondent with JavaScript off sees exactly that markup, and WCAG
 * applies to them too, so measuring only the hydrated render would trade one blind
 * spot for another. Both renders are therefore measured on purpose, each in a test
 * that names the render it audits, and each records the numbers it observed as a
 * test annotation rather than only asserting that they pass. Numbers in the report
 * are what let the next reader see the two renders agree instead of taking it on
 * faith - and if they ever stop agreeing, that is a defect to file, not a threshold
 * to loosen.
 */

import { expect, test } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { starveScripts } from "./support/script-starve.js";

/** Reflow slack: 1px of rounding, and no more. */
const OVERFLOW_SLACK_PX = 1;

/** What a reflow measurement observed, so a report reader sees it rather than infers it. */
interface Reflow {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly overflow: number;
  /** The widest element in the main column, which is what overflows first when one does. */
  readonly widestMainElementPx: number;
}

/**
 * Emulate 200% zoom on top of the mobile viewport (reflow, not zoom-scroll) and
 * report the page's horizontal geometry.
 *
 * The widest main-column element is measured alongside the overflow because the
 * overflow number alone cannot distinguish "this render reflows correctly" from
 * "this is not the render with the wide element in it". It is the measurement the
 * #137 review used to establish that the two renders agree.
 */
async function measureReflowAt200Percent(page: Page): Promise<Reflow> {
  await page.evaluate(() => {
    document.documentElement.style.setProperty("zoom", "2");
  });
  return page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector("#portal-main");
    const widths =
      main === null
        ? []
        : Array.from(main.querySelectorAll("*"), (el) => el.getBoundingClientRect().width);
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      overflow: root.scrollWidth - root.clientWidth,
      widestMainElementPx: Math.round(widths.length === 0 ? 0 : Math.max(...widths)),
    };
  });
}

/** Put a measurement in the test report, so the assertion is not the only evidence. */
function recordReflow(render: string, reflow: Reflow): void {
  test.info().annotations.push({
    type: "reflow",
    description: `${render}: scrollWidth ${reflow.scrollWidth}, clientWidth ${reflow.clientWidth}, overflow ${reflow.overflow}, widest main element ${reflow.widestMainElementPx}px`,
  });
}

test("reduced-motion: transitions collapse to near-instant on the flow page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);

  const skipTransition = await page
    .getByRole("link", { name: "Skip to content" })
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(Number.parseFloat(skipTransition)).toBeLessThanOrEqual(0.02);

  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
});

test("200% zoom: the HYDRATED flow render reflows without horizontal scrolling and controls stay reachable", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();

  await waitForHydration(page);

  const reflow = await measureReflowAt200Percent(page);
  recordReflow("hydrated React render", reflow);

  expect(reflow.overflow).toBeLessThanOrEqual(OVERFLOW_SLACK_PX);

  await expect(page.getByTestId("primary-action")).toBeVisible();
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
});

test("200% zoom: the no-JS FALLBACK flow render reflows without horizontal scrolling and controls stay reachable", async ({
  page,
}) => {
  const { slug } = readFixtures();

  const starvation = await starveScripts(page);
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this measures the hydrated render",
  ).toBeGreaterThan(0);

  const reflow = await measureReflowAt200Percent(page);
  recordReflow("no-JS fallback render", reflow);

  expect(reflow.overflow).toBeLessThanOrEqual(OVERFLOW_SLACK_PX);

  await expect(page.getByTestId("step-card").locator("button[type='submit']")).toBeVisible();
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
});
