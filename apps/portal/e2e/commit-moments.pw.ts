/**
 * ADR-31 answer commitment: each control posts at its own commit moment, and the
 * server's same-step re-evaluation lands there (issue #31).
 *
 * | control | commit moment |
 * | --- | --- |
 * | boolean (RadioGroup) | change |
 * | singleChoice (RadioGroup / Select) | change |
 * | date (DatePicker) | completion - see the open question in the date test |
 * | number (NumberField) | blur |
 * | longText (TextArea) | blur |
 * | shortText (TextField) | blur - not in ADR-31's table, read as unchanged |
 * | multiChoice (CheckboxGroup) | group exit, focus leaves the whole group |
 *
 * The flow used to decide when to post from the answer VALUE: booleans and
 * multi-choice arrays went out on change, every string went out on blur. A
 * single-choice answer is a string (an OptionId), so it waited for focus to leave
 * the radio group, and a branch it gated appeared only after blur while a
 * multi-choice branch moved live on every toggle. The flow now reads the control
 * kind out of the compiled step document and posts at that control's moment.
 *
 * Every test here asserts the moment in BOTH directions, because "the answer
 * eventually posts" passes on the old behavior too:
 *
 * - **at the moment**: the post arrives from the named event alone, with nothing
 *   else having happened (no blur for change/completion; the group exit itself
 *   for multiChoice).
 * - **not before**: the total number of answer posts is counted across the whole
 *   interaction and pinned exactly. A partial date, a per-keystroke number or a
 *   per-toggle checkbox would each show up as an extra post, and posts are
 *   serialized in order, so a count taken after an awaited post is a complete
 *   accounting of everything that happened before it.
 *
 * Each test also watches every answer post's STATUS, because changing when
 * answers post could have made the known null-post/422 defect (issue #76) fire
 * more often. It must not: any non-200 fails the test.
 */

import type { Page, Request } from "@playwright/test";

import { test, expect } from "./support/gates.js";

