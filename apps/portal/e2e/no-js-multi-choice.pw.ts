/**
 * A required multi-choice group with scripting disabled (issue #974, Code Owner
 * ruling 2026-09-19).
 *
 * ## What was broken
 *
 * HTML has no "at least one of these" constraint. react-aria encodes the rule by
 * putting native `required` on EVERY checkbox in a required group and taking it off
 * the moment something is selected - and taking it off is a re-render, which is
 * scripting. So the server-rendered page froze `required` on all of them, where
 * native `required` on a checkbox means THAT box must be checked. Observed on the
 * kitchen sink's "Which optional cover do you want?": one of three checked and
 * Chrome refused the submit with no POST leaving the page; all three checked and it
 * submitted. A respondent who wanted one cover could not pass step two, and step
 * three was unreachable behind it.
 *
 * `no-js-retraction.pw.ts` could not see it because its group is seeded before the
 * no-JS render, and a group that already holds an answer renders no `required` at
 * all.
 *
 * ## The ruling, and why this file is the proof of it
 *
 * The principle recorded on #974: JavaScript is assumed, and the no-JS form is a
 * fallback that must work FUNCTIONALLY, without rapid feedback. So the boxes render
 * without the native attribute and a blank group is reported by the server after the
 * round trip, through the missing-required path issue #964 built. Browser validation
 * is unchanged wherever HTML can carry the rule (the 2026-09-13 ruling on #920), so
 * the first case below also asserts what the step's OTHER required question still
 * refuses.
 *
 * jsdom pins which attribute sits on which element
 * (`packages/ui/src/native-multi-choice.test.tsx`). Only a browser can say whether
 * Chrome then submits the form, which is the whole defect, so that is what these
 * cases assert - and each of them waits on the navigation the POST produces, because
 * a submission the browser refuses is otherwise indistinguishable from one that
 * changed nothing.
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
import { countStepPosts, fillNativeDate, stepSubmit, submitStep } from "./support/no-js.js";

test.use({ javaScriptEnabled: false });

const COVER_QUESTION = "q_optional_cover";
const NAME_FIELD = 'input[name="q_full_name"]';

/** The group's three checkboxes, whatever their labels. */
function coverBoxes(page: Page) {
  return page.locator(`input[type="checkbox"][name="${COVER_QUESTION}"]`);
}

/** Start the kitchen sink with no scripting and return the session id. */
async function startWithoutJs(page: Page, slug: string): Promise<string> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2] ?? "";
}

/** Clear step one (a required name and a required date) and land on step two. */
async function passAboutStep(page: Page): Promise<void> {
  await page.locator(NAME_FIELD).fill("Ada Lovelace");
  await fillNativeDate(page, "q_dob", "1990-05-17");
  await submitStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
}

test("one box checked is enough: the step submits and the single option lands", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await startWithoutJs(page, kitchenSinkSlug);
    await passAboutStep(page);

    await expect(coverBoxes(page)).toHaveCount(3);
    await expect(
      page.locator(`input[type="checkbox"][name="${COVER_QUESTION}"][required]`),
    ).toHaveCount(0);

    await expect(page.getByText(KS.optionalCover)).toBeVisible();
    await expect(coverBoxes(page).first()).toHaveAttribute("aria-required", "true");

    await expect(
      page.locator('input[type="radio"][name="q_at_fault_accident"][required]'),
    ).toHaveCount(2);

    await page.getByText("No", { exact: true }).click();
    await page.getByText("Breakdown", { exact: true }).click();
    await expect(coverBoxes(page).nth(0)).toBeChecked();
    await expect(coverBoxes(page).nth(1)).not.toBeChecked();
    await expect(coverBoxes(page).nth(2)).not.toBeChecked();

    await submitStep(page);

    await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

    expect((await db.latestAnswers(sessionId)).get(COVER_QUESTION)).toEqual(["opt_breakdown"]);
  } finally {
    await db.close();
  }
});

