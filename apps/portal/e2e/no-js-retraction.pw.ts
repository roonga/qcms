/**
 * Clearing an answer with JavaScript disabled (issue #127, Code Owner ruling
 * 2026-09-02).
 *
 * ## The observation this is anchored to
 *
 * A no-JS respondent resumes a session, empties a previously answered field, submits,
 * and the server still holds the old answer. `lib/server/step-form.ts` mapped a blank
 * text field to absence and omitted it, which the scripted path had made correct for
 * itself in issue #98 by posting an explicit ADR-33 retraction instead - a channel the
 * native path did not have. So one respondent gesture meant "cleared" with scripting on
 * and "no change" with it off, and the flow advanced on a value the respondent believed
 * they had removed.
 *
 * ## Why the setup runs with scripting ON
 *
 * The issue's own scenario is a **resume**: the answer being cleared was given earlier.
 * Giving it here needs a scripted context for a reason that is itself worth recording:
 * the kitchen sink's first step carries a required date, and a react-aria DatePicker's
 * form value rides an `<input hidden required>` that JavaScript syncs. A hidden control
 * that fails constraint validation cannot be focused to show a message, so the browser
 * refuses to submit the form at all - `An invalid form control with name='q_dob' is not
 * focusable` - and step one is a dead end with scripting off. That is a live no-JS
 * defect of its own, not this issue's, and it is carried in this change's pull request
 * rather than worked around here; what this file does is seed the session through the scripted path and then do
 * the whole subject of the issue - the clear, the submit, and what the server keeps -
 * in a context with `javaScriptEnabled: false`.
 *
 * ## What can be cleared without scripting, and what the browser refuses first
 *
 * Only an **optional** question. The renderer sets the HTML `required` attribute from
 * the question, and react-aria's checkbox group sets it on every box for exactly as
 * long as none is selected, so emptying a required text field or unchecking a required
 * group makes the browser refuse the submission before it leaves the page. The marker is
 * still what makes the optional clear reach the ledger, and it is still the whole of the
 * mechanism, but the required half of the issue's scenario is blocked one layer earlier
 * than the BFF. That is a separate finding, carried in this change's pull request rather
 * than fixed here: whether the no-JS path should submit past the browser's validation is
 * a decision, not a detail.
 *
 * The multiChoice half of "the two transports agree" is therefore asserted where both
 * are reachable together rather than here: `packages/ui/src/clear-paths.test.tsx` for
 * what each render mode puts on the wire, and `apps/portal/lib/server/step-form.test.ts`
 * for what the BFF makes of it. Clearing a NUMBER without scripting is out of scope for
 * the same reason the date is (issue #18, phase 4).
 *
 * ## Why the assertion is Postgres
 *
 * `latest.has(q) === false`, never a 200. The buggy behaviour returned a 200 too, and it
 * returned the respondent to a step that looked right; the only thing that differed was
 * what the server held.
 */

import type { BrowserContext, Page } from "@playwright/test";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
import {
  KS,
  checkOption,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
} from "./support/kitchen-sink.js";

test.use({ javaScriptEnabled: false });

const DETAIL_QUESTION = "q_extra_detail";

/** The session id in the URL the scripted setup landed on. */
function sessionIdOf(url: string): string {
  return new URL(url).pathname.split("/")[2] ?? "";
}

/**
 * The state every case here starts from, built through the scripted path: a session
 * parked on the "Driving history" step with the optional-cover branch open and the
 * required boolean deliberately UNANSWERED.
 *
 * Unanswered because the no-JS page has no cursor: it is served the first INCOMPLETE
 * step, so a step whose required questions are all answered is a step the respondent
 * never sees. Answering the boolean is therefore left to the no-JS half, where it is
 * also what makes the form submittable at all - see the note on constraint validation
 * above. "No" is the answer it gives, which keeps the required NumberField hidden; the
 * NumberField's own visible input carries `required` and is empty and focusable, so a
 * revealed one would block the submission exactly as the date does.
 *
 * `answerDetail` decides whether the optional long text is answered before the no-JS
 * half begins, which is the only difference between the two cases below.
 */
async function seedHistoryStep(
  context: BrowserContext,
  slug: string,
  answerDetail: boolean,
): Promise<string> {
  const scripted = await context.newPage();
  await startKitchenSink(scripted, slug);
  await fillText(scripted, KS.fullName, "Ada Lovelace");
  await enterDate(scripted, "05171990");
  await continueStep(scripted);
  await checkOption(scripted, "Breakdown");
  await expect(scripted.getByRole("textbox", { name: KS.extraDetail })).toBeVisible();
  if (answerDetail) await fillText(scripted, KS.extraDetail, "No claims");
  const sessionId = sessionIdOf(scripted.url());
  expect(sessionId).toMatch(/^ses_/);
  await scripted.close();
  return sessionId;
}

