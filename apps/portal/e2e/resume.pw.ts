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
 * the answers. That was not a cosmetic gap: the client's record of what the server
 * already holds was empty too, so focus merely entering and leaving an untouched
 * control looked like a fresh commit of an emptied field and posted the ADR-33
 * `null` retraction, destroying the stored answer. `handleBlur` guards only the
 * `completion` moment, so that reached every other control: `blur` (shortText,
 * longText, number), `groupExit` (multiChoice) AND `change` (boolean,
 * singleChoice). Three halves are pinned below, because each protects a different
 * direction of the same defect: the stored value is DISPLAYED, an untouched
 * resumed control posts NOTHING, and a resumed control the respondent genuinely
 * clears still posts its retraction.
 *
 * Two limits on where a *resumed* step can be asserted, both structural: `/s/:id`
 * serves the first INCOMPLETE step, so the resumed step's gap question is by
 * definition unanswered and cannot be asserted there, and the kitchen-sink
 * singleChoice step holds exactly one question, so it can never be the resumed
 * step at all. Everything else is a scripting choice: the types covered below on
 * the first NAVIGATION out of the resumed step are reachable on a true resume too
 * (leave a different required question as the gap). They are asserted on the
 * navigation because a client that mounted holding nothing is the same defect one
 * step over, and Continue from a resumed session into a step answered before the
 * reload is an equally real respondent path. The mount seed is type-agnostic, and
 * per-adapter display of all eight renderings in the #98 audit table - including
 * the Select the portal has no fixture for - is pinned in `@roonga/qcms-ui`'s
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

test("clearing an answer on a resumed step still retracts it", async ({ page }) => {
  test.setTimeout(120_000);
  const { kitchenSinkSlug, databaseUrl } = readFixtures();

  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = sessionIdOf(page.url());
  await enterDate(page, "05171990");
  // q_full_name stays unanswered, so step 1 remains the first incomplete step and
  // the resume lands back on it with the date already answered.

  const log = watchAnswerPosts(page);
  await resume(page);
  await expect(dobMonth(page)).toHaveText(/^0?5$/);

  // The OTHER direction of the same defect, and the half that has no natural
  // symptom: a resumed control the respondent genuinely clears must still retract.
  // The date's commit moment is `completion` (ADR-31), and a `completion` clear is
  // recognised as a retraction only by comparing against what the server is known
  // to hold - so with that record empty on a resumed mount, this gesture posted
  // NOTHING and the server silently kept a date the respondent had cleared. That is
  // the displayed-versus-server divergence of issue #144 and #95, arrived at from
  // the resume path. Clearing a value the SAME mount typed cannot catch it (the
  // client recorded that post itself), which is why this test resumes first.
  const month = dobMonth(page);
  await month.click();
  // react-aria deletes a segment digit-wise, so one Backspace empties the
  // two-digit month and leaves the date incomplete (see `clearDate`).
  await page.keyboard.press("Backspace");
  await expect(month).toHaveText(/mm/i);
  await blurActive(page);

  // Whole-log equality, not a slice: a slice would hide an extra post, and the
  // pre-fix behaviour is exactly the empty log. Polled because the assertion is
  // that a post ARRIVES, and its absence is the regression being guarded.
  await expect
    .poll(() => log, {
      message: "clearing a resumed date must post exactly one ADR-33 null retraction",
    })
    .toEqual([{ questionId: "q_dob", value: null, status: 200 }]);
  expectNoRejectedPosts(log);

  // And the server agrees, read independently of the API's response echo: the
  // ledger keeps both rows with the tombstone last (append-only, R3), and the read
  // model resolves the question to unanswered.
  const db = await openDb(databaseUrl);
  try {
    const rows = await db.answerRows(sessionId);
    expect(rows.map((row) => [row.questionId, row.value, row.retracted])).toEqual([
      ["q_dob", "1990-05-17", false],
      ["q_dob", null, true],
    ]);
    expect(Object.fromEntries(await db.latestAnswers(sessionId))).toEqual({});
  } finally {
    await db.close();
  }
});

