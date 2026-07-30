/**
 * Capture the static-render screenshot set for the human design gate (task 053).
 *
 * **Skipped unless `QCMS_PORTAL_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_PORTAL_CAPTURE_GATE=1 pnpm exec playwright test --project=mobile-chromium gate-screenshots
 * ```
 *
 * It is a spec rather than a standalone script for the same reason task 031's was: it
 * reuses the harness that already exists (Postgres, the composed API, the portal dev
 * server) and drives the real screens rather than a mock of them. A gate is only worth
 * anything if it shows what a respondent would see - including the real brand config,
 * the real curated font list, and the real vendored controls under each density.
 *
 * ## What the set covers
 *
 * The three axes the respondent controls, crossed against what a reviewer actually
 * needs to judge: does the panel read in every mode, does the selected chip read
 * WITHOUT relying on colour, and does each density look deliberate on a phone and on a
 * desktop. So: the header closed, the panel open in all three modes, each density with
 * the panel open and with a real form behind it, and two fonts that change the page's
 * character (a legibility face and a serif).
 *
 * ## Two viewports, and why the dev chrome is removed
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule. 390 is the one that matters
 * most here - respondents are on phones (ADR-26), and the header's wrap plus the
 * panel's width are exactly what a narrow screen tests.
 *
 * The Next dev-tools indicator is removed before every capture. It is dev-server
 * chrome, not product UI, and leaving it in has previously put a floating badge in the
 * corner of evidence a human is asked to approve.
 */

import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
import { PORTAL_PORT } from "./support/harness-config.js";
import { startKitchenSink } from "./support/kitchen-sink.js";

const CAPTURE = process.env.QCMS_PORTAL_CAPTURE_GATE === "1";

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE, "gate capture runs only with QCMS_PORTAL_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/053";
const WIDTHS = [390, 1280] as const;
const ORIGIN = `http://localhost:${PORTAL_PORT}`;

/**
 * Wait until React has finished hydrating before touching the DOM. Removing
 * `nextjs-portal` (a React-owned element) mid-hydration made React report a mismatch
 * that the shared console gate correctly failed the run on, so this removes the race
 * rather than allowlisting its symptom. React tags every host node it owns with a
 * `__reactFiber$...` property when it hydrates, so its presence IS the signal.
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const button = document.querySelector("button, summary");
    if (button === null) return false;
    return Object.keys(button).some((key) => key.startsWith("__reactFiber$"));
  });
}

/** Remove the Next dev-tools indicator (absent in a production build). */
async function hideDevChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const selector of ["nextjs-portal", "#__next-build-watcher", "[data-nextjs-toast]"]) {
      for (const element of Array.from(document.querySelectorAll(selector))) element.remove();
    }
  });
}

/**
 * Settle running CSS transitions before the shutter (issue #187). A chip captured
 * mid-transition shows a blended colour that belongs to no palette, which in a
 * screenshot set is worse than in a test: nobody can tell it is an artefact.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(undefined));
    });
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

/** Capture one named state at both widths. */
async function capture(page: Page, name: string): Promise<void> {
  await waitForHydration(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await hideDevChrome(page);
    await settle(page);
    await page.screenshot({ path: `${OUT_DIR}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

async function openPanel(page: Page): Promise<void> {
  const disclosure = page.getByTestId("appearance");
  if (!(await disclosure.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.locator('[data-testid="appearance"] > summary').click();
  }
  await expect(page.getByTestId("appearance-mode")).toBeVisible();
}

async function pick(page: Page, group: "mode" | "density", value: string): Promise<void> {
  await page.locator(`[data-testid="appearance-${group}"] label[data-value="${value}"]`).click();
  await settle(page);
}

test("captures the panel open in all three modes", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  // The closed default view is `form-comfortable-*` from the test below: with no
  // choice made, Comfortable and a collapsed disclosure IS the default view, and
  // capturing it twice would commit two identical PNGs.
  await openPanel(page);
  for (const mode of ["light", "dark", "hc"] as const) {
    await pick(page, "mode", mode);
    await capture(page, `panel-${mode}`);
  }
});

test("captures each density with the panel open over a real form", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  await openPanel(page);
  await pick(page, "mode", "light");
  // Comfortable with the panel open in Light IS `panel-light-*` from the test above,
  // byte for byte, so only the two non-default levels are captured here.
  for (const level of ["compact", "spacious"] as const) {
    await pick(page, "density", level);
    await capture(page, `density-${level}`);
  }
});

test("captures each density with the panel closed, so the form is unobstructed", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  await openPanel(page);
  await pick(page, "mode", "light");
  for (const level of ["compact", "comfortable", "spacious"] as const) {
    await pick(page, "density", level);
    // Reload rather than toggling the disclosure: it proves the persisted level is
    // what a returning respondent's first paint carries, which is the claim the
    // screenshots are evidence for.
    await page.reload();
    await capture(page, `form-${level}`);
    await openPanel(page);
  }
});

test("captures two fonts that change the page's character", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  await openPanel(page);
  await pick(page, "mode", "light");
  for (const font of ["atkinson", "merriweather"] as const) {
    await page.getByTestId("appearance-font").selectOption(font);
    await settle(page);
    await capture(page, `font-${font}`);
  }
});

test("captures High-contrast with a form and an error summary behind the panel", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  await openPanel(page);
  await pick(page, "mode", "hc");
  // Both of this step's questions are required (ADR-28), so a bare Continue provokes
  // the error summary: the HC treatment on a banner plus the controls in one frame.
  await page.locator('[data-testid="appearance"] > summary').click();
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await capture(page, "hc-error-summary");
});

test("captures the entry page, where the brand mark stands alone", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`${ORIGIN}/f/${slug}`);
  // The one assertion this capture needs: a screenshot of an unbranded header would
  // be evidence for the opposite of what the gate is approving.
  await expect(page.getByTestId("brand-mark")).toBeVisible();
  await capture(page, "entry-brand");
});
