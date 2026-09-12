/**
 * Clearing an answer with JavaScript disabled (issue #127, Code Owner ruling
 * 2026-09-02).
 *
 * ## The observation this is anchored to
 *
 * A no-JS respondent resumed a session, emptied a previously answered field, submitted,
 * and the server still held the old answer. `lib/server/step-form.ts` mapped a blank
 * text field to absence and omitted it, which the scripted path had made correct for
 * itself in issue #98 by posting an explicit ADR-33 retraction instead - a channel the
 * native path did not have. So one respondent gesture meant "cleared" with scripting on
 * and "no change" with it off, and Continue advanced on a value the respondent believed
 * they had removed.
 *
 * ## Why this file exists on top of the unit and route tests
 *
 * `apps/portal/lib/server/step-form.test.ts` pins the decoding rule and
 * `apps/portal/lib/server/step-retraction.test.ts` pins what the route does with it,
 * both over hand-built form entries. Neither can say that a REAL BROWSER with scripting
 * off produces those entries: that the rendered form carries the marker, that emptying a
 * box leaves it carrying the marker, and that the browser's own serialization sends the
 * pair. This file drives the whole chain and then reads Postgres directly.
 *
 * The assertion is **absence in Postgres** (`latest.has(q) === false`), never a 200. The
 * buggy behaviour returned a 200 too, and it returned the respondent to a step that
 * looked right; the only thing that differed was what the server held.
 *
 * ## What the fixture allows, and what it does not
 *
 * The kitchen sink's first step is `q_full_name` (shortText) and `q_dob` (date,
 * required). A date is not answerable with scripting off - the react-aria DatePicker's
 * form value rides a hidden input that JavaScript syncs - so the flow never becomes
 * ready and every submit returns to this step. That is exactly the resume-and-edit
 * shape the issue describes, so it is used rather than worked around; it does mean the
 * kitchen sink's multiChoice, on step two, is unreachable from here. The multiChoice
 * half of "the two paths agree" is asserted where both transports are reachable
 * together: `packages/ui/src/clear-paths.test.tsx` for what each mode puts on the wire,
 * and `apps/portal/lib/server/step-form.test.ts` for what the BFF makes of it. Clearing
 * a NUMBER without scripting is out of scope for the same reason the date is: issue #18,
 * phase 4.
 */

import type { Page } from "@playwright/test";

import { expect, test } from "./support/gates.js";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";

test.use({ javaScriptEnabled: false });

const FULL_NAME = "Full name";
const NAME_QUESTION = "q_full_name";

/** The session id in the URL the Start button landed on. */
function sessionIdOf(url: string): string {
  return new URL(url).pathname.split("/")[2] ?? "";
}

/**
 * Submit the step's native form and wait for the page the 303 lands on.
 *
 * The POST and the GET are one navigation chain, so waiting for the served 200 is what
 * makes the following assertions read the page the submission produced rather than the
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

/** Start the kitchen-sink flow anonymously with scripting off, and return the session id. */
async function startNoJs(page: Page, slug: string): Promise<string> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("textbox", { name: FULL_NAME })).toBeVisible();
  const sessionId = sessionIdOf(page.url());
  expect(sessionId).toMatch(/^ses_/);
  return sessionId;
}

/** The hidden answered marker for one question, as rendered in the current page. */
function marker(page: Page, questionId: string) {
  return page.locator(`input[name="__qa__${questionId}"]`);
}

test("a JS-disabled respondent clears a previously answered field, and the server lets go of it", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await startNoJs(page, kitchenSinkSlug);

    // Nothing answered yet, so nothing is marked. The marker tracks the server's
    // answers, so its absence here is what makes its presence below mean something.
    await expect(marker(page, NAME_QUESTION)).toHaveCount(0);

    // Answer it. A shortText is an ordinary named input, so the browser serializes it
    // with no scripting at all.
    await page.getByRole("textbox", { name: FULL_NAME }).fill("Ada Lovelace");
    await submitStep(page);

    // The required date cannot be answered without scripting, so the flow is not ready
    // and the submit returns to this step - which is the resume-and-edit position the
    // issue describes.
    expect((await db.latestAnswers(sessionId)).get(NAME_QUESTION)).toBe("Ada Lovelace");
    await expect(page.getByRole("textbox", { name: FULL_NAME })).toHaveValue("Ada Lovelace");

    // The server-rendered form now says the question holds an answer. This is the whole
    // mechanism: one hidden input, emitted because the answer exists.
    await expect(marker(page, NAME_QUESTION)).toHaveCount(1);
    await expect(marker(page, NAME_QUESTION)).toHaveAttribute("type", "hidden");

    // The gesture the issue is about: empty the box and submit again.
    await page.getByRole("textbox", { name: FULL_NAME }).fill("");
    await submitStep(page);

    // THE OBSERVATION, inverted. Absence in Postgres, not a 200 and not a page that
    // looks right: before this fix the stale answer was still here.
    const latest = await db.latestAnswers(sessionId);
    expect(latest.has(NAME_QUESTION)).toBe(false);

    // And it is a retraction, not an erasure and not an empty-string answer: the ledger
    // keeps the answer that was given and records the tombstone after it (R3, ADR-33).
    const rows = (await db.answerRows(sessionId)).filter((r) => r.questionId === NAME_QUESTION);
    expect(rows.map((r) => [r.value, r.retracted])).toEqual([
      ["Ada Lovelace", false],
      [null, true],
    ]);

    // The re-render agrees with the ledger: the box is empty and the marker is gone, so
    // a further submit of the same empty box is silence rather than a second tombstone.
    await expect(page.getByRole("textbox", { name: FULL_NAME })).toHaveValue("");
    await expect(marker(page, NAME_QUESTION)).toHaveCount(0);

    await submitStep(page);
    expect(
      (await db.answerRows(sessionId)).filter((r) => r.questionId === NAME_QUESTION),
    ).toHaveLength(2);
  } finally {
    await db.close();
  }
});

test("an empty field nobody ever answered stays silence, not a tombstone", async ({ page }) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    // The half of the rule that must not change. Every no-JS submit posts every field of
    // the step, most of them empty on the first pass, and none of those may become a
    // ledger row. Without the marker gating it, the retraction branch would fire on all
    // of them.
    const sessionId = await startNoJs(page, kitchenSinkSlug);
    await submitStep(page);

    expect(await db.answerRows(sessionId)).toEqual([]);
    await expect(page.getByRole("textbox", { name: FULL_NAME })).toBeVisible();
  } finally {
    await db.close();
  }
});