import { readFixtures } from "./support/fixtures.js";
import {
  KS,
  answerPosted,
  blurActive,
  chooseRadio,
  commitCheckboxGroup,
  continueStep,
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

/** One recorded `POST /answers`: what it carried and how the API answered. */
interface AnswerPost {
  readonly questionId: string;
  readonly value: unknown;
  readonly status: number;
}

/**
 * Record every answer post the page makes, in order. Registered before the flow
 * starts, so the log is the complete history and a count is an accounting of
 * everything that has happened, not a sample.
 */
function watchAnswerPosts(page: Page): AnswerPost[] {
  const log: AnswerPost[] = [];
  page.on("response", (response) => {
    const request: Request = response.request();
    if (request.method() !== "POST" || !response.url().includes("/answers")) return;
    const body = JSON.parse(request.postData() ?? "{}") as {
      questionId?: string;
      value?: unknown;
    };
    log.push({
      questionId: body.questionId ?? "",
      value: body.value,
      status: response.status(),
    });
  });
  return log;
}

/** The posts recorded for one question, in order. */
function postsFor(log: readonly AnswerPost[], questionId: string): AnswerPost[] {
  return log.filter((post) => post.questionId === questionId);
}

/**
 * Every answer post so far was accepted. A 422 here is the null-post defect
 * (issue #76) firing: an untouched required field blurred into a `null` post the
 * API rejects. Changing the posting cadence must not provoke more of them.
 */
function expectNoRejectedPosts(log: readonly AnswerPost[]): void {
  expect(log.filter((post) => post.status !== 200)).toEqual([]);
}

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

  // --- shortText: typing posts nothing; blur posts once -----------------------
  // ADR-31 does not list shortText. It is read as UNCHANGED (blur), the only
  // reading consistent with the other free-entry rows - a TextField emits a
  // change per keystroke, so any earlier moment is a request per character.
  const name = page.getByRole("textbox", { name: KS.fullName });
  await name.click();
  await name.pressSequentially("Ada");
  expect(postsFor(log, "q_full_name")).toEqual([]);

  const namePosted = answerPosted(page);
  await blurActive(page);
  await namePosted;
  // Three keystrokes, one post, carrying the whole value: blur is the commit.
  expect(postsFor(log, "q_full_name")).toMatchObject([{ value: "Ada", status: 200 }]);

  // --- date: only a COMPLETE date is ever posted, and only once ---------------
  // ADR-31's date row says "on completion (all segments filled)". The vendored
  // react-aria DatePicker cannot signal that moment: its only completeness signal
  // is a non-empty value, which it raises on every digit typed into the year,
  // because a year segment holding "1" is a filled segment. This test pins what
  // the portal does instead - all segments filled is the PRECONDITION, and the
  // commit happens when editing ends - and, most importantly, pins the two things
  // that must be true under any resolution of that open question: no partial date
  // is ever posted, and a complete date is posted exactly once.
  const dob = page.getByRole("group", { name: KS.dob });
  const month = dob.getByRole("spinbutton", { name: /month/i });
  await month.click();
  await page.keyboard.type("05"); // month only: day and year are placeholders
  expect(postsFor(log, "q_dob")).toEqual([]);

  await page.keyboard.type("17199"); // 05 / 17 / 199_ - the year is unfinished
  await expect(month).not.toHaveText(/mm/i);
  // The three provisional COMPLETE dates react-aria emitted while the year filled
  // (0001-05-17, 0019-05-17, 0199-05-17) are not answers and were not posted.
  // Posting them is four appends, three API 422s and three "invalid value"
  // flashes on a question the respondent is still typing.
  expect(postsFor(log, "q_dob")).toEqual([]);

  const dobPosted = answerPosted(page);
  await page.keyboard.type("0"); // 1990: the date is now what was meant
  await blurActive(page);
  await dobPosted;

  // Eight keystrokes, four of them yielding a complete-but-provisional date: one
  // post, carrying the date the respondent actually entered.
  expect(postsFor(log, "q_dob")).toMatchObject([{ value: "1990-05-17", status: 200 }]);

  expectNoRejectedPosts(log);
});

