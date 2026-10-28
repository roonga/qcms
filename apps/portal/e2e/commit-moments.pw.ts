/**
 * ADR-31 answer commitment: each control posts at its own commit moment, and the
 * server's same-step re-evaluation lands there.
 *
 * The flow used to decide when to post from the answer value, so a single-choice answer,
 * being a string, waited for focus to leave the radio group while a multi-choice branch
 * moved on every toggle. It now reads the control kind out of the compiled document.
 *
 * Every test asserts the moment in both directions, because "the answer eventually
 * posts" passes on the old behaviour too: at the moment, from the named event alone, and
 * not before, by pinning the exact post count across the whole interaction. A partial
 * date, a per-keystroke number or a per-toggle checkbox would each show up as an extra
 * post, and posts are serialized, so a count taken after an awaited post is a complete
 * accounting.
 *
 * Each test also watches every post's status: any non-200 fails it.
 */

import type { Page } from "@playwright/test";

import { test, expect } from "./support/gates.js";

import { expectNoRejectedPosts, postsFor, watchAnswerPosts } from "./support/answer-log.js";
import { readFixtures } from "./support/fixtures.js";
import {
  KS,
  answerPosted,
  blurActive,
  chooseFromSelect,
  chooseRadio,
  commitCheckboxGroup,
  continueStep,
  dateParts,
  dateSegmentOrder,
  enterDate,
  fillText,
  startKitchenSink,
  toggleOption,
} from "./support/kitchen-sink.js";

/** The single-choice question's option on the final step. */
const COVERAGE_OPTION_LABEL = "Standard";
const COVERAGE_OPTION_ID = "opt_standard";

/** The live-region text for "every question is answered" (lib/i18n/en.ts). */
const READY_ANNOUNCEMENT = "You have answered everything. You can now submit.";

/** The questionId of the control that currently holds focus, via `FieldBlur`'s handle. */
function focusedQuestion(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof Element)) return null;
    return el.closest("[data-qcms-field]")?.getAttribute("data-qcms-field") ?? null;
  });
}

/**
 * Start counting `focusout` events raised inside any control on the page.
 * Registered in the capture phase so it sees the event before React's delegated
 * `onBlur` handler could act on it.
 */
async function watchFocusOut(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const state = window as unknown as { qcmsFocusOutCount?: number };
    state.qcmsFocusOutCount = 0;
    document.addEventListener(
      "focusout",
      (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(sel) !== null) {
          state.qcmsFocusOutCount = (state.qcmsFocusOutCount ?? 0) + 1;
        }
      },
      true,
    );
  }, selector);
}

/** How many matching focusouts have happened since the watch started. */
function focusOuts(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { qcmsFocusOutCount?: number }).qcmsFocusOutCount ?? 0,
  );
}

test("shortText commits on blur, and a date commits once, only when complete", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);

  const name = page.getByRole("textbox", { name: KS.fullName });
  await name.click();
  await name.pressSequentially("Ada");
  expect(postsFor(log, "q_full_name")).toEqual([]);

  const namePosted = answerPosted(page);
  await blurActive(page);
  await namePosted;
  expect(postsFor(log, "q_full_name")).toMatchObject([{ value: "Ada", status: 200 }]);

  const dob = page.getByRole("group", { name: KS.dob });
  const month = dob.getByRole("spinbutton", { name: /month/i });
  const order = await dateSegmentOrder(dob);
  const parts = dateParts("05171990");
  const typed = order.map((part) => parts[part]).join("");
  await dob.getByRole("spinbutton", { name: new RegExp(order[0] ?? "month", "i") }).click();
  await page.keyboard.type(typed.slice(0, 2)); // the first part only: the rest are placeholders
  expect(postsFor(log, "q_dob")).toEqual([]);

  await page.keyboard.type(typed.slice(2, -1)); // every part, the year one digit short
  await expect(month).not.toHaveText(/mm/i);
  expect(postsFor(log, "q_dob")).toEqual([]);

  const dobPosted = answerPosted(page);
  await page.keyboard.type(typed.slice(-1)); // 1990: the date is now what was meant
  await blurActive(page);
  await dobPosted;

  expect(postsFor(log, "q_dob")).toMatchObject([{ value: "1990-05-17", status: 200 }]);

  expectNoRejectedPosts(log);
});