/**
 * Issue #151: a step containing a NumberField survives a RELOAD without a React
 * hydration mismatch. **A live gate since the cause was fixed; it was `test.fail` for
 * as long as the mismatch stood.**
 *
 * The gate has always been armed - `gates.ts` fails any spec that logs a console
 * error, and a hydration mismatch is one - but no spec had ever reloaded a step
 * with a NumberField on it. Every path above reaches the number question by
 * NAVIGATION (Continue), and a navigation does not hydrate a fresh document, so
 * the situation that trips the gate simply never occurred. That blind spot is what
 * this test closes; it is the assertion whose absence hid the defect.
 *
 * The reload has to land on the number's own step, which `/s/:id` decides by
 * serving the first INCOMPLETE step. So the boolean is answered (revealing the
 * number follow-up), the number is answered, and the required multiChoice beside
 * them is left as the gap: step 2 is therefore where the reload resumes, with the
 * NumberField rendered from the server's stored answer.
 *
 * WHAT THIS TEST ESTABLISHED, running it for the first time. #151 recorded the
 * strongest available lead as two copies of react-aria-components in the portal's
 * closure, which is two SSR id and context providers - and recorded it explicitly
 * as inference rather than proof. Deduplicating them (`pnpm why` reports one copy)
 * left **the mismatch unchanged**. So the dual copy was a real improvement and was
 * not the cause.
 *
 * That was measured twice, against two different splits, which is worth recording
 * because the split came back in between. The first dedup was a lockfile refresh;
 * the copies then reopened at 1.21.1 direct against 1.20.0 nested under
 * `@a2ra/core@1.0.0-preview.7`, because a dependency bump moves only the direct arm.
 * The second dedup closed it again and closed it upstream as well, by making
 * react-aria-components a peer dependency of `@a2ra/core` so the fork is unreachable
 * rather than merely absent today. This test was run with the marker off at that
 * point, and React reported the same one attribute quoted below. Two independent
 * occasions, same result: the copy count is not what this was.
 *
 * The diff React reported was ONE attribute, and it was not among the five the
 * issue named:
 *
 *     +  inputMode="decimal"     (client)
 *     -  inputMode="numeric"     (server)
 *
 * The `role` and `aria-value*` nulls the issue quoted were printed by React as
 * unchanged context on both sides, not as the difference. `@react-aria/numberfield`
 * picks `inputMode` from the resolved number FORMAT and from platform detection that
 * reads `navigator`, which a server render does not have, so the server said `numeric`
 * and the touch client said `decimal`.
 *
 * HOW IT WAS FIXED, and why the marker came off. The format half of that decision is
 * QCMS's to state. "How many?" is an integer-constrained question, which the compiler
 * records as `step: 1`, but react-aria reads the format rather than the step, and the
 * default format admits three fraction digits - so the field accepted "2.5" while
 * typing, snapped it at commit, and asked for a decimal keypad on touch, for a question
 * that was never fractional. `registry.tsx` now declares `maximumFractionDigits: 0` for
 * such a question. With no fraction digits in the format every platform branch inside
 * `useNumberField` leaves `inputMode` at `numeric`, which is what the server emits, so
 * both renders agree by construction rather than by an allowlist entry (#151 forbids
 * silencing, and an entry would have blinded every other spec to the same shape).
 *
 * WHAT IS STILL OPEN, so a reader does not take this test for more than it proves
 * (issue #945). Two environment-derived attributes on this same input can still differ,
 * and this spec can observe NEITHER:
 *
 * - `aria-roledescription`, for the very integer question above. `useNumberField` sets
 *   it to "Number field" unless `isIOS()`, so the server emits it and an iOS client
 *   emits nothing. Android agrees with the server, which is exactly why it prints as
 *   unchanged context in the diff quoted earlier, and why a green run here says nothing
 *   about iOS: no project in `playwright.config.ts` is WebKit or iOS. On iOS this step's
 *   reload still logs a mismatch.
 * - `inputMode` for a question that ADMITS fractions (`decimal` on touch against the
 *   server's `numeric`), and `text` on an iPhone for a negative-admitting one. No
 *   fixture form has such a question, so no spec here can reach one either.
 *
 * Both need a prop on the `<Input>` that the vendored control does not forward, which is
 * an upstream change plus a pin move (ADR-22 keeps
 * `packages/ui/src/components/a2ui/**` byte-identical).
 * `packages/ui/src/number-input-mode.test.tsx` puts the same adapter through both
 * renders at the jsdom layer, reads both attributes, and carries a self-arming marker
 * for each residual, because a jsdom platform override is the only place this repository
 * can see them at all.
 *
 * The marker this test used to carry is worth remembering for the next defect that
 * needs one. The first attempt used the SKIP-with-intent marker, which Playwright does
 * not run past, so the self-arming property claimed for it did not exist. `test.fail`
 * RUNS the test "and ensures that it is actually failing" (its own API docs), so the
 * day the cause was fixed the run went red with "Expected to fail, but passed" and the
 * marker had to be removed deliberately - which is exactly how a fix gets noticed.
 * Its limit was real too: `test.fail` accepts ANY failure, so it bought "this defect is
 * still here" and never "everything else in this body still works". Those assertions
 * gate for real now.
 */
test("reloading a step that contains a NumberField hydrates without a mismatch", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { kitchenSinkSlug } = readFixtures();

  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);

  await chooseRadio(page, "Yes"); // boolean -> reveals the number follow-up
  await answerNumber(page, "2");
  // q_optional_cover (required) is deliberately left unanswered, so this step is
  // still the first incomplete one and the reload comes back to it.

  const log = watchAnswerPosts(page);
  await resume(page);

  // The NumberField is present on the hydrated document and shows what the server
  // holds. Without this the test could pass on a step that never rendered one.
  const count = page.getByRole("textbox", { name: KS.count });
  await expect(count).toBeVisible();
  await expect(count).toHaveValue("2");

  // The field is labelled and reads back its stored answer. The mismatch itself is
  // left to the console gate below rather than asserted attribute by attribute:
  // which of `role` and the `aria-value*` set a browser ends up with is react-aria's
  // decision and varies by pointer type, so pinning the set here would make this
  // spec brittle about the wrong thing.
  await expect(count).toHaveAccessibleName(KS.count);

  // Rendering a resumed step posts nothing (the #146 property, re-asserted here
  // because this reload lands on a step no other test resumes onto).
  expect(log).toEqual([]);

  // The hydration mismatch itself is asserted by `gates.ts`: it fails this test on
  // any console error, and "A tree hydrated but some attributes of the server
  // rendered HTML didn't match the client properties" is one. There is deliberately
  // no allowlist entry for it (#151 forbids silencing rather than fixing), so a
  // returning mismatch reds this test rather than printing past it. Note where that
  // fault would arrive from: the gate collects console output up to the fixture
  // TEARDOWN, so a mismatch shows up after this body has already run clean.
});