test("an unfinished date is never posted as a null answer", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);

  // Enter a month, then leave the field with the date still unfinished - the
  // respondent got distracted, or tabbed on to read the rest of the step.
  const month = page.getByRole("group", { name: KS.dob }).getByRole("spinbutton", {
    name: /month/i,
  });
  await month.click();
  await page.keyboard.type("05");
  await blurActive(page);

  // Nothing was committed. Anchor that deterministically: post a DIFFERENT answer
  // and wait for it. Answer posts are serialized and ordered, so once the name
  // post has landed, anything the date field was going to send has already sent.
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

  // --- boolean: the selection alone reveals the same-step follow-up -----------
  const followUp = page.getByRole("textbox", { name: KS.count });
  await expect(followUp).toBeHidden();

  await watchFocusOut(page, "[data-qcms-field='q_at_fault_accident']");
  const yesPosted = answerPosted(page);
  await page.getByText("Yes", { exact: true }).click();
  await yesPosted;

  // Same-step reveal ON COMMIT: the follow-up is there off the click alone.
  await expect(followUp).toBeVisible();
  expect(postsFor(log, "q_at_fault_accident")).toMatchObject([{ value: true, status: 200 }]);
  expect(await focusOuts(page)).toBe(0);

  // --- number: keystrokes post nothing; blur posts the whole value once -------
  await followUp.click();
  await followUp.pressSequentially("10");
  expect(postsFor(log, "q_accident_count")).toEqual([]);

  const countPosted = answerPosted(page);
  await blurActive(page);
  await countPosted;
  // One post carrying 10, not one carrying 1 and another carrying 10.
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

  // The multi-choice gates a same-step long-text follow-up (containsAny rule).
  const followUp = page.getByRole("textbox", { name: KS.extraDetail });
  await expect(followUp).toBeHidden();

  // --- toggling inside the group commits nothing -----------------------------
  await toggleOption(page, "Breakdown");
  expect(postsFor(log, "q_optional_cover")).toEqual([]);
  // ...and the gated question stays hidden: no mid-interaction reveal, which is
  // exactly the churn ADR-31 defines the group-exit commit to avoid.
  await expect(followUp).toBeHidden();

  // Moving focus BETWEEN the group's own checkboxes is not an exit. This is the
  // distinction that makes group exit different from "any blur": the focusout
  // fires, but its relatedTarget is still inside the group.
  await toggleOption(page, "Windscreen");
  expect(await focusedQuestion(page)).toBe("q_optional_cover");
  expect(postsFor(log, "q_optional_cover")).toEqual([]);
  await expect(followUp).toBeHidden();

  // --- leaving the group commits once, with the whole cumulative array --------
  const exited = answerPosted(page);
  await page.getByTestId("primary-action").focus();
  await exited;

  // Two toggles and one intra-group focus move produced exactly ONE post.
  expect(postsFor(log, "q_optional_cover")).toMatchObject([
    { value: ["opt_breakdown", "opt_windscreen"], status: 200 },
  ]);
  // Same-step reveal AT THE COMMIT, per ADR-31's last column.
  await expect(followUp).toBeVisible();

  // --- focus leaving to nowhere is also an exit -------------------------------
  // relatedTarget === null: a click on the page background, or a tab out of the
  // document. `FieldBlur`'s containment check treats it as leaving the group.
  await toggleOption(page, "Legal");
  expect(postsFor(log, "q_optional_cover")).toHaveLength(1);

  await commitCheckboxGroup(page);
  expect(postsFor(log, "q_optional_cover")).toMatchObject([
    { value: ["opt_breakdown", "opt_windscreen"] },
    { value: ["opt_breakdown", "opt_windscreen", "opt_legal"], status: 200 },
  ]);

  // --- longText: the revealed follow-up commits on blur ----------------------
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
  // "No" keeps the number follow-up hidden, so this step has no extra required
  // question beyond the multi-choice.
  await chooseRadio(page, "No");
  await toggleOption(page, "Breakdown");
  await commitCheckboxGroup(page);
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

  // Nothing is answered on this step yet, so the flow is not ready to submit.
  const announcer = page.getByTestId("flow-announcer");
  await expect(announcer).not.toHaveText(READY_ANNOUNCEMENT);
  await watchFocusOut(page, "[data-qcms-field='q_coverage_level']");

  // Select the option the way a respondent does: one click on its label. Nothing
  // else happens - no tab away, no click elsewhere, no blur. Before the fix the
  // post never arrived without one and this wait times out.
  const posted = answerPosted(page);
  await page.getByText(COVERAGE_OPTION_LABEL, { exact: true }).click();
  await posted;

  expect(postsFor(log, "q_coverage_level")).toMatchObject([
    { value: COVERAGE_OPTION_ID, status: 200 },
  ]);
  expect(await focusOuts(page)).toBe(0);

  // The portal applied the projection the API returned for that post while the
  // selection is still the only thing that has happened: the live region
  // announces the flow became ready. That re-render is the same `setSnapshot`
  // path a branch reveal takes (`documentForVisible` over the returned
  // `visibleQuestions`), so a same-step question gated by this one moves here
  // too. No fixture pairs a singleChoice with a same-step rule - adding one means
  // a new question in the shared kitchen-sink form and a recompiled A2UI seed -
  // so the reveal is proven one link down the same chain.
  await expect(announcer).toHaveText(READY_ANNOUNCEMENT);
  await expect(page.getByRole("radio", { name: COVERAGE_OPTION_LABEL, exact: true })).toBeChecked();

  expectNoRejectedPosts(log);
});
