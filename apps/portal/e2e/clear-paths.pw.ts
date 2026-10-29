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

  const name = page.getByRole("textbox", { name: KS.fullName });
  await name.click();
  await name.fill("");
  expect(postsFor(log, "q_full_name")).toHaveLength(1);

  const retracted = answerPosted(page);
  await blurActive(page);
  await retracted;

  expect(postsFor(log, "q_full_name")).toEqual([
    { questionId: "q_full_name", value: "Ada Lovelace", status: 200 },
    { questionId: "q_full_name", value: null, status: 200 },
  ]);

  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.getByTestId("error-summary")).toContainText(KS.fullName);
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Driving history" })).toHaveCount(0);
  expectNoRejectedPosts(log);

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
  await chooseRadio(page, "Yes");

  const count = page.getByRole("textbox", { name: KS.count });
  await count.click();
  await count.pressSequentially("10");
  const posted = answerPosted(page);
  await blurActive(page);
  await posted;

  await count.click();
  await count.fill("");
  expect(postsFor(log, "q_accident_count")).toHaveLength(1);

  const retracted = answerPosted(page);
  await blurActive(page);
  await retracted;
  expect(postsFor(log, "q_accident_count")).toEqual([
    { questionId: "q_accident_count", value: 10, status: 200 },
    { questionId: "q_accident_count", value: null, status: 200 },
  ]);

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
  await expect(page.getByRole("textbox", { name: KS.extraDetail })).toBeVisible();

  await toggleOption(page, "Breakdown");
  expect(postsFor(log, "q_optional_cover")).toHaveLength(1);

  const retracted = answerPosted(page);
  await blurActive(page);
  await retracted;

  expect(postsFor(log, "q_optional_cover")).toEqual([
    { questionId: "q_optional_cover", value: ["opt_breakdown"], status: 200 },
    { questionId: "q_optional_cover", value: null, status: 200 },
  ]);
  expectNoRejectedPosts(log);

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

  await chooseRadio(page, "No");
  const no = page.getByRole("radio", { name: "No", exact: true });

  // The `radio` role resolves to react-aria's visually hidden input, so bypassing
  // actionability is the subject of the test rather than a flake workaround.
  // eslint-disable-next-line sonarjs/no-forced-browser-interaction -- the bypass is the subject of the test
  await no.click({ force: true });
  await no.focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");

  await toggleOption(page, "Breakdown");
  await commitCheckboxGroup(page);

  expect(postsFor(log, "q_at_fault_accident")).toEqual([
    { questionId: "q_at_fault_accident", value: false, status: 200 },
  ]);
  await expect(no).toBeChecked();

  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

  const standard = page.getByRole("radio", { name: "Standard", exact: true });
  const posted = answerPosted(page);
  await page.getByText("Standard", { exact: true }).click();
  await posted;

  // eslint-disable-next-line sonarjs/no-forced-browser-interaction -- the hidden react-aria input again; the bypass is the subject of the test
  await standard.click({ force: true });
  await standard.focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");

  const changed = answerPosted(page);
  await page.getByText("Premium", { exact: true }).click();
  await changed;

  expect(postsFor(log, "q_coverage_level")).toEqual([
    { questionId: "q_coverage_level", value: "opt_standard", status: 200 },
    { questionId: "q_coverage_level", value: "opt_premium", status: 200 },
  ]);
  expectNoRejectedPosts(log);
});