test("an unfinished date is never posted as a null answer", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);

  const month = page.getByRole("group", { name: KS.dob }).getByRole("spinbutton", {
    name: /month/i,
  });
  await month.click();
  await page.keyboard.type("05");
  await blurActive(page);

  await fillText(page, KS.fullName, "Ada Lovelace");
  expect(postsFor(log, "q_dob")).toEqual([]);
  expectNoRejectedPosts(log);
});

test("boolean commits on change and reveals its follow-up; number commits on blur", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  const followUp = page.getByRole("textbox", { name: KS.count });
  await expect(followUp).toBeHidden();

  await watchFocusOut(page, "[data-qcms-field='q_at_fault_accident']");
  const yesPosted = answerPosted(page);
  await page.getByText("Yes", { exact: true }).click();
  await yesPosted;

  await expect(followUp).toBeVisible();
  expect(postsFor(log, "q_at_fault_accident")).toMatchObject([{ value: true, status: 200 }]);
  expect(await focusOuts(page)).toBe(0);

  await followUp.click();
  await followUp.pressSequentially("10");
  expect(postsFor(log, "q_accident_count")).toEqual([]);

  const countPosted = answerPosted(page);
  await blurActive(page);
  await countPosted;
  expect(postsFor(log, "q_accident_count")).toMatchObject([{ value: 10, status: 200 }]);

  expectNoRejectedPosts(log);
});

test("multiChoice commits on group exit, not per toggle, and reveals at the commit", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  const followUp = page.getByRole("textbox", { name: KS.extraDetail });
  await expect(followUp).toBeHidden();

  await toggleOption(page, "Breakdown");
  expect(postsFor(log, "q_optional_cover")).toEqual([]);
  await expect(followUp).toBeHidden();

  await toggleOption(page, "Windscreen");
  expect(await focusedQuestion(page)).toBe("q_optional_cover");
  expect(postsFor(log, "q_optional_cover")).toEqual([]);
  await expect(followUp).toBeHidden();

  const exited = answerPosted(page);
  await page.getByTestId("primary-action").focus();
  await exited;

  expect(postsFor(log, "q_optional_cover")).toMatchObject([
    { value: ["opt_breakdown", "opt_windscreen"], status: 200 },
  ]);
  await expect(followUp).toBeVisible();

  await toggleOption(page, "Legal");
  expect(postsFor(log, "q_optional_cover")).toHaveLength(1);

  await commitCheckboxGroup(page);
  expect(postsFor(log, "q_optional_cover")).toMatchObject([
    { value: ["opt_breakdown", "opt_windscreen"] },
    { value: ["opt_breakdown", "opt_windscreen", "opt_legal"], status: 200 },
  ]);

  await followUp.click();
  await followUp.pressSequentially("No claims");
  expect(postsFor(log, "q_extra_detail")).toEqual([]);

  const detailPosted = answerPosted(page);
  await blurActive(page);
  await detailPosted;
  expect(postsFor(log, "q_extra_detail")).toMatchObject([{ value: "No claims", status: 200 }]);

  expectNoRejectedPosts(log);
});

test("singleChoice commits on change, with no blur", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await chooseRadio(page, "No");
  await toggleOption(page, "Breakdown");
  await commitCheckboxGroup(page);
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

  await chooseFromSelect(page, "q_body_type", "Wagon");

  const announcer = page.getByTestId("flow-announcer");
  await expect(announcer).not.toHaveText(READY_ANNOUNCEMENT);
  await watchFocusOut(page, "[data-qcms-field='q_coverage_level']");

  const posted = answerPosted(page);
  await page.getByText(COVERAGE_OPTION_LABEL, { exact: true }).click();
  await posted;

  expect(postsFor(log, "q_coverage_level")).toMatchObject([
    { value: COVERAGE_OPTION_ID, status: 200 },
  ]);
  expect(await focusOuts(page)).toBe(0);

  await expect(announcer).toHaveText(READY_ANNOUNCEMENT);
  await expect(page.getByRole("radio", { name: COVERAGE_OPTION_LABEL, exact: true })).toBeChecked();

  expectNoRejectedPosts(log);
});
