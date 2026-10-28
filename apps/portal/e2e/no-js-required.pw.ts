import type { Page } from "@playwright/test";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
import { KS } from "./support/kitchen-sink.js";
import {
  countStepPosts,
  fillNativeDate,
  NATIVE_DATE_BOX,
  stepSubmit,
  submitStep,
} from "./support/no-js.js";

test.use({ javaScriptEnabled: false });

const NAME_FIELD = 'input[name="q_full_name"]';

/** Start the kitchen sink with no scripting and land on step one ("About you"). */
async function startWithoutJs(page: Page, slug: string): Promise<string> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2] ?? "";
}

test("a JS-disabled respondent submits a step holding a required date", async ({ page }) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await startWithoutJs(page, kitchenSinkSlug);

    const group = page.getByRole("group", { name: KS.dob });
    await expect(group).toBeVisible();
    await expect(group.getByRole("textbox")).toHaveCount(3);
    expect(
      await group
        .locator("input[data-qcms-date-part]")
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset["qcmsDatePart"])),
    ).toEqual(["day", "month", "year"]);
    for (const part of ["day", "month", "year"] as const) {
      await expect(page.locator(NATIVE_DATE_BOX[part]("q_dob"))).toHaveAttribute("required", "");
    }

    await page.locator(NAME_FIELD).fill("Ada Lovelace");
    await fillNativeDate(page, "q_dob", "1990-05-17");
    await submitStep(page);

    await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

    expect((await db.latestAnswers(sessionId)).get("q_dob")).toBe("1990-05-17");
  } finally {
    await db.close();
  }
});

test("the browser still refuses to submit an empty required date, and says so on the field", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startWithoutJs(page, kitchenSinkSlug);

  const postCount = countStepPosts(page);

  await page.locator(NAME_FIELD).fill("Ada Lovelace");

  await stepSubmit(page).click();
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();

  await fillNativeDate(page, "q_dob", "1990-05-17");
  await submitStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  expect(postCount()).toBe(1);
});

test("a crafted post that skips the browser is refused by the API and reported on the step", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await startWithoutJs(page, kitchenSinkSlug);

    const response = await page.request.post(`/s/${sessionId}/step`, {
      headers: { "sec-fetch-site": "same-origin" },
      form: {
        __qk__q_full_name: "string",
        q_full_name: "Ada Lovelace",
        __qk__q_dob: "string",
        q_dob: "",
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);

    expect((await db.latestAnswers(sessionId)).has("q_dob")).toBe(false);
    expect((await db.answerRows(sessionId)).filter((r) => r.questionId === "q_dob")).toEqual([]);

    await page.goto(`/s/${sessionId}`);
    await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
    const summary = page.getByTestId("error-summary");
    await expect(summary).toBeVisible();
    await expect(summary.getByRole("link", { name: /Date of birth/ })).toBeVisible();
    await expect(page.getByText("This question needs an answer.")).toBeVisible();

    await expect(page.locator(NAME_FIELD)).toHaveValue("Ada Lovelace");
    for (const part of ["day", "month", "year"] as const) {
      await expect(page.locator(NATIVE_DATE_BOX[part]("q_dob"))).toHaveValue("");
    }
  } finally {
    await db.close();
  }
});

test("the API's own 422 lands next to its field too, with the rest of the step intact", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await startWithoutJs(page, kitchenSinkSlug);

    const response = await page.request.post(`/s/${sessionId}/step`, {
      headers: { "sec-fetch-site": "same-origin" },
      form: {
        __qk__q_full_name: "string",
        q_full_name: "Ada1",
        __qk__q_dob: "string",
        q_dob: "1990-05-17",
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);

    const stored = await db.latestAnswers(sessionId);
    expect(stored.has("q_full_name")).toBe(false);
    expect(stored.get("q_dob")).toBe("1990-05-17");

    await page.goto(`/s/${sessionId}`);
    await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
    await expect(page.getByTestId("error-summary")).toContainText(/does not match/i);
    await expect(page.getByText(/does not match/i).first()).toBeVisible();

    await expect(page.locator(NAME_FIELD)).toHaveValue("Ada1");
    await expect(page.locator(NATIVE_DATE_BOX.day("q_dob"))).toHaveValue("17");
    await expect(page.locator(NATIVE_DATE_BOX.month("q_dob"))).toHaveValue("05");
    await expect(page.locator(NATIVE_DATE_BOX.year("q_dob"))).toHaveValue("1990");
  } finally {
    await db.close();
  }
});
