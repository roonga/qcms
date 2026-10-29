import { expect, test } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import {
  KS,
  answerNumber,
  checkOption,
  chooseFromSelect,
  chooseRadio,
  chooseSingleChoice,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
} from "./support/kitchen-sink.js";

/** The properties that decide whether a focus target is the right one. */
interface FocusTarget {
  /** The question whose `[data-qcms-field]` wrapper contains the focused element. */
  readonly questionId: string | null;
  readonly tag: string;
  readonly type: string | null;
  readonly role: string | null;
  /** False for a `display: none` / detached element, where `.focus()` is a no-op. */
  readonly rendered: boolean;
  /** True when the element sits in a subtree hidden from the accessibility tree. */
  readonly inAriaHidden: boolean;
}

/** Read the focused element's identifying properties out of the page. */
function focusTarget(page: Page): Promise<FocusTarget | null> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    return {
      questionId: element.closest<HTMLElement>("[data-qcms-field]")?.dataset.qcmsField ?? null,
      tag: element.tagName,
      type: element.getAttribute("type"),
      role: element.getAttribute("role"),
      rendered: element.getClientRects().length > 0,
      inAriaHidden: element.closest("[aria-hidden='true']") !== null,
    };
  });
}

/**
 * Activate one error-summary entry and assert where focus lands. Entries are
 * addressed by their `#questionId` anchor because every entry shares the same
 * visible text, so an accessible-name lookup cannot tell them apart.
 */
async function expectEntryFocuses(
  page: Page,
  questionId: string,
  expected: Omit<FocusTarget, "questionId" | "rendered" | "inAriaHidden">,
): Promise<void> {
  const summary = page.getByTestId("error-summary");
  await expect(summary).toBeVisible();
  await summary.locator(`a[href="#${questionId}"]`).click();
  await expect
    .poll(() => focusTarget(page))
    .toEqual({ ...expected, questionId, rendered: true, inAriaHidden: false });
}

/** Blocked Continue: the summary lists exactly the still-missing required ids. */
async function expectMissing(page: Page, questionIds: readonly string[]): Promise<void> {
  await page.getByTestId("primary-action").click();
  const entries = page.getByTestId("error-summary").getByRole("link");
  await expect(entries).toHaveCount(questionIds.length);
  const hrefs = await entries.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  expect(new Set(hrefs)).toEqual(new Set(questionIds.map((id) => `#${id}`)));
}

test("error-summary entries land focus on each question type's value control", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  await expect(page.getByTestId("flow-announcer")).toBeAttached();

  await expectMissing(page, ["q_full_name", "q_dob"]);
  await expectEntryFocuses(page, "q_full_name", { tag: "INPUT", type: "text", role: null });
  await expectEntryFocuses(page, "q_dob", { tag: "SPAN", type: null, role: "spinbutton" });
  await enterDate(page, "05171990");
  await fillText(page, KS.fullName, "Ada Lovelace");
  await continueStep(page);

  await expectMissing(page, ["q_at_fault_accident", "q_optional_cover"]);
  await expectEntryFocuses(page, "q_optional_cover", {
    tag: "INPUT",
    type: "checkbox",
    role: null,
  });
  await expectEntryFocuses(page, "q_at_fault_accident", {
    tag: "INPUT",
    type: "radio",
    role: null,
  });
  await checkOption(page, "Breakdown");

  await chooseRadio(page, "Yes");
  await expect(page.getByRole("textbox", { name: KS.count })).toBeVisible();
  await expectMissing(page, ["q_accident_count"]);
  await expectEntryFocuses(page, "q_accident_count", { tag: "INPUT", type: "text", role: null });
  await answerNumber(page, "2");

  await expect(page.getByRole("textbox", { name: KS.extraDetail })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const field = document.querySelector('[data-qcms-field="q_extra_detail"]');
        const focusable = Array.from(
          field?.querySelectorAll<HTMLElement>(
            "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
          ) ?? [],
        ).filter(
          (element) =>
            element.closest("[aria-hidden='true']") === null && element.getClientRects().length > 0,
        );
        return focusable.map((element) => element.tagName);
      }),
    )
    .toEqual(["TEXTAREA"]);
  await continueStep(page);

  await expectMissing(page, ["q_coverage_level", "q_body_type"]);
  await expectEntryFocuses(page, "q_coverage_level", { tag: "INPUT", type: "radio", role: null });
  await chooseSingleChoice(page, "Standard");

  await expectMissing(page, ["q_body_type"]);
  await expectEntryFocuses(page, "q_body_type", { tag: "BUTTON", type: "button", role: null });
  await chooseFromSelect(page, "q_body_type", "Wagon");
});
