/**
 * Automated accessibility scan (axe) across EVERY portal page state in the
 * vehicle-insurance fixture walkthrough (task 030, exit criterion 1), not just
 * the first render: entry, initial flow, post-branch-INSERTION, post-branch-
 * REMOVAL, the blocked-submit error-summary state, and completion. axe runs
 * inside the real, cookie-bearing Playwright browser context, which is why it -
 * not Lighthouse - is the tool that covers the interactive (JS-only) states.
 *
 * Each scan asserts zero violations AND that axe actually ran real rules
 * (`passes` is non-empty), so a misconfigured builder can never pass vacuously.
 *
 * WHICH RENDER EACH SCAN AUDITS (issue #160)
 * The portal server-renders a real native no-JS form which React then replaces
 * WHOLESALE on hydration (029, #121), so "the entry page" and "the flow page" each
 * name two different DOMs. Every scan below now says which one it is looking at:
 *
 * - The flow, error-summary, kitchen-sink and completion scans audit the HYDRATED
 *   render. They always did in practice - each enters through a helper that waits
 *   for hydration, or interacts in a way only the React render supports - but the
 *   completion scan was relying on a navigation rather than on a wait, so it now
 *   asks explicitly.
 * - The entry page is audited TWICE, once per render. It could not be audited at
 *   all in its hydrated state until #159, because the wait keyed on a step control
 *   this page does not render. Auditing only the hydrated one would have been the
 *   wrong trade: a respondent with JavaScript off sees the fallback, and WCAG
 *   applies to them too.
 *
 * Each scan records the rule counts it observed as a test annotation, so a report
 * reader can see that both renders were really exercised rather than that one of
 * them silently scanned an empty page.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { COUNT_LABEL, answerCount, chooseAccident, startAnonymousFlow } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { starveScripts } from "./support/script-starve.js";
import {
  KS,
  answerNumber,
  chooseRadio,
  checkOption,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
} from "./support/kitchen-sink.js";

/**
 * Run axe on the current page state; fail on any violation, prove it ran.
 *
 * The label names the page state AND the render, because a scan that does not say
 * which of the two DOMs it audited is not reproducible evidence. The rule counts go
 * into the test report for the same reason: `passes.length > 0` proves axe ran, and
 * the recorded number is what lets a reader compare two renders after the fact.
 */
async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ");
  test.info().annotations.push({
    type: "axe",
    description: `${label}: ${results.passes.length} rules passed, ${results.violations.length} violations, ${results.incomplete.length} incomplete`,
  });
  expect(results.violations, `axe violations at "${label}": ${summary}`).toEqual([]);
  // Guard against a vacuous pass: axe must have exercised real rules here.
  expect(results.passes.length, `axe ran no rules at "${label}"`).toBeGreaterThan(0);
}

test("axe: the entry page's HYDRATED render has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  // The render a JS respondent audits against. Impossible to ask for here before
  // #159: this page renders no `primary-action`, so the old testid probe could only
  // time out on it, which is precisely why this scan used to measure whichever
  // render happened to be on screen.
  await waitForHydration(page);
  await expectNoAxeViolations(page, "entry (hydrated render)");
});

test("axe: the entry page's no-JS FALLBACK render has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  // Scripts starved rather than `javaScriptEnabled: false`, because axe itself runs
  // by injecting and evaluating script in the page: with scripting off there is
  // nothing to scan with. Starving only the app bundle leaves axe working while
  // React never runs. See `support/script-starve.ts`.
  const starvation = await starveScripts(page);
  await page.goto(`/f/${slug}`);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this scans the hydrated render",
  ).toBeGreaterThan(0);
  await expectNoAxeViolations(page, "entry (no-JS fallback render)");
});

test("axe: flow initial, branch-inserted, and branch-removed states have zero violations", async ({
  page,
}) => {
  const { slug } = readFixtures();
  // `startAnonymousFlow` waits for hydration, so every scan in this test audits the
  // hydrated render. The fallback's own geometry and structure are covered by
  // `a11y-visual.pw.ts` and the no-JS specs.
  await startAnonymousFlow(page, slug);
  await expectNoAxeViolations(page, "flow initial (hydrated render)");

  // Branch INSERTION: choosing "Yes" makes the follow-up count question visible.
  await chooseAccident(page, "Yes");
  await expect(page.getByText(COUNT_LABEL)).toBeVisible();
  await expectNoAxeViolations(page, "branch inserted (count visible)");

  // Branch REMOVAL: changing to "No" drops the follow-up again.
  await chooseAccident(page, "No");
  await expect(page.getByText(COUNT_LABEL)).toHaveCount(0);
  await expectNoAxeViolations(page, "branch removed (count gone)");
});

test("axe: blocked-submit error-summary state has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  // The required accident question is unanswered, so the primary action surfaces
  // the error summary instead of submitting.
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expectNoAxeViolations(page, "blocked submit (error summary)");
});

test("axe: kitchen-sink flow states (six of seven types + a branch) have zero violations", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  // Step 1: short text + date.
  await expectNoAxeViolations(page, "kitchen-sink step 1 (short text + date)");

  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  // Step 2: boolean + number + multi-choice + (revealed) long text.
  await chooseRadio(page, "Yes");
  await answerNumber(page, "10");
  await checkOption(page, "Breakdown");
  await checkOption(page, "Windscreen");
  await expect(page.getByRole("textbox", { name: KS.extraDetail })).toBeVisible();
  await expectNoAxeViolations(page, "kitchen-sink step 2 branch-inserted (all four types)");
});

test("axe: completion page has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  // Shortest complete path: "Yes" then a count, then submit.
  await chooseAccident(page, "Yes");
  await answerCount(page, "1");
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);
  await expect(page.getByTestId("content-hash")).toBeVisible();
  // The completion screen is a fresh navigation, so the wait is asked for
  // explicitly rather than inherited from the entry helper (issue #160). `/done`
  // has no primary action either, so this is a second scan the old testid probe
  // could not have served.
  await waitForHydration(page);
  await expectNoAxeViolations(page, "completion (hydrated render)");
});
