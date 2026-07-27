/**
 * Resume (task 029, exit criterion 1; then issue #146).
 *
 * Revisiting `/s/:sessionId` with the valid httpOnly session cookie resumes at the
 * current step: the SSR flow page renders the step content again after a full
 * reload, no client state required.
 *
 * Issue #146 is what the rest of this file exists for. The original spec asserted
 * only that the question TEXT came back, so it passed while the resumed step
 * rendered every previously answered control EMPTY over a server that still held
 * the answers. That was not a cosmetic gap: the client's "what has been posted"
 * record was empty too, so focus merely entering and leaving an untouched control
 * looked like a fresh commit of an emptied field and posted the ADR-33 `null`
 * retraction, destroying the stored answer. Both halves are pinned below: the value
 * is DISPLAYED, and nothing is posted by loading, rendering, or touching a resumed
 * control.
 *
 * Which control types a *resumed* step can show is decided by the resume rule, not
 * by preference: `/s/:id` serves the first INCOMPLETE step, so the resumed step
 * always has one unanswered required question, and only the other questions on that
 * step can carry a stored answer. On the kitchen-sink fixture that means step 1
 * displays whichever of shortText / date is not the gap, and the singleChoice step
 * (one question) can never be the resumed step at all. The remaining types are
 * therefore asserted on the FIRST NAVIGATION out of the resumed step, which is the
 * same defect one step over (a client that mounted holding nothing) and an equally
 * real respondent path: Continue from a resumed session into a step answered before
 * the reload. Per-adapter display of all eight renderings in the #98 audit table,
 * including the Select the portal has no fixture for, is `@qcms/ui`'s
 * `seeded-values.test.tsx`; the served payload is `serve-step.integration.test.ts`.
 */

import type { Page } from "@playwright/test";

import { expect, test } from "./support/gates.js";

import { expectNoRejectedPosts, watchAnswerPosts } from "./support/answer-log.js";
import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";
import {
  KS,
  answerNumber,
  backStep,
  blurActive,
  checkOption,
  chooseRadio,
  chooseSingleChoice,
  clearText,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
} from "./support/kitchen-sink.js";

/** The session id in the URL the Start button landed on. */
function sessionIdOf(url: string): string {
  return new URL(url).pathname.split("/")[2] ?? "";
}

/** Reload the flow page and wait for the resumed step to hydrate. */
async function resume(page: Page): Promise<void> {
  await page.reload();
  await expect(page).toHaveURL(/\/s\/ses_/);
  await waitForHydration(page);
}

/** The month segment of the date control (its placeholder means "unanswered"). */
function dobMonth(page: Page) {
  return page.getByRole("group", { name: KS.dob }).getByRole("spinbutton", { name: /month/i });
}

test("reloading the flow page resumes the session from the cookie", async ({ page }) => {
  const { slug } = readFixtures();

  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText("Any at-fault accident in the last 3 years?")).toBeVisible();

  // A full reload re-runs the SSR flow page; the session cookie resumes the step.
  await page.reload();
  await expect(page).toHaveURL(/\/s\/ses_/);
  await expect(page.getByText("Any at-fault accident in the last 3 years?")).toBeVisible();
});

