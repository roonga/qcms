/**
 * Every control type's clear path, end to end, at its ADR-31 commit moment
 * (issue #98, ADR-33).
 *
 * The audit these tests pin, control by control: one respondent gesture ("I
 * emptied this field") must reach the API as one thing - a `null` retraction, at
 * the moment ADR-31 gives that control - whichever control was emptied. Before
 * this, the same gesture reached the API three ways, which is what the issue set
 * out to find:
 *
 * | control | clear gesture | posted before | posts now |
 * | --- | --- | --- | --- |
 * | shortText | empty the box, blur | `""` (422 under minLength/pattern) | `null` |
 * | longText | empty the box, blur | `""` (an empty-string ANSWER) | `null` |
 * | number | empty the box, blur | `null` | `null` (unchanged) |
 * | date | backspace a segment, blur | `null` | `null` (unchanged, PR #97) |
 * | multiChoice | uncheck all, exit group | `[]` (422 under minSelected) | `null` |
 * | boolean, singleChoice | none exists | nothing | nothing |
 *
 * Each test therefore asserts three things, because any one of them alone passes on
 * the old behavior:
 *
 * - **the exact post count** for the question, across the whole interaction, from a
 *   log registered before the flow starts (see `support/answer-log.ts`). A clear
 *   that posted twice, or that posted while the respondent was still typing, shows
 *   up as an extra entry.
 * - **the exact body** of each post: `null` versus `""` versus `[]` is the entire
 *   subject of the issue, so a test that only counted posts would pass on all
 *   three.
 * - **the consequence**: the question is unanswered again, so Continue no longer
 *   advances and the error summary names the field. This is what makes the
 *   distinction matter rather than being a wire-format detail - `""` and `[]` are
 *   legal answers, so they *satisfied* required while holding nothing.
 *
 * The date's own clear path is `date-retraction.pw.ts` (it needed a DOM read to be
 * observable at all, so it has its own spec); what each ADAPTER emits, including
 * the Select the portal has no fixture for, is `@qcms/ui`'s `clear-paths.test.tsx`.
 */

import { test, expect } from "./support/gates.js";

import { expectNoRejectedPosts, postsFor, watchAnswerPosts } from "./support/answer-log.js";
import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import {
  KS,
  answerPosted,
  blurActive,
  chooseRadio,
  clearText,
  commitCheckboxGroup,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
  toggleOption,
} from "./support/kitchen-sink.js";

/** The session id in the URL the Start button landed on. */
function sessionIdOf(url: string): string {
  return new URL(url).pathname.split("/")[2] ?? "";
}

test("an emptied required shortText retracts at its blur commit", async ({ page }) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = sessionIdOf(page.url());
  expect(sessionId).toMatch(/^ses_/);

  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");

  // Emptying the box is not the commit: shortText commits on blur (ADR-31), so
  // nothing has posted yet and the answer count is still one.
  const name = page.getByRole("textbox", { name: KS.fullName });
  await name.click();
  await name.fill("");
  expect(postsFor(log, "q_full_name")).toHaveLength(1);

  const retracted = answerPosted(page);
  await blurActive(page);
  await retracted;

  // Exactly two posts, and the second is the retraction - NOT the empty string
  // this used to send, which `q_full_name`'s minLength/pattern rejects 422 while
  // the server keeps the previous answer.
  expect(postsFor(log, "q_full_name")).toEqual([
    { questionId: "q_full_name", value: "Ada Lovelace", status: 200 },
    { questionId: "q_full_name", value: null, status: 200 },
  ]);

  // The consequence: the required question is unanswered again.
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.getByTestId("error-summary")).toContainText(KS.fullName);
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Driving history" })).toHaveCount(0);
  expectNoRejectedPosts(log);

  // Independent DB verification: the answer is gone from the read model while the
  // whole history, tombstone included, is still in the ledger (R3 / ADR-17).
  const db = await openDb(databaseUrl);
  try {
    const latest = await db.latestAnswers(sessionId);
    expect(latest.has("q_full_name")).toBe(false);
    const rows = (await db.answerRows(sessionId)).filter((r) => r.questionId === "q_full_name");
    expect(rows.map((r) => [r.value, r.retracted])).toEqual([
      ["Ada Lovelace", false],
      [null, true],
    ]);
  } finally {
    await db.close();
  }
});

