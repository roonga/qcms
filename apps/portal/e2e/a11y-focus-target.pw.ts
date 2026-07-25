/**
 * Where the error summary's "jump to field" links actually land focus, for every
 * question type the kitchen-sink corpus renders (issue #76).
 *
 * The regression this guards: `firstFocusableIn` preferred the first
 * INPUT/TEXTAREA/SELECT in a field, and react-aria's DatePicker renders a
 * `display: none` native text input (its soft-keyboard entry path) that is NOT
 * inside an `aria-hidden` subtree. That input won the preference, `.focus()` on it
 * was a silent no-op, and `focusQuestion` still reported success, so activating a
 * date question's error-summary entry moved focus nowhere (WCAG 2.4.3 / 3.3.1).
 *
 * Assertions are on the PROPERTIES of the focused element (which question wraps
 * it, its tag/role, that it is rendered and not aria-hidden), not on a selector
 * chain into a vendored component's internals. Covering every type in one spec is
 * deliberate: the preference order is shared, so a fix for the date field must be
 * shown not to have moved the target for any other control.
 */

import { expect, test } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import {
  KS,
  answerNumber,
  checkOption,
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
  // Polled rather than read once: answering a question re-renders the step (the
  // summary shrinks), so focus is asserted after the page has settled.
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
  // The hydrated flow owns the jump-to-field handler; the SSR paint does not.
  await expect(page.getByTestId("flow-announcer")).toBeAttached();

  // Each question is ANSWERED while focus is still in it, before the next entry
  // is activated. Leaving a required question still empty posts `null` on blur,
  // which the API rejects with a 422 (correctly: the value is invalid), and the
  // shared console gate fails the test on the resulting browser error. That
  // posting policy is a separate concern, so this spec avoids provoking it.

  // --- Step 1: shortText and the DatePicker (the #76 regression) ------------
  await expectMissing(page, ["q_full_name", "q_dob"]);
  // The date field's value control is an editable SEGMENT, not an input: a span
  // carrying role=spinbutton. Before the fix this focused nothing at all.
  await expectEntryFocuses(page, "q_dob", { tag: "SPAN", type: null, role: "spinbutton" });
  await enterDate(page, "05171990");
  await expectEntryFocuses(page, "q_full_name", { tag: "INPUT", type: "text", role: null });
  await fillText(page, KS.fullName, "Ada Lovelace");
  await continueStep(page);

  // --- Step 2: multiChoice checkbox and boolean radio ----------------------
  await expectMissing(page, ["q_at_fault_accident", "q_optional_cover"]);
  await expectEntryFocuses(page, "q_optional_cover", {
    tag: "INPUT",
    type: "checkbox",
    role: null,
  });
  // Also reveals q_extra_detail (containsAny rule), used further down.
  await checkOption(page, "Breakdown");
  await expectEntryFocuses(page, "q_at_fault_accident", {
    tag: "INPUT",
    type: "radio",
    role: null,
  });

  // --- Step 2, branch inserted: the NumberField -----------------------------
  // Answering Yes reveals q_accident_count, whose field wraps its input in two
  // stepper <button>s. The target must stay the input, never a stepper.
  await chooseRadio(page, "Yes");
  await expect(page.getByRole("textbox", { name: KS.count })).toBeVisible();
  await expectMissing(page, ["q_accident_count"]);
  await expectEntryFocuses(page, "q_accident_count", { tag: "INPUT", type: "text", role: null });
  await answerNumber(page, "2");

  // --- Step 2: longText has a single candidate, so no preference can misfire -
  // q_extra_detail is optional, so it never appears in the error summary and
  // cannot be reached through an entry. Assert instead that its field offers
  // exactly one focusable target, which makes the preference order moot for it.
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

  // --- Step 3: singleChoice radio group ------------------------------------
  await expectMissing(page, ["q_coverage_level"]);
  await expectEntryFocuses(page, "q_coverage_level", { tag: "INPUT", type: "radio", role: null });
  await chooseSingleChoice(page, "Standard");
});