/** Carry the seeded session's cookies into the JS-disabled page and open its step. */
async function resumeWithoutJs(page: Page, from: BrowserContext, sessionId: string): Promise<void> {
  await page.context().addCookies(await from.cookies());
  await page.goto(`/s/${sessionId}`);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
}

/**
 * Submit the step's native form and wait for the page the 303 lands on.
 *
 * The POST and the GET are one navigation chain, so waiting for the served 200 is what
 * makes the assertions that follow read the page the submission produced rather than the
 * one it was made from. Scoped to the step card because the header's appearance controls
 * are a second native form with a submit of their own (issue #195).
 */
async function submitStep(page: Page): Promise<void> {
  const served = page.waitForResponse(
    (response) => response.request().isNavigationRequest() && response.status() === 200,
  );
  await page.getByTestId("step-card").locator('form button[type="submit"]').click();
  await served;
}

/**
 * Answer the step's required boolean with "No", by clicking the option's visible label.
 *
 * Two jobs, and the second is why it is here rather than in the setup: it is the answer
 * that makes the step complete, and it is what makes the native form pass the browser's
 * own constraint validation, which refuses to submit a form holding an unanswered
 * required radio. "No" also keeps the required NumberField hidden. The real radio input
 * sits under a decorative indicator, so the label is the hit target (no-js-submit.pw.ts
 * takes the same route); native label association checks it with no scripting.
 */
async function answerRequiredBoolean(page: Page): Promise<void> {
  await page.getByText("No", { exact: true }).click();
}

/** The hidden answered marker for one question, as rendered in the current page. */
function marker(page: Page, questionId: string) {
  return page.locator(`input[name="__qa__${questionId}"]`);
}

test("a JS-disabled respondent clears an answer they gave earlier, and the server lets go of it", async ({
  page,
  browser,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const scripted = await browser.newContext({ javaScriptEnabled: true });
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await seedHistoryStep(scripted, kitchenSinkSlug, true);
    expect((await db.latestAnswers(sessionId)).get(DETAIL_QUESTION)).toBe("No claims");

    await resumeWithoutJs(page, scripted, sessionId);

    // The resumed form shows the answer and says, in one hidden input, that the server
    // holds it. That is the entire mechanism, and the contrast with an unanswered
    // question on the same step is what makes it a signal rather than decoration.
    const detail = page.getByRole("textbox", { name: KS.extraDetail });
    await expect(detail).toHaveValue("No claims");
    await expect(marker(page, DETAIL_QUESTION)).toHaveCount(1);
    await expect(marker(page, DETAIL_QUESTION)).toHaveAttribute("type", "hidden");
    await expect(marker(page, "q_accident_count")).toHaveCount(0);

    // The gesture the issue is about: empty the box, answer the one required question
    // this step still needs, and submit.
    await detail.fill("");
    await answerRequiredBoolean(page);
    await submitStep(page);

    // The submission landed: the step is complete and the next one is served. Asserted
    // because a native form that the browser refuses to submit looks, from here, exactly
    // like one that submitted and changed nothing.
    await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

    // THE OBSERVATION, inverted. Absence in Postgres, not a 200 and not a page that
    // looks right: before this fix the stale answer was still here.
    expect((await db.latestAnswers(sessionId)).has(DETAIL_QUESTION)).toBe(false);

    // A retraction, not an erasure and not an empty-string answer: the ledger keeps the
    // answer that was given and records the tombstone after it (R3, ADR-33).
    const rows = (await db.answerRows(sessionId)).filter((r) => r.questionId === DETAIL_QUESTION);
    expect(rows.map((r) => [r.value, r.retracted])).toEqual([
      ["No claims", false],
      [null, true],
    ]);
  } finally {
    await db.close();
    await scripted.close();
  }
});

test("an empty field nobody ever answered stays silence, not a tombstone", async ({
  page,
  browser,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const scripted = await browser.newContext({ javaScriptEnabled: true });
  const db = await openDb(databaseUrl);
  try {
    // The half of the rule that must not change. Every no-JS submit posts every field of
    // the step, and on this step the optional long text is one of them - empty, because
    // nobody has answered it. Without the marker gating the retraction branch, a submit
    // like this one would tombstone it.
    const sessionId = await seedHistoryStep(scripted, kitchenSinkSlug, false);
    await resumeWithoutJs(page, scripted, sessionId);

    await expect(page.getByRole("textbox", { name: KS.extraDetail })).toHaveValue("");
    await expect(marker(page, DETAIL_QUESTION)).toHaveCount(0);

    await answerRequiredBoolean(page);
    await submitStep(page);
    await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

    expect(
      (await db.answerRows(sessionId)).filter((r) => r.questionId === DETAIL_QUESTION),
    ).toEqual([]);
  } finally {
    await db.close();
    await scripted.close();
  }
});
