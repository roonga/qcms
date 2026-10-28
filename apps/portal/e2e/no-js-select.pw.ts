/**
 * A single-choice question above the compiler's option threshold, with scripting
 * disabled.
 *
 * Such a question compiles to a `Select`, and the vendored control renders its real
 * `<select>` inside a clipped `aria-hidden` container as an autofill mirror, behind a
 * button only JavaScript can open. Nothing was missing from the wire, but a respondent
 * without scripting could not operate the question, and a required one abandoned the
 * whole step's submission, the browser being unable to report validity on an unfocusable
 * control. No fixture compiled a `Select` at all, which is why every gate was green over
 * it.
 *
 * The principle is that JavaScript is assumed and the no-JS form is a fallback that has
 * to work functionally, without rapid feedback.
 */

import type { Page } from "@playwright/test";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
import { KS } from "./support/kitchen-sink.js";
import { countStepPosts, stepSubmit, walkToCoverStep } from "./support/no-js.js";

test.use({ javaScriptEnabled: false });

/** The required nine-option single choice, and the optional eight-option one. */
const BODY_TYPE = 'select[name="q_body_type"]';
const PARKING = 'select[name="q_overnight_parking"]';

/**
 * Walk to "Your cover" with no scripting and return the session id. The step's own
 * questions are left unanswered; each case below drives the ones it is about.
 */
async function coverStep(page: Page, slug: string): Promise<string> {
  await walkToCoverStep(page, slug);
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2] ?? "";
}

/** Choose the step's required RadioGroup option (its label, not its hidden input). */
async function chooseCoverLevel(page: Page): Promise<void> {
  await page.getByText("Standard", { exact: true }).click();
}

test("a JS-disabled respondent answers a required single choice and it lands in Postgres", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await coverStep(page, kitchenSinkSlug);

    const bodyType = page.locator(BODY_TYPE);
    await expect(bodyType).toBeVisible();
    await expect(bodyType).toHaveAttribute("required", "");
    await expect(bodyType.locator("option")).toHaveCount(10);
    await expect(bodyType.locator("option").first()).toHaveAttribute("value", "");

    await chooseCoverLevel(page);
    await bodyType.selectOption("opt_wagon");
    await stepSubmit(page).click();
    await page.waitForURL(/\/done/);

    expect((await db.latestAnswers(sessionId)).get("q_body_type")).toBe("opt_wagon");
  } finally {
    await db.close();
  }
});

test("the browser refuses a blank required single choice, and the POST count says so", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await coverStep(page, kitchenSinkSlug);

  const postCount = countStepPosts(page);

  await chooseCoverLevel(page);
  await stepSubmit(page).click();
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

  await page.locator(BODY_TYPE).selectOption("opt_sedan");
  await stepSubmit(page).click();
  await page.waitForURL(/\/done/);
  expect(postCount()).toBe(1);
});

test("an optional single choice can be cleared without scripting, and the server lets go of it", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await coverStep(page, kitchenSinkSlug);

    const seeded = await page.request.post(`/s/${sessionId}/step`, {
      headers: { "sec-fetch-site": "same-origin" },
      form: { __qk__q_overnight_parking: "string", q_overnight_parking: "opt_garage" },
      maxRedirects: 0,
    });
    expect(seeded.status()).toBe(303);
    expect((await db.latestAnswers(sessionId)).get("q_overnight_parking")).toBe("opt_garage");

    await page.goto(`/s/${sessionId}`);
    const parking = page.locator(PARKING);
    await expect(parking).toHaveValue("opt_garage");
    await expect(page.locator('input[name="__qa__q_overnight_parking"]')).toHaveCount(1);
    expect(await parking.getAttribute("required")).toBeNull();

    await parking.selectOption("");
    await chooseCoverLevel(page);
    await page.locator(BODY_TYPE).selectOption("opt_wagon");
    await stepSubmit(page).click();
    await page.waitForURL(/\/done/);

    expect((await db.latestAnswers(sessionId)).has("q_overnight_parking")).toBe(false);
    const rows = (await db.answerRows(sessionId)).filter(
      (r) => r.questionId === "q_overnight_parking",
    );
    expect(rows.map((r) => [r.value, r.retracted])).toEqual([
      ["opt_garage", false],
      [null, true],
    ]);
  } finally {
    await db.close();
  }
});

test("the select is a real named focusable control, and the submit is reachable, with no scripting", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await coverStep(page, kitchenSinkSlug);

  const bodyType = page.locator(BODY_TYPE);
  await expect(bodyType).toBeVisible();
  await expect(bodyType).toBeEnabled();
  await expect(page.getByLabel(KS.bodyType)).toHaveAttribute("name", "q_body_type");
  await expect(page.getByLabel(KS.overnightParking)).toHaveAttribute("name", "q_overnight_parking");
  await bodyType.focus();
  await expect(bodyType).toBeFocused();
  await expect(page.locator('[aria-haspopup="listbox"]')).toHaveCount(0);
  await expect(page.locator(`[aria-hidden="true"] ${BODY_TYPE}`)).toHaveCount(0);
  await expect(stepSubmit(page)).toBeEnabled();
});
