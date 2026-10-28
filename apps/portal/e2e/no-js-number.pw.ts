import type { Page } from "@playwright/test";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
import { countStepPosts, fillNativeDate, submitStep } from "./support/no-js.js";

test.use({ javaScriptEnabled: false });

const COUNT_FIELD = 'input[name="q_accident_count"]';
const ANNUAL_KM_FIELD = 'input[name="q_annual_km"]';
const NAME_FIELD = 'input[name="q_full_name"]';

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

async function revealCount(page: Page): Promise<void> {
  await passAboutStep(page);
  await page.getByText("Yes", { exact: true }).click();
  await page.getByText("Breakdown", { exact: true }).click();
  await submitStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  await expect(page.locator(COUNT_FIELD)).toBeVisible();
}

test("a JS-disabled respondent answers a required number and it lands in Postgres", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await startWithoutJs(page, kitchenSinkSlug);
    await revealCount(page);

    const count = page.locator(COUNT_FIELD);
    await expect(count).toHaveAttribute("type", "number");
    await expect(count).toHaveAttribute("min", "0");
    await expect(count).toHaveAttribute("max", "200");
    await expect(count).toHaveAttribute("step", "1");
    await expect(page.getByLabel(/how many/i)).toHaveAttribute("name", "q_accident_count");

    await count.fill("3");
    await submitStep(page);

    await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();
    expect((await db.latestAnswers(sessionId)).get("q_accident_count")).toBe(3);
  } finally {
    await db.close();
  }
});

test("the browser refuses a number outside the question's bounds, and a fraction on an integer one", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startWithoutJs(page, kitchenSinkSlug);
  await revealCount(page);

  const postCount = countStepPosts(page);
  const count = page.locator(COUNT_FIELD);

  await count.fill("201");
  await page.getByTestId("step-card").locator('form button[type="submit"]').click();
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  await count.fill("2.5");
  await page.getByTestId("step-card").locator('form button[type="submit"]').click();
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  await count.fill("3");
  await submitStep(page);
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();
  expect(postCount()).toBe(1);
});

test("a crafted fraction that skips the browser is refused by the API and reported on the step", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await startWithoutJs(page, kitchenSinkSlug);
    await revealCount(page);

    const response = await page.request.post(`/s/${sessionId}/step`, {
      headers: { "sec-fetch-site": "same-origin" },
      form: {
        __qk__q_accident_count: "number",
        q_accident_count: "2.5",
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);

    expect((await db.latestAnswers(sessionId)).has("q_accident_count")).toBe(false);
    expect(
      (await db.answerRows(sessionId)).filter((r) => r.questionId === "q_accident_count"),
    ).toEqual([]);

    await page.goto(`/s/${sessionId}`);
    await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
    await expect(page.getByTestId("error-summary")).toContainText(/whole number/i);
    await expect(
      page.locator('[data-qcms-field="q_accident_count"]').getByText(/whole number/i),
    ).toBeVisible();
  } finally {
    await db.close();
  }
});

test("an optional number can be cleared without scripting, and the server lets go of it", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await startWithoutJs(page, kitchenSinkSlug);
    await passAboutStep(page);
    await page.getByText("No", { exact: true }).click();
    await page.getByText("Breakdown", { exact: true }).click();
    await submitStep(page);
    await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

    const seeded = await page.request.post(`/s/${sessionId}/step`, {
      headers: { "sec-fetch-site": "same-origin" },
      form: { __qk__q_annual_km: "number", q_annual_km: "12000" },
      maxRedirects: 0,
    });
    expect(seeded.status()).toBe(303);
    expect((await db.latestAnswers(sessionId)).get("q_annual_km")).toBe(12000);

    await page.goto(`/s/${sessionId}`);
    const km = page.locator(ANNUAL_KM_FIELD);
    await expect(km).toHaveValue("12000");
    await expect(page.locator('input[name="__qa__q_annual_km"]')).toHaveCount(1);
    expect(await km.getAttribute("required")).toBeNull();

    await km.fill("");
    await page.getByText("Standard", { exact: true }).click();
    await page.locator('select[name="q_body_type"]').selectOption("opt_wagon");
    await page.getByTestId("step-card").locator('form button[type="submit"]').click();
    await page.waitForURL(/\/done/);

    expect((await db.latestAnswers(sessionId)).has("q_annual_km")).toBe(false);
    const rows = (await db.answerRows(sessionId)).filter((r) => r.questionId === "q_annual_km");
    expect(rows.map((r) => [r.value, r.retracted])).toEqual([
      [12000, false],
      [null, true],
    ]);
  } finally {
    await db.close();
  }
});
