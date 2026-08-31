/**
 * What a REFUSED answer does to the flow (issue #122's 422 branch, reachable from
 * a gated spec since issue #166).
 *
 * `step-flow.tsx` wires two rules to a 422 and this is the only layer that sees
 * them wired: the optimistic "what the server holds" entry is rolled back, so the
 * refused value stays retryable; and the message is derived from the refusal plus
 * the value on screen, so it lives exactly as long as the value it describes. The
 * rules themselves are pure functions pinned in `apps/portal/lib/answer-record.test.ts`
 * - what is only true here is that the component calls them, in the right places,
 * with the right arguments, over a real API refusal.
 *
 * The 422 is REAL, not a fulfilled route: `q_full_name`'s pattern forbids a digit,
 * so posting `Ada1` is refused by the kernel through the API (`INVALID_ANSWER`),
 * which also exercises the API's client-safe 4xx reporting the server-log gate
 * allowlists. The browser logs any non-2xx as a `console.error`, so each test
 * declares that 422 through the browser gate's per-test hatch before provoking it
 * (`gates.ts`, {@link ExpectedRequestFailure}); an undeclared status, a different
 * URL, or any other console error still reds the test, and a declaration that never
 * fires reds it too.
 *
 * The post log is pinned whole (`support/answer-log.ts`), because both defects here
 * are about a post that should or should not exist: a retry swallowed by the dedupe
 * is silence, and so is the absent post the last phase depends on.
 */

import { test, expect } from "./support/gates.js";

import { postsFor, watchAnswerPosts } from "./support/answer-log.js";
import { readFixtures } from "./support/fixtures.js";
import { KS, blurActive, enterDate, fillText, startKitchenSink } from "./support/kitchen-sink.js";

import type { Page } from "@playwright/test";

/** The answer-post URL, as the browser reports it on a failed load. */
const ANSWERS_URL = /\/answers$/;

/** A value `q_full_name`'s pattern (`^[A-Za-z][A-Za-z .,'-]{0,99}$`) forbids. */
const REFUSED = "Ada1";

/** A value it accepts, and the one the server ends up holding. */
const HELD = "Ada Lovelace";

/**
 * The message the flow shows under the refused field.
 *
 * The kernel's own wording for `pattern`, verbatim from
 * `packages/core/src/validate-answer.ts`, and not the generic `answer.invalid`
 * catalog entry it used to be: since issue #322 the hydrated path resolves the
 * default the same way the no-JS path always has (author's message, then the
 * kernel's, then the catalog). Nothing about what this spec asserts changed - the
 * message is still derived from the refusal and still lives as long as the value
 * it describes - only which string that derivation lands on.
 */
const INVALID = "Answer does not match the required format";

/** Wait for one `POST /answers` the API refuses (status 422). */
function answerRefused(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (r) => r.url().includes("/answers") && r.request().method() === "POST" && r.status() === 422,
  );
}

/** Type a value the API will refuse into a text control and commit it on blur. */
async function commitRefused(page: Page, name: string, value: string): Promise<void> {
  const refused = answerRefused(page);
  await page.getByRole("textbox", { name }).fill(value);
  await blurActive(page);
  await refused;
}

test("a refused answer stays retryable: the optimistic record is rolled back", async ({
  page,
  browserGuard,
}) => {
  browserGuard.expectRequestFailure({ status: 422, url: ANSWERS_URL });
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, HELD);
  await commitRefused(page, KS.fullName, REFUSED);
  // The message rendering is also the marker that the refusal has been applied:
  // the rollback runs on the same continuation, so once this is on screen the
  // record has already been restored.
  await expect(page.getByText(INVALID)).toBeVisible();

  // Commit the SAME refused value again, with no edit in between: focus enters the
  // field and leaves it, which is a blur commit like any other. The record was
  // written optimistically when the first post was issued, so without the rollback
  // this second commit is deduped into silence and the respondent can never retry
  // a value the server might accept later (a transient failure, a changed
  // constraint). The retry is refused again here, which is the point: what is
  // being pinned is that it was SENT.
  const refusedAgain = answerRefused(page);
  await page.getByRole("textbox", { name: KS.fullName }).click();
  await blurActive(page);
  await refusedAgain;

  expect(postsFor(log, "q_full_name")).toEqual([
    { questionId: "q_full_name", value: HELD, status: 200 },
    { questionId: "q_full_name", value: REFUSED, status: 422 },
    { questionId: "q_full_name", value: REFUSED, status: 422 },
  ]);
});

test("a refusal's message lives exactly as long as the value it describes", async ({
  page,
  browserGuard,
}) => {
  browserGuard.expectRequestFailure({ status: 422, url: ANSWERS_URL });
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, HELD);
  await commitRefused(page, KS.fullName, REFUSED);

  const invalid = page.getByText(INVALID);
  const field = page.getByRole("textbox", { name: KS.fullName });
  await expect(invalid).toBeVisible();

  // The EDIT clears it, and it clears on the keystroke rather than on an accepted
  // post: this control commits on blur (ADR-31), so at this point no post for the
  // corrected value has been issued at all. That is what makes the message useful
  // while the respondent is still typing the correction.
  await field.fill("Grace Hopper");
  await expect(invalid).toBeHidden();

  // Derived, not latched: re-entering the refused value shows the message again,
  // because the message describes that value and the server still refuses it.
  await field.fill(REFUSED);
  await expect(invalid).toBeVisible();

  // The case "clear it when a post succeeds" structurally cannot handle: restoring
  // the value the server ALREADY HOLDS is deduped, so no post for this question is
  // ever issued or accepted again. A message cleared by an accepted post would
  // therefore stay on screen forever, under a field whose value the server holds.
  await field.fill(HELD);
  await expect(invalid).toBeHidden();
  await blurActive(page);
  await expect(invalid).toBeHidden();

  // Anchor the "no post" claim deterministically instead of on a timer: commit a
  // DIFFERENT question and wait for its post. Answer posts are serialized and
  // ordered, so once that has landed, anything the blur above queued would already
  // have been sent.
  await enterDate(page, "05171990");

  expect(postsFor(log, "q_full_name")).toEqual([
    { questionId: "q_full_name", value: HELD, status: 200 },
    { questionId: "q_full_name", value: REFUSED, status: 422 },
  ]);
});
