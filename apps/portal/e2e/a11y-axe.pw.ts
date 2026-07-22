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
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { COUNT_LABEL, answerCount, chooseAccident, startAnonymousFlow } from "./support/flow.js";
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

/** Run axe on the current page state; fail on any violation, prove it ran. */
async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ");
  expect(results.violations, `axe violations at "${label}": ${summary}`).toEqual([]);
  // Guard against a vacuous pass: axe must have exercised real rules here.
  expect(results.passes.length, `axe ran no rules at "${label}"`).toBeGreaterThan(0);
}

test("axe: entry page has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expectNoAxeViolations(page, "entry");
});

test("axe: flow initial, branch-inserted, and branch-removed states have zero violations", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  await expectNoAxeViolations(page, "flow initial");

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
  await expectNoAxeViolations(page, "completion");
});