test("an emptied optional longText retracts rather than storing an empty string", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = sessionIdOf(page.url());
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await chooseRadio(page, "No");

  // The long text is the branch the multi-choice gates, and it is OPTIONAL - the
  // case where the old empty-string post was ACCEPTED (200) rather than rejected,
  // and so quietly became an answer of nothing that satisfied presence checks.
  await toggleOption(page, "Breakdown");
  await commitCheckboxGroup(page);
  const detail = page.getByRole("textbox", { name: KS.extraDetail });
  await expect(detail).toBeVisible();

  await fillText(page, KS.extraDetail, "No claims");
  await clearText(page, KS.extraDetail);

  expect(postsFor(log, "q_extra_detail")).toEqual([
    { questionId: "q_extra_detail", value: "No claims", status: 200 },
    { questionId: "q_extra_detail", value: null, status: 200 },
  ]);
  expectNoRejectedPosts(log);

  const db = await openDb(databaseUrl);
  try {
    // Absent, not present-and-empty. This is the assertion the empty-string answer
    // would fail while every count and status above still passed.
    const latest = await db.latestAnswers(sessionId);
    expect(latest.has("q_extra_detail")).toBe(false);
    const rows = (await db.answerRows(sessionId)).filter((r) => r.questionId === "q_extra_detail");
    expect(rows.map((r) => [r.value, r.retracted])).toEqual([
      ["No claims", false],
      [null, true],
    ]);
  } finally {
    await db.close();
  }
});

test("an emptied required number retracts at its blur commit", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  // "Yes" reveals the required number follow-up.
  await chooseRadio(page, "Yes");

  const count = page.getByRole("textbox", { name: KS.count });
  await count.click();
  await count.pressSequentially("10");
  const posted = answerPosted(page);
  await blurActive(page);
  await posted;

  await count.click();
  await count.fill("");
  // Number commits on blur too, so emptying alone has posted nothing.
  expect(postsFor(log, "q_accident_count")).toHaveLength(1);

  const retracted = answerPosted(page);
  await blurActive(page);
  await retracted;
  expect(postsFor(log, "q_accident_count")).toEqual([
    { questionId: "q_accident_count", value: 10, status: 200 },
    { questionId: "q_accident_count", value: null, status: 200 },
  ]);

  // The revealed required question is unanswered again, so this step is blocked.
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  expectNoRejectedPosts(log);
});

