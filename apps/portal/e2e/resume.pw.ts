/**
 * Resume: revisiting `/s/:sessionId` with the valid session cookie resumes at the
 * current step, with no client state required.
 *
 * Three halves are pinned, because each protects a different direction of the same
 * defect: the stored value is displayed, an untouched resumed control posts nothing, and
 * a resumed control the respondent genuinely clears still posts its retraction. A client
 * that mounted holding nothing posted the ADR-33 retraction on focus merely entering and
 * leaving an untouched control, destroying the stored answer.
 *
 * One structural limit on where a resumed step can be asserted: `/s/:id` serves the
 * first incomplete step, so the resumed step's gap question is unanswered by definition.
 * The types covered on the first navigation out of the resumed step are reachable on a
 * true resume too; they are asserted there because a client that mounted holding nothing
 * is the same defect one step over.
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

function sessionIdOf(url: string): string {
  return new URL(url).pathname.split("/")[2] ?? "";
}

async function resume(page: Page): Promise<void> {
  await page.reload();
  await expect(page).toHaveURL(/\/s\/ses_/);
  await waitForHydration(page);
}

/** Its placeholder is what "unanswered" looks like. */
function dobMonth(page: Page) {
  return page.getByRole("group", { name: KS.dob }).getByRole("spinbutton", { name: /month/i });
}

test("reloading the flow page resumes the session from the cookie", async ({ page }) => {
  const { slug } = readFixtures();

  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText("Any at-fault accident in the last 3 years?")).toBeVisible();

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

  const log = watchAnswerPosts(page);
  await resume(page);

  expect(log).toEqual([]);
  await expect(page.getByRole("textbox", { name: KS.fullName })).toHaveValue("Ada Lovelace");
  await expect(dobMonth(page)).toHaveText(/mm/i);

  await page.getByRole("textbox", { name: KS.fullName }).click();
  await blurActive(page);

  await enterDate(page, "05171990");
  expect(log).toEqual([{ questionId: "q_dob", value: "1990-05-17", status: 200 }]);
  expectNoRejectedPosts(log);

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

  await backStep(page);
  await backStep(page);
  await clearText(page, KS.fullName);

  const log = watchAnswerPosts(page);
  await resume(page);
  expect(log).toEqual([]);

  await expect(dobMonth(page)).toHaveText(/^0?5$/);
  await expect(
    page.getByRole("group", { name: KS.dob }).getByRole("spinbutton", { name: /day/i }),
  ).toHaveText("17");
  await expect(
    page.getByRole("group", { name: KS.dob }).getByRole("spinbutton", { name: /year/i }),
  ).toHaveText("1990");
  await expect(page.getByRole("textbox", { name: KS.fullName })).toHaveValue("");

  await fillText(page, KS.fullName, "Ada Lovelace");
  await continueStep(page);
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeChecked(); // boolean
  await expect(page.getByRole("textbox", { name: KS.count })).toHaveValue("2"); // number
  await expect(page.getByRole("checkbox", { name: "Breakdown", exact: true })).toBeChecked(); // multiChoice
  await expect(page.getByRole("textbox", { name: KS.extraDetail })).toHaveValue("Kerb damage"); // longText

  await continueStep(page);
  await expect(page.getByRole("radio", { name: "Standard", exact: true })).toBeChecked();

  expect(log).toEqual([{ questionId: "q_full_name", value: "Ada Lovelace", status: 200 }]);
});

test("clearing an answer on a resumed step still retracts it", async ({ page }) => {
  test.setTimeout(120_000);
  const { kitchenSinkSlug, databaseUrl } = readFixtures();

  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = sessionIdOf(page.url());
  await enterDate(page, "05171990");

  const log = watchAnswerPosts(page);
  await resume(page);
  await expect(dobMonth(page)).toHaveText(/^0?5$/);

  const month = dobMonth(page);
  await month.click();
  await page.keyboard.press("Backspace");
  await expect(month).toHaveText(/mm/i);
  await blurActive(page);

  await expect
    .poll(() => log, {
      message: "clearing a resumed date must post exactly one ADR-33 null retraction",
    })
    .toEqual([{ questionId: "q_dob", value: null, status: 200 }]);
  expectNoRejectedPosts(log);

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
 * A step containing a NumberField survives a reload without a hydration mismatch. The
 * gate was always armed, `gates.ts` failing any spec that logs a console error, but no
 * spec had reloaded such a step: every path above reaches the number question by
 * navigation, which does not hydrate a fresh document.
 *
 * The reload has to land on the number's own step, which `/s/:id` decides by serving the
 * first incomplete one, so the required multiChoice beside it is left as the gap.
 *
 * Two environment-derived attributes on this input can still differ and this spec can
 * observe neither, because no project here is WebKit or iOS: `aria-roledescription`,
 * which react-aria omits on iOS, and `inputMode` for a fraction-admitting question, for
 * which no fixture form has a question. Both need a prop the vendored control does not
 * forward (ADR-22), and `packages/ui/src/number-input-mode.test.tsx` carries the
 * residuals at the jsdom layer, which is the only place this repository can see them
 * (issue #945).
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

  const log = watchAnswerPosts(page);
  await resume(page);

  const count = page.getByRole("textbox", { name: KS.count });
  await expect(count).toBeVisible();
  await expect(count).toHaveValue("2");

  await expect(count).toHaveAccessibleName(KS.count);

  expect(log).toEqual([]);
});