test("a resumed step displays the shortText answer the server holds, and touching it posts nothing", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { kitchenSinkSlug, databaseUrl } = readFixtures();

  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = sessionIdOf(page.url());
  await fillText(page, KS.fullName, "Ada Lovelace");
  // q_dob is still unanswered, so step 1 stays the first incomplete step and the
  // resume lands back on it with q_full_name already answered.

  const log = watchAnswerPosts(page);
  await resume(page);

  // Exit criterion: merely loading and rendering a resumed step posts NOTHING.
  expect(log).toEqual([]);
  // The answer the server holds is on screen, not an empty box over it.
  await expect(page.getByRole("textbox", { name: KS.fullName })).toHaveValue("Ada Lovelace");
  // A never-answered question is still empty: seeding shows what is stored, and
  // stored is exactly what `latestAnswers` reports.
  await expect(dobMonth(page)).toHaveText(/mm/i);

  // The data-loss gesture (issue #146): focus enters and leaves the resumed
  // control without changing anything. shortText commits on blur (ADR-31), so
  // before the fix this posted `value: null` - an ADR-33 retraction of an answer
  // the respondent never touched - and the stored answer was gone.
  await page.getByRole("textbox", { name: KS.fullName }).click();
  await blurActive(page);

  // Answer posts are serialized and ordered, so a log read taken after an AWAITED
  // post accounts for everything that happened before it: if the blur above had
  // posted, its entry would sit ahead of the date's.
  await enterDate(page, "05171990");
  expect(log).toEqual([{ questionId: "q_dob", value: "1990-05-17", status: 200 }]);
  expectNoRejectedPosts(log);

  // And the ledger is intact: one row for the name, no tombstone.
  const db = await openDb(databaseUrl);
  try {
    expect(Object.fromEntries(await db.latestAnswers(sessionId))).toEqual({
      q_full_name: "Ada Lovelace",
      q_dob: "1990-05-17",
    });
    expect(await db.answerCount(sessionId, "q_full_name")).toBe(1);
  } finally {
    await db.close();
  }
});

test("a resumed session displays every other control type the server holds, and a retracted answer as unanswered", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { kitchenSinkSlug } = readFixtures();

  // Answer the whole form once, so every question has a stored answer.
  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await chooseRadio(page, "Yes"); // boolean -> reveals the number follow-up
  await answerNumber(page, "2");
  await checkOption(page, "Breakdown"); // multiChoice -> reveals the long text
  await fillText(page, KS.extraDetail, "Kerb damage");
  await continueStep(page);
  await chooseSingleChoice(page, "Standard");

  // Walk back to step 1 and clear the name. That retraction (ADR-33) makes step 1
  // the first incomplete step again, so it is where the reload resumes.
  await backStep(page);
  await backStep(page);
  await clearText(page, KS.fullName);

  const log = watchAnswerPosts(page);
  await resume(page);
  expect(log).toEqual([]);

  // date: the stored answer is displayed on the resumed step.
  await expect(dobMonth(page)).toHaveText(/^0?5$/);
  await expect(
    page.getByRole("group", { name: KS.dob }).getByRole("spinbutton", { name: /day/i }),
  ).toHaveText("17");
  await expect(
    page.getByRole("group", { name: KS.dob }).getByRole("spinbutton", { name: /year/i }),
  ).toHaveText("1990");
  // The RETRACTED answer resumes as unanswered, never as the stale value: the
  // tombstone is the newest ledger row, so `latestAnswers` reports no answer and
  // the seeded map has no entry to display.
  await expect(page.getByRole("textbox", { name: KS.fullName })).toHaveValue("");

  // Fill the gap and continue. This client mount has typed nothing on step 2, so
  // every value it now shows came from the server with the step.
  await fillText(page, KS.fullName, "Ada Lovelace");
  await continueStep(page);
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeChecked(); // boolean
  await expect(page.getByRole("textbox", { name: KS.count })).toHaveValue("2"); // number
  await expect(page.getByRole("checkbox", { name: "Breakdown", exact: true })).toBeChecked(); // multiChoice
  await expect(page.getByRole("textbox", { name: KS.extraDetail })).toHaveValue("Kerb damage"); // longText

  await continueStep(page);
  // singleChoice as a RadioGroup, on the step that can never be the resumed one.
  await expect(page.getByRole("radio", { name: "Standard", exact: true })).toBeChecked();

  // Nothing in the resume, the render, or the two navigations posted an answer
  // except the one name re-entry this test performed.
  expect(log).toEqual([{ questionId: "q_full_name", value: "Ada Lovelace", status: 200 }]);
});