test("a multiChoice unchecked to empty retracts at its group-exit commit", async ({ page }) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = sessionIdOf(page.url());
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await chooseRadio(page, "No");

  await toggleOption(page, "Breakdown");
  await commitCheckboxGroup(page);
  expect(postsFor(log, "q_optional_cover")).toEqual([
    { questionId: "q_optional_cover", value: ["opt_breakdown"], status: 200 },
  ]);
  // The gated follow-up is open, which is how the retraction's effect on rule
  // evaluation becomes visible further down.
  await expect(page.getByRole("textbox", { name: KS.extraDetail })).toBeVisible();

  // Unchecking is not the commit: a multiChoice commits on group exit (ADR-31),
  // so the group can be emptied without a single request.
  await toggleOption(page, "Breakdown");
  expect(postsFor(log, "q_optional_cover")).toHaveLength(1);

  const retracted = answerPosted(page);
  await blurActive(page);
  await retracted;

  // Exactly two posts, and the second is `null` - NOT the `[]` this used to send.
  // `[]` is a legal multiChoice answer, so the old post was an answer of the empty
  // set; here it is rejected 422 by `minSelected: 1` while the server kept the
  // previous selection, and on an unconstrained question it would have been stored
  // and counted as answered.
  expect(postsFor(log, "q_optional_cover")).toEqual([
    { questionId: "q_optional_cover", value: ["opt_breakdown"], status: 200 },
    { questionId: "q_optional_cover", value: null, status: 200 },
  ]);
  expectNoRejectedPosts(log);

  // The server re-evaluated with the question unanswered, so the rule that read
  // its selection closed the branch it had opened (R2: the API is the only
  // evaluator; the portal only rendered what came back).
  await expect(page.getByRole("textbox", { name: KS.extraDetail })).toBeHidden();

  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.getByTestId("error-summary")).toContainText(KS.optionalCover);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  const db = await openDb(databaseUrl);
  try {
    const latest = await db.latestAnswers(sessionId);
    expect(latest.has("q_optional_cover")).toBe(false);
    const rows = (await db.answerRows(sessionId)).filter(
      (r) => r.questionId === "q_optional_cover",
    );
    expect(rows.map((r) => [r.value, r.retracted])).toEqual([
      [["opt_breakdown"], false],
      [null, true],
    ]);
  } finally {
    await db.close();
  }
});

test("unchecking one of several options is an answer, not a clear", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await chooseRadio(page, "No");

  await toggleOption(page, "Breakdown");
  await toggleOption(page, "Windscreen");
  await commitCheckboxGroup(page);

  // Deselecting down to a NON-empty selection is an ordinary answer revision: the
  // retraction path must not swallow it.
  await toggleOption(page, "Breakdown");
  await commitCheckboxGroup(page);

  expect(postsFor(log, "q_optional_cover")).toEqual([
    { questionId: "q_optional_cover", value: ["opt_breakdown", "opt_windscreen"], status: 200 },
    { questionId: "q_optional_cover", value: ["opt_windscreen"], status: 200 },
  ]);
  expectNoRejectedPosts(log);
});

test("a discrete choice has no clear path: it can be changed, never emptied", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);

  // --- boolean -----------------------------------------------------------------
  await chooseRadio(page, "No");
  const no = page.getByRole("radio", { name: "No", exact: true });

  // Every gesture a respondent might reach for to un-answer a radio. None is a
  // clear: react-aria emits no change, so no post is made and the radio stays
  // selected. A boolean or singleChoice question therefore travels unanswered ->
  // answered -> another answer, and never back to unanswered (whole-session
  // erasure is the only other door, and is out of ADR-33's scope).
  await no.click({ force: true });
  await no.focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");

  // Anchor deterministically rather than on a timer: post a DIFFERENT answer and
  // wait for it. Answer posts are serialized and ordered, so once that post has
  // landed, anything the radio group was going to send has already sent.
  await toggleOption(page, "Breakdown");
  await commitCheckboxGroup(page);

  expect(postsFor(log, "q_at_fault_accident")).toEqual([
    { questionId: "q_at_fault_accident", value: false, status: 200 },
  ]);
  await expect(no).toBeChecked();

  // --- singleChoice (the same control, on the final step) ----------------------
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

  const standard = page.getByRole("radio", { name: "Standard", exact: true });
  const posted = answerPosted(page);
  await page.getByText("Standard", { exact: true }).click();
  await posted;

  await standard.click({ force: true });
  await standard.focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");

  // Re-selecting the SAME option is not a clear either, and the flow's dedupe
  // means it is not even a second post; changing to another option is.
  const changed = answerPosted(page);
  await page.getByText("Premium", { exact: true }).click();
  await changed;

  expect(postsFor(log, "q_coverage_level")).toEqual([
    { questionId: "q_coverage_level", value: "opt_standard", status: 200 },
    { questionId: "q_coverage_level", value: "opt_premium", status: 200 },
  ]);
  expectNoRejectedPosts(log);
});
