/**
 * A required question with scripting disabled (issue #920, Code Owner ruling
 * 2026-09-13).
 *
 * ## The two halves the ruling asked for, and why they are one spec
 *
 * The ruling kept browser validation in the no-JS form AND made the server report
 * the same constraint, so the interesting property is the pair: the browser stops
 * the ordinary respondent, and the API stops everyone else. Split across two files
 * that reads as two unrelated behaviours; here the third test is deliberately the
 * second test with the browser taken out of the loop.
 *
 * ## What was broken
 *
 * The kitchen sink's first step holds a required date, and a react-aria DatePicker
 * is a row of JS-driven spinbutton segments whose form value rode on an
 * `<input type="text" hidden required>`. With scripting off nothing could be typed
 * into it, and `hidden` is not `type="hidden"`: `willValidate` stays true, so the
 * browser tried to report the failure, could not focus the control to do it, and
 * abandoned the submission (`An invalid form control with name='q_dob' is not
 * focusable`). Step one was a dead end, and `docs/portal-constraints.md` claimed
 * every flow completes with scripting disabled.
 *
 * Underneath that, the no-JS transport said nothing about a missing required
 * answer at all. The API refused the submit, correctly and silently, and the
 * respondent got a 303 back to a step that looked exactly as it had.
 *
 * ## Why the third case posts by hand
 *
 * Because the point is what happens when the browser's own validation is not in
 * play: an older browser, a scripted client, or a hand-built form. `page.request`
 * shares this context's cookies, so the POST is the same session the page is
 * looking at - a respondent defeating their own form, which is the threat model
 * that makes server-side validation worth having (R2: the API is authoritative).
 *
 * The assertion that matters there is Postgres. A page that looks right is what the
 * silent behaviour already produced.
 */

import type { Page } from "@playwright/test";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
import { KS } from "./support/kitchen-sink.js";

test.use({ javaScriptEnabled: false });

const NAME_FIELD = 'input[name="q_full_name"]';
const DATE_FIELD = 'input[name="q_dob"]';

/** Start the kitchen sink with no scripting and land on step one ("About you"). */
async function startWithoutJs(page: Page, slug: string): Promise<string> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2] ?? "";
}

/** The step form's own submit (the header's appearance form has one too, #195). */
function stepSubmit(page: Page) {
  return page.getByTestId("step-card").locator('form button[type="submit"]');
}

/** Submit the step and wait for the page the 303 lands on. */
async function submitStep(page: Page): Promise<void> {
  const served = page.waitForResponse(
    (response) => response.request().isNavigationRequest() && response.status() === 200,
  );
  await stepSubmit(page).click();
  await served;
}

test("a JS-disabled respondent submits a step holding a required date", async ({ page }) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await startWithoutJs(page, kitchenSinkSlug);

    // The control the browser can actually operate: a native day input, labelled by
    // the question, carrying the question's own ISO bounds. Before the fix the only
    // thing on the page under this name was an unfocusable hidden mirror.
    const date = page.locator(DATE_FIELD);
    await expect(date).toBeVisible();
    await expect(date).toHaveAttribute("type", "date");
    await expect(date).toHaveAttribute("min", "1900-01-01");
    await expect(date).toHaveAttribute("max", "2100-12-31");
    await expect(page.getByLabel(KS.dob)).toHaveAttribute("name", "q_dob");

    await page.locator(NAME_FIELD).fill("Ada Lovelace");
    await date.fill("1990-05-17");
    await submitStep(page);

    // The step advanced, which is the whole claim: this POST could not happen at all
    // before, because the browser refused to submit the form.
    await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

    // And the ISO day the native control posted is the canonical value the API
    // stored - the same bytes the scripted path sends for the same answer.
    expect((await db.latestAnswers(sessionId)).get("q_dob")).toBe("1990-05-17");
  } finally {
    await db.close();
  }
});

test("the browser still refuses to submit an empty required date, and says so on the field", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();

  // Every POST this page makes, so "the browser blocked it" is a counted fact rather
  // than an absence observed for an arbitrary length of time.
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });

  await startWithoutJs(page, kitchenSinkSlug);
  await page.locator(NAME_FIELD).fill("Ada Lovelace");

  // Click Continue with the date empty. The ruling KEPT browser validation, so this
  // is the intended outcome, not a residue: nothing leaves the page.
  await stepSubmit(page).click();
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();

  // Now fill it and submit for real. The navigation that follows is what makes the
  // count above decisive: if the first click had posted, there would be two.
  await page.locator(DATE_FIELD).fill("1990-05-17");
  await submitStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  expect(posts).toHaveLength(1);
});

test("a crafted post that skips the browser is refused by the API and reported on the step", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  const db = await openDb(databaseUrl);
  try {
    const sessionId = await startWithoutJs(page, kitchenSinkSlug);

    // The whole step, hand-built: a good name, and the required date posted empty -
    // exactly what a browser with no constraint validation would send. The kind tags
    // are the renderer's own, so the BFF decodes it as the real form (task 044), and
    // the same-origin header is what the SEC-9 belt asks for (issue #487).
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

    // THE OBSERVATION, inverted. Nothing was stored for the required question: not an
    // empty string, not a tombstone, nothing. The API refuses an empty value outright
    // (EMPTY_ANSWER_NOT_ALLOWED) and the BFF never invents one.
    expect((await db.latestAnswers(sessionId)).has("q_dob")).toBe(false);
    expect((await db.answerRows(sessionId)).filter((r) => r.questionId === "q_dob")).toEqual([]);

    // And the respondent is told, on the step, without scripting: a summary entry
    // naming the question and a message in the field's own slot.
    await page.goto(`/s/${sessionId}`);
    await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
    const summary = page.getByTestId("error-summary");
    await expect(summary).toBeVisible();
    await expect(summary.getByRole("link", { name: /Date of birth/ })).toBeVisible();
    await expect(page.getByText("This question needs an answer.")).toBeVisible();

    // The answer that WAS accepted survives the round trip, so the respondent fixes
    // one field instead of retyping the step.
    await expect(page.locator(NAME_FIELD)).toHaveValue("Ada Lovelace");
    await expect(page.locator(DATE_FIELD)).toHaveValue("");
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

    // The BFF's 422 rendering has never had a browser assertion on this transport,
    // and it takes a crafted post to reach at all: `q_full_name` carries a `pattern`
    // the renderer emits as the HTML attribute, so the browser refuses a name with a
    // digit in it before the form leaves the page. That is the ruling working as
    // intended; it also means the server half is the only thing standing between a
    // client that ignores `pattern` and a stored answer, which is what this asserts.
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

    // Refused by the kernel through the API, so nothing was stored for the name; the
    // date posted beside it was fine and was.
    const stored = await db.latestAnswers(sessionId);
    expect(stored.has("q_full_name")).toBe(false);
    expect(stored.get("q_dob")).toBe("1990-05-17");

    await page.goto(`/s/${sessionId}`);
    await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
    // The kernel's own wording for the constraint that failed, in the field's slot and
    // in the summary - not the generic "that answer is not valid" (issue #322).
    await expect(page.getByTestId("error-summary")).toContainText(/does not match/i);
    await expect(page.getByText(/does not match/i).first()).toBeVisible();

    // The value the respondent typed is back in the box, so they correct it rather
    // than retype it, and the accepted date beside it is untouched.
    await expect(page.locator(NAME_FIELD)).toHaveValue("Ada1");
    await expect(page.locator(DATE_FIELD)).toHaveValue("1990-05-17");
  } finally {
    await db.close();
  }
});
