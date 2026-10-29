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
import { submitStep } from "./support/no-js.js";

test.use({ javaScriptEnabled: false });

const DETAIL_QUESTION = "q_extra_detail";

function sessionIdOf(url: string): string {
  return new URL(url).pathname.split("/")[2] ?? "";
}

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

async function resumeWithoutJs(page: Page, from: BrowserContext, sessionId: string): Promise<void> {
  await page.context().addCookies(await from.cookies());
  await page.goto(`/s/${sessionId}`);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
}

/**
 * "No" keeps the required NumberField hidden, which would otherwise block the
 * submission. The real radio input sits under a decorative indicator, so the label is
 * the hit target, and native label association checks it with no scripting.
 */
async function answerRequiredBoolean(page: Page): Promise<void> {
  await page.getByText("No", { exact: true }).click();
}

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

    const detail = page.getByRole("textbox", { name: KS.extraDetail });
    await expect(detail).toHaveValue("No claims");
    await expect(marker(page, DETAIL_QUESTION)).toHaveCount(1);
    await expect(marker(page, DETAIL_QUESTION)).toHaveAttribute("type", "hidden");
    await expect(marker(page, "q_accident_count")).toHaveCount(0);

    await detail.fill("");
    await answerRequiredBoolean(page);
    await submitStep(page);

    await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

    expect((await db.latestAnswers(sessionId)).has(DETAIL_QUESTION)).toBe(false);

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
