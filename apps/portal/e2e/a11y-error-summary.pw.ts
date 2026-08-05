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
import { waitForHydration } from "./support/hydration.js";
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

/**
 * Task 048 (ADR-32): author-supplied messages must not be able to undo issue
 * #21's fix. The hard case is two questions whose authors wrote the SAME custom
 * `required` wording - the exact shape that produced indistinguishable accessible
 * names before #21, now reachable through authored content rather than through a
 * single shared default sentence.
 *
 * The composition stays label-anchored, with the author's wording as the sentence
 * body, so the two entries are still distinct in the browser's accessibility tree.
 * The `author-messages` fixture's `q_am_plate` and `q_am_vin` carry byte-identical
 * `required` messages for exactly this test.
 */
test("error summary: identical custom messages still have distinct accessible names", async ({
  page,
}) => {
  const { authorMessagesSlug } = readFixtures();
  await page.goto(`/f/${authorMessagesSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("textbox", { name: "Registration plate" })).toBeVisible();
  await waitForHydration(page);

  // Continue with nothing answered: all four required questions are missing.
  await page.getByTestId("primary-action").click();
  const summary = page.getByTestId("error-summary");
  await expect(summary).toBeVisible();

  // Both authors wrote "Check the vehicle paperwork". Each entry is nonetheless
  // named by its own question, so each of these queries matches exactly one link -
  // and a bare-message composition would have matched two with one name and zero
  // with the other.
  const plate = summary.getByRole("link", {
    name: "Registration plate: Check the vehicle paperwork",
  });
  const vin = summary.getByRole("link", { name: "VIN: Check the vehicle paperwork" });
  await expect(plate).toHaveCount(1);
  await expect(vin).toHaveCount(1);
  await expect(plate).toHaveAttribute("href", "#q_am_plate");
  await expect(vin).toHaveAttribute("href", "#q_am_vin");

  // The property, stated over the whole summary: as many distinct accessible names
  // as there are entries. The two booleans carry no `required` message, so they
  // keep the default sentence - which is also distinct, being label-anchored.
  const names = await summary
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.textContent?.trim() ?? ""));
  expect(names).toHaveLength(4);
  expect(new Set(names).size).toBe(4);

  // Unchanged behaviour: activating an entry still moves focus into its field.
  await vin.click();
  expect(await focusedQuestion(page)).toBe("q_am_vin");
});
