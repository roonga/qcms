/**
 * A number question with scripting disabled (issue #18, Code Owner ruling
 * 2026-09-19).
 *
 * ## What was broken
 *
 * react-aria's NumberField splits one question across two elements: the box the
 * respondent types into is `<input type="text" required inputmode="numeric">` with
 * NO `name`, and the form value rides a separate `<input type="hidden">` that only
 * JavaScript writes. So typing `3` filled the visible box, left the named field
 * `""`, and satisfied the browser's own `required` check - the visible box is
 * non-empty - and the step submitted with the answer discarded. The API then
 * reported the question missing and, since issue #964, the step said so beside a
 * field that had re-rendered blank. The only feedback a no-JS respondent got about a
 * number question was that their keystrokes had vanished.
 *
 * ## The ruling, and what each case here is for
 *
 * The principle recorded on #974: JavaScript is assumed, and the no-JS form is a
 * fallback that must work FUNCTIONALLY, without rapid feedback. A number question
 * that discards what is typed does not work functionally, so native mode renders a
 * real `<input type="number">` under the question's own name with the compiled
 * `min` / `max` / `step`.
 *
 * Four cases, and they are one story rather than four behaviours: the browser stops
 * what HTML can express (`max`, and `step: 1` for an integer question), the API
 * stops everything else, and the marker that clears an answer now reaches a number
 * for the first time. The markup contract is pinned in jsdom
 * (`packages/ui/src/native-number-field.test.tsx`); what a browser does with it can
 * only be asserted here.
 *
 * Every submit waits on the navigation it produces. A native form submission the
 * browser refuses is otherwise indistinguishable from one that changed nothing.
 */

import type { Page } from "@playwright/test";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
import { countStepPosts, submitStep } from "./support/no-js.js";

test.use({ javaScriptEnabled: false });

const COUNT_FIELD = 'input[name="q_accident_count"]';
const ANNUAL_KM_FIELD = 'input[name="q_annual_km"]';
const NAME_FIELD = 'input[name="q_full_name"]';
const DATE_FIELD = 'input[name="q_dob"]';

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
  await page.locator(DATE_FIELD).fill("1990-05-17");
  await submitStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
}

/**
 * Walk to the state the required number is VISIBLE in: step two, at-fault answered
 * "Yes" and one optional cover chosen. The follow-up is behind a rule the API
 * evaluates, so it takes a round trip to appear - the first submit answers the
 * branch question, and the step comes back carrying the number.
 */
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

    // The control the browser can actually operate, carrying the question's own name
    // and its compiled constraints. Before the fix the element under this name was
    // `type="hidden"`, and the box that took the keystrokes had no name at all.
    const count = page.locator(COUNT_FIELD);
    await expect(count).toHaveAttribute("type", "number");
    await expect(count).toHaveAttribute("min", "0");
    await expect(count).toHaveAttribute("max", "200");
    await expect(count).toHaveAttribute("step", "1");
    await expect(page.getByLabel(/how many/i)).toHaveAttribute("name", "q_accident_count");

    await count.fill("3");
    await submitStep(page);

    // The step advanced, and the typed value is what the API stored as a JSON number.
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

  // Counted from here, so "the browser blocked it" is a fact rather than an absence
  // observed for an arbitrary length of time.
  const postCount = countStepPosts(page);
  const count = page.locator(COUNT_FIELD);

  // Above the question's max. The ruling KEEPS browser validation wherever HTML can
  // carry the rule, so this is the intended outcome, not a residue.
  await count.fill("201");
  await page.getByTestId("step-card").locator('form button[type="submit"]').click();
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  // A fraction on an INTEGER question (#151, #944). The compiler's `step: 1` is the
  // only trace of that constraint, and it reaches the native input as `step="1"`, so
  // the browser refuses `2.5` here rather than only the API refusing it later.
  await count.fill("2.5");
  await page.getByTestId("step-card").locator('form button[type="submit"]').click();
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  // Now a value both accept, and the navigation that follows is what makes the count
  // decisive: had either click posted, there would be more than one.
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

    // The point is what happens when the browser's own validation is not in play: an
    // older browser, a scripted client, or a hand-built form. `page.request` shares
    // this context's cookies, so this is the same session the page is looking at -
    // a respondent defeating their own form, which is the threat model that makes
    // server-side validation worth having (R2: the API is authoritative).
    const response = await page.request.post(`/s/${sessionId}/step`, {
      headers: { "sec-fetch-site": "same-origin" },
      form: {
        __qk__q_accident_count: "number",
        q_accident_count: "2.5",
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);

    // Nothing stored for the integer question: not 2.5, not a rounded 3, nothing.
    expect((await db.latestAnswers(sessionId)).has("q_accident_count")).toBe(false);
    expect(
      (await db.answerRows(sessionId)).filter((r) => r.questionId === "q_accident_count"),
    ).toEqual([]);

    // And the kernel's own wording for the constraint that failed reaches the
    // respondent, in the summary and in the field's own slot (issue #322).
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
    // OPTIONAL, because a required number cannot be emptied through the browser at
    // all: HTML `required` refuses the empty submit before the form leaves the page,
    // which is the 2026-09-13 ruling on issue #920 working as intended. `q_annual_km`
    // is the fixture's optional number (`apps/api/e2e/support/fixtures/q-annual-km.json`).
    const sessionId = await startWithoutJs(page, kitchenSinkSlug);
    await passAboutStep(page);
    await page.getByText("No", { exact: true }).click();
    await page.getByText("Breakdown", { exact: true }).click();
    await submitStep(page);
    await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

    // Seeding the answer takes a crafted post rather than a second visit to this
    // step: answering the step's one required question completes the session, so the
    // BFF submits it and 303s to the receipt, and there is no second render to clear
    // anything on. The CLEAR itself - the subject of the case - is a real no-JS
    // gesture below.
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
    // The marker is the whole mechanism, and it is emitted only for a question that
    // currently holds an answer (issue #127).
    await expect(page.locator('input[name="__qa__q_annual_km"]')).toHaveCount(1);
    expect(await km.getAttribute("required")).toBeNull();

    // The gesture: empty the box, answer the step's required question, submit.
    await km.fill("");
    await page.getByText("Standard", { exact: true }).click();
    await page.getByTestId("step-card").locator('form button[type="submit"]').click();
    await page.waitForURL(/\/done/);

    // THE OBSERVATION, inverted. Absence in Postgres - before this change the number
    // could not be emptied at all without scripting, because the value rode a hidden
    // input the respondent could not touch.
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
