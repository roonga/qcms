/**
 * Error-summary identification in the real accessibility tree (issue #21, WCAG
 * 3.3.1 Error Identification).
 *
 * Every missing-required entry once rendered the same sentence, so all summary
 * links had the SAME accessible name: a screen-reader user hearing "This question
 * needs an answer." once per entry could not tell which field any link pointed at.
 * Each entry now names its own question.
 *
 * The assertions below are role + accessible-name queries resolved by the browser
 * (Playwright's `getByRole` name filter uses the computed accessible name), not
 * markup snapshots: the link's own text is what a screen reader announces. They
 * also hold the line on what already worked - the anchor still targets
 * `#<questionId>` and clicking an entry still moves focus into that field.
 *
 * The kitchen-sink first step is the fixture with more than one required question
 * (Full name, Date of birth), which is what makes indistinguishable names visible.
 */

import { expect, test } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { KS, startKitchenSink } from "./support/kitchen-sink.js";

/** The questionId of the field wrapper the focused control sits in, if any. */
function focusedQuestion(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.activeElement?.closest<HTMLElement>("[data-qcms-field]")?.dataset.qcmsField ?? null,
  );
}

test("error summary: each link names its own field and jumps to it", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);

  // Continue with both required questions unanswered surfaces the summary and does
  // not advance (ADR-28); it is focused and assertive (task 030), unchanged here.
  await page.getByTestId("primary-action").click();
  const summary = page.getByTestId("error-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();

  // Two entries, and each one's ACCESSIBLE NAME contains its own question label:
  // the names are therefore distinct. Before the fix both links were named
  // "This question needs an answer." and each of these queries matched 0.
  const links = summary.getByRole("link");
  await expect(links).toHaveCount(2);
  const fullName = summary.getByRole("link", { name: `${KS.fullName} needs an answer.` });
  const dob = summary.getByRole("link", { name: `${KS.dob} needs an answer.` });
  await expect(fullName).toHaveCount(1);
  await expect(dob).toHaveCount(1);

  // Unchanged behaviour: each anchor still targets its own question, and activating
  // an entry still moves focus INTO that question's field. Which control inside a
  // field receives focus is `focusQuestion`'s policy (`lib/a11y.ts`, unit-tested
  // there), so this asserts the wrapper the focus landed in, not a control type.
  await expect(fullName).toHaveAttribute("href", "#q_full_name");
  await expect(dob).toHaveAttribute("href", "#q_dob");

  await fullName.click();
  expect(await focusedQuestion(page)).toBe("q_full_name");
  await expect(page.getByRole("textbox", { name: KS.fullName })).toBeFocused();
});