test("a blank required group submits and comes back reported, beside the group and in the summary", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await startWithoutJs(page, kitchenSinkSlug);
    await passAboutStep(page);

    const postCount = countStepPosts(page);

    await page.getByText("No", { exact: true }).click();
    await submitStep(page);
    expect(postCount(), "the browser must have let the blank group through").toBe(1);

    await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
    const summary = page.getByTestId("error-summary");
    await expect(summary).toBeVisible();
    await expect(summary.getByRole("link").filter({ hasText: KS.optionalCover })).toBeVisible();
    const group = page.locator(`[data-qcms-field="${COVER_QUESTION}"]`);
    await expect(group.getByText("This question needs an answer.")).toBeVisible();

    const stored = await db.latestAnswers(sessionId);
    expect(stored.has(COVER_QUESTION)).toBe(false);
    expect(stored.get("q_at_fault_accident")).toBe(false);
    await expect(
      page.locator('input[type="radio"][name="q_at_fault_accident"][value="false"]'),
    ).toBeChecked();

    await page.getByText("Breakdown", { exact: true }).click();
    await submitStep(page);
    await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();
    expect((await db.latestAnswers(sessionId)).get(COVER_QUESTION)).toEqual(["opt_breakdown"]);
  } finally {
    await db.close();
  }
});

/**
 * Seed a session parked on "Driving history" with the cover group holding one
 * option, through the scripted path, and leave the required boolean unanswered so
 * the no-JS page is served that step (`no-js-retraction.pw.ts` explains why the
 * setup is scripted: the answer being cleared has to have been given earlier).
 */
async function seedSeededGroup(context: BrowserContext, slug: string): Promise<string> {
  const scripted = await context.newPage();
  await startKitchenSink(scripted, slug);
  await fillText(scripted, KS.fullName, "Ada Lovelace");
  await enterDate(scripted, "05171990");
  await continueStep(scripted);
  await checkOption(scripted, "Breakdown");
  const sessionId = new URL(scripted.url()).pathname.split("/")[2] ?? "";
  expect(sessionId).toMatch(/^ses_/);
  await scripted.close();
  return sessionId;
}

test("unchecking every box of a required group retracts it, and the server says so", async ({
  page,
  browser,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const scripted = await browser.newContext({ javaScriptEnabled: true });
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await seedSeededGroup(scripted, kitchenSinkSlug);
    expect((await db.latestAnswers(sessionId)).get(COVER_QUESTION)).toEqual(["opt_breakdown"]);

    await page.context().addCookies(await scripted.cookies());
    await page.goto(`/s/${sessionId}`);
    await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

    await expect(coverBoxes(page).nth(0)).toBeChecked();
    await expect(page.locator(`input[name="__qa__${COVER_QUESTION}"]`)).toHaveCount(1);

    await page.getByText("Breakdown", { exact: true }).click();
    await expect(coverBoxes(page).nth(0)).not.toBeChecked();
    await page.getByText("No", { exact: true }).click();
    await submitStep(page);

    await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
    await expect(
      page
        .locator(`[data-qcms-field="${COVER_QUESTION}"]`)
        .getByText("This question needs an answer."),
    ).toBeVisible();

    expect((await db.latestAnswers(sessionId)).has(COVER_QUESTION)).toBe(false);
    const rows = (await db.answerRows(sessionId)).filter((r) => r.questionId === COVER_QUESTION);
    expect(rows.map((r) => [r.value, r.retracted])).toEqual([
      [["opt_breakdown"], false],
      [null, true],
    ]);
  } finally {
    await db.close();
    await scripted.close();
  }
});

test("the group's boxes are operable and the submit control is reachable with no scripting", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startWithoutJs(page, kitchenSinkSlug);
  await passAboutStep(page);
  const first = coverBoxes(page).first();
  await expect(first).toHaveAttribute("value", "opt_breakdown");
  await expect(stepSubmit(page)).toBeEnabled();
});
