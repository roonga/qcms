/**
 * What the flow records as "already posted", and what that record is allowed to
 * suppress (issue #122).
 *
 * `lastPostedRef` is the flow's picture of what the server holds for each
 * question. It exists to stop a post that would say nothing new: a control that
 * committed on change must not re-post the identical value when focus later leaves
 * it, and a resumed control must not post a retraction of an answer the respondent
 * never touched (issue #146, pinned in `resume.pw.ts`). The record used to be
 * written when a post RESOLVED, which left the window this spec closes: a
 * `change`-commit control's post is still in flight while the respondent's focus is
 * already moving to Continue, so the blur behind it read a record that still held
 * the previous value and posted the same answer a second time.
 *
 * Each test pins the exact, whole-question post log (`support/answer-log.ts`,
 * registered before the flow starts), because "the answer eventually posts" passes
 * on the broken behaviour too: the defect here is an extra post nobody sees.
 *
 * The other half of issue #122 - a refusal's error message outliving the value it
 * describes, and the record's rollback that keeps a refused value retryable - is
 * in `answer-rejection.pw.ts`, not here. It used to be unreachable from any gated
 * spec, because a browser reports any 4xx response as a `console.error` ("Failed to
 * load resource: ... 422") and the shared gate in `support/gates.ts` failed the
 * test on it, whether the 422 came from the real API or from a fulfilled route.
 * Issue #166 added a per-test declaration for a deliberately-provoked failed
 * request, so that half is now pinned at this layer too; the pure functions the
 * rules live in stay pinned in `apps/portal/lib/answer-record.test.ts`, where the
 * whole sequences are cheap to drive.
 */

import { test, expect } from "./support/gates.js";

import { expectNoRejectedPosts, postsFor, watchAnswerPosts } from "./support/answer-log.js";
import { readFixtures } from "./support/fixtures.js";
import {
  KS,
  answerPosted,
  blurActive,
  clearText,
  commitCheckboxGroup,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
  toggleOption,
} from "./support/kitchen-sink.js";

test("a change-commit control blurred before its post resolves posts exactly once", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/answers", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { questionId?: string };
    if (body.questionId === "q_at_fault_accident") await held;
    await route.continue();
  });

  const posted = answerPosted(page);
  await page.getByText("No", { exact: true }).click();
  await blurActive(page);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
  release();
  await posted;

  await toggleOption(page, "Breakdown");
  await commitCheckboxGroup(page);

  expect(postsFor(log, "q_at_fault_accident")).toEqual([
    { questionId: "q_at_fault_accident", value: false, status: 200 },
  ]);
  expectNoRejectedPosts(log);
});

test("the dedupe keeps absence distinct from a value, and an unchanged value posts nothing", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  const name = page.getByRole("textbox", { name: KS.fullName });

  await fillText(page, KS.fullName, "Ada Lovelace");

  await name.click();
  await blurActive(page);

  await clearText(page, KS.fullName);
  await fillText(page, KS.fullName, "Ada Lovelace");

  await name.click();
  await blurActive(page);

  await enterDate(page, "05171990"); // serialization anchor, as above
  expect(postsFor(log, "q_full_name")).toEqual([
    { questionId: "q_full_name", value: "Ada Lovelace", status: 200 },
    { questionId: "q_full_name", value: null, status: 200 },
    { questionId: "q_full_name", value: "Ada Lovelace", status: 200 },
  ]);
  expectNoRejectedPosts(log);
});
