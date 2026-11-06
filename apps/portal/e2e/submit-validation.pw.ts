import { test, expect } from "./support/gates.js";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";
import {
  KS,
  backStep,
  checkOption,
  chooseFromSelect,
  chooseRadio,
  chooseSingleChoice,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
} from "./support/kitchen-sink.js";

import type { Page } from "@playwright/test";

const SUBMIT_URL = /\/submit$/;

/** Digits are a JSON document in their own right, which is what made this a regression. */
const DIGITS = "234234234";

const LETTERS_ONLY = "Letters only";
const PICK_AGAIN = "Pick another level";

function fieldError(page: Page, questionId: string, message: string) {
  return page.locator(`[data-qcms-field="${questionId}"]`).getByText(message);
}

async function reachCoverStep(page: Page, slug: string, detail: string): Promise<void> {
  await startKitchenSink(page, slug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);

  await chooseRadio(page, "No");
  await checkOption(page, "Breakdown");
  await fillText(page, KS.extraDetail, detail);
  await continueStep(page);

  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();
  await chooseSingleChoice(page, "Standard");
  await chooseFromSelect(page, "q_body_type", "Wagon");
}

test("a digits-only text answer submits and is stored as the text that was typed", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();

  await reachCoverStep(page, kitchenSinkSlug, DIGITS);
  const sessionId = new URL(page.url()).pathname.split("/")[2] ?? "";

  // Resuming re-reads the stored answer, so the field would be empty, or hold a number,
  // if the read did not give back the string that was stored.
  await page.reload();
  await expect(page.getByRole("radio", { name: "Standard", exact: true })).toBeChecked();
  await waitForHydration(page);
  await backStep(page);
  await expect(page.getByRole("textbox", { name: KS.extraDetail })).toHaveValue(DIGITS);

  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();
  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);
  await expect(page.getByTestId("content-hash")).toHaveText(/^[0-9a-f]{64}$/);

  const db = await openDb(databaseUrl);
  try {
    expect((await db.latestAnswers(sessionId)).get("q_extra_detail")).toBe(DIGITS);
    const locked = await db.lockedAnswers(sessionId);
    expect(locked.find((answer) => answer.questionId === "q_extra_detail")?.value).toBe(DIGITS);
  } finally {
    await db.close();
  }
});

test("a refused submit shows each question's error on the step that asks it", async ({
  page,
  browserGuard,
}) => {
  browserGuard.expectRequestFailure({ status: 422, url: SUBMIT_URL });
  const { kitchenSinkSlug } = readFixtures();

  await reachCoverStep(page, kitchenSinkSlug, "No claims in 5 years");

  // The sweep's own refusal, which no answer post can provoke: one question on the step
  // being submitted and one three steps back.
  await page.route(/\/submit$/, async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "SUBMISSION_INVALID",
          details: {
            missingRequired: [],
            errors: [
              {
                code: "INVALID_ANSWER",
                message: 'Answer for question "q_full_name" is invalid',
                questionId: "q_full_name",
                errors: [
                  { code: "PATTERN_MISMATCH", constraint: "pattern", message: LETTERS_ONLY },
                ],
              },
              {
                code: "INVALID_ANSWER",
                message: 'Answer for question "q_coverage_level" is invalid',
                questionId: "q_coverage_level",
                errors: [{ code: "INVALID_OPTION", constraint: "option", message: PICK_AGAIN }],
              },
            ],
          },
        },
      }),
    });
  });

  await page.getByTestId("primary-action").click();

  // This step's refusal is beside its own question, and the summary names it.
  const summary = page.getByTestId("error-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();
  await expect(fieldError(page, "q_coverage_level", PICK_AGAIN)).toBeVisible();
  await expect(summary.getByRole("link", { name: new RegExp(PICK_AGAIN) })).toHaveCount(1);
  await expect(fieldError(page, "q_full_name", LETTERS_ONLY)).toHaveCount(0);

  // The other step is named by its number and is one press away.
  const toFirstStep = summary.getByTestId("error-summary-step");
  await expect(toFirstStep).toHaveText("Step 1 has 1 answer to fix.");
  await toFirstStep.click();

  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(fieldError(page, "q_full_name", LETTERS_ONLY)).toBeVisible();
  const arrived = page.getByTestId("error-summary");
  await expect(arrived).toBeVisible();
  await expect(arrived.getByRole("link", { name: `${KS.fullName}: ${LETTERS_ONLY}` })).toHaveCount(
    1,
  );
  await expect(arrived.getByTestId("error-summary-step")).toHaveCount(1);

  // Fixing the answer drops the message with it.
  await page.getByRole("textbox", { name: KS.fullName }).fill("Grace Hopper");
  await expect(fieldError(page, "q_full_name", LETTERS_ONLY)).toHaveCount(0);
});
