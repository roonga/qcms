/**
 * A single-choice question above the compiler's option threshold, with scripting
 * disabled (issue #988).
 *
 * ## What was broken
 *
 * A `singleChoice` question compiles to a `Select` above seven options and to a
 * `RadioGroup` at or below it (`SINGLE_CHOICE_SELECT_THRESHOLD`,
 * `packages/a2ui-compiler/src/mapping.ts`). The vendored `Select` DID render a real
 * `<select>` carrying the real options under the question's own name - nothing was
 * missing from the wire - and rendered it inside a clipped container that is
 * `aria-hidden="true"` with `tabindex="-1"` on the select, as an autofill and
 * validation mirror, behind a visible `<button aria-haspopup="listbox">` only
 * JavaScript can open. So a respondent without scripting could neither see nor
 * operate the question, and a REQUIRED one was worse than unanswerable: the browser
 * tried to report validity on the unfocusable mirror, could not, and abandoned the
 * whole step's submission (`An invalid form control ... is not focusable`), which
 * made every step behind it unreachable.
 *
 * No fixture compiled a `Select` at all, which is why every gate was green over it.
 * The vehicle kitchen sink now carries a required/optional pair on its last step.
 *
 * ## The ruling, and what each case here is for
 *
 * The principle recorded on #974: JavaScript is assumed, and the no-JS form is a
 * fallback that must work FUNCTIONALLY, without rapid feedback. Native mode
 * therefore renders a real, visible `<select>` under the question's own name
 * (`packages/ui/src/native-select-field.tsx`).
 *
 * Four cases, and they are one story rather than four behaviours. The respondent can
 * answer and the answer lands. The browser still stops a blank required one, because
 * HTML CAN express "one option chosen" for a select - which is what separates this
 * from the required multi-choice group of #974, where the attribute had to go (the
 * 2026-09-13 ruling on #920 stands wherever HTML carries the rule). The empty-valued
 * placeholder option gives an OPTIONAL single choice a clear gesture it has never
 * had on any path. And the fix was not made by hiding anything: the control is a
 * real, named, labelled, focusable select.
 *
 * The markup contract is pinned in jsdom (`packages/ui/src/native-select-field.test.tsx`);
 * what a browser does with it can only be asserted here. Every submit waits on the
 * navigation it produces: a native form submission the browser refuses is otherwise
 * indistinguishable from one that changed nothing.
 */

import type { Page } from "@playwright/test";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
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

    // The control the browser can actually operate, carrying the question's own name.
    // Before the fix the only element under this name was inside an `aria-hidden`
    // clipped container with `tabindex="-1"`, and the visible control was a button
    // whose listbox nothing could open.
    const bodyType = page.locator(BODY_TYPE);
    await expect(bodyType).toBeVisible();
    await expect(bodyType).toHaveAttribute("required", "");
    // The whole option list is on the page, with the empty-valued placeholder first.
    await expect(bodyType.locator("option")).toHaveCount(10);
    await expect(bodyType.locator("option").first()).toHaveAttribute("value", "");

    await chooseCoverLevel(page);
    await bodyType.selectOption("opt_wagon");
    // This is the form's last step, so a complete submit is the session's submit.
    await stepSubmit(page).click();
    await page.waitForURL(/\/done/);

    // The chosen OptionId is what the API stored, as the same string the scripted
    // path posts: the BFF's `string` decode needed no change for this control.
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

  // Counted from here, so "the browser blocked it" is a fact rather than an absence
  // observed for an arbitrary length of time.
  const postCount = countStepPosts(page);

  // The step's OTHER required question is answered, so the select is the only thing
  // standing between this form and a submit. Before the fix this click produced the
  // same outcome for the opposite reason: the browser could not focus the clipped
  // mirror to report it, so it abandoned the submission with nothing on screen to
  // say why, and no selection was reachable to fix it.
  await chooseCoverLevel(page);
  await stepSubmit(page).click();
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

  // Now a value the browser accepts, and the navigation that follows is what makes
  // the count decisive: had the click above posted, there would be more than one.
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
    // OPTIONAL, because a required select cannot be emptied through the browser at
    // all: HTML `required` refuses the empty submit before the form leaves the page,
    // which is the case above working as intended. `q_overnight_parking` is the
    // fixture's optional Select (`apps/api/e2e/support/fixtures/q-overnight-parking.json`).
    const sessionId = await coverStep(page, kitchenSinkSlug);

    // Seeding the answer takes a crafted post rather than a second visit to this
    // step: answering the step's required questions completes the session, so the
    // BFF submits it and 303s to the receipt, and there is no second render to clear
    // anything on. The CLEAR itself - the subject of the case - is a real no-JS
    // gesture below.
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
    // The marker is the whole mechanism, and it is emitted only for a question that
    // currently holds an answer (issue #127).
    await expect(page.locator('input[name="__qa__q_overnight_parking"]')).toHaveCount(1);
    expect(await parking.getAttribute("required")).toBeNull();

    // The gesture, and it exists only on this path: `docs/COMPONENT_GUIDELINES.md`
    // records that a chosen Select option cannot be deselected, which is still true
    // of the scripted control - re-selecting it posts nothing and react-aria will not
    // deselect a chosen key. A native select with an empty-valued placeholder can be
    // returned to it.
    await parking.selectOption("");
    await chooseCoverLevel(page);
    await page.locator(BODY_TYPE).selectOption("opt_wagon");
    await stepSubmit(page).click();
    await page.waitForURL(/\/done/);

    // THE OBSERVATION, inverted. Absence in Postgres, reached through the ADR-33
    // retraction the `__qa__` marker turns an empty post into: one row for the
    // answer, one tombstone for the clear, never a mutation.
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
  // A guard on the SHAPE of the fix rather than on its effect: the control must be a
  // real select carrying the question's name and its own accessible name, because
  // making the step submittable must not have been done by hiding the question or by
  // dropping its label.
  const { kitchenSinkSlug } = readFixtures();
  await coverStep(page, kitchenSinkSlug);

  const bodyType = page.locator(BODY_TYPE);
  await expect(bodyType).toBeVisible();
  await expect(bodyType).toBeEnabled();
  await expect(page.getByLabel("What body type is the vehicle?")).toHaveAttribute(
    "name",
    "q_body_type",
  );
  // Focusable, which the clipped mirror was not: `tabindex="-1"` is what stopped the
  // browser reporting the validity of a required one.
  await bodyType.focus();
  await expect(bodyType).toBeFocused();
  // And neither half of the scripted rendering is on this page: no JS-only trigger,
  // and nothing answering to the question's name from inside an `aria-hidden`
  // subtree.
  await expect(page.locator('[aria-haspopup="listbox"]')).toHaveCount(0);
  await expect(page.locator(`[aria-hidden="true"] ${BODY_TYPE}`)).toHaveCount(0);
  await expect(stepSubmit(page)).toBeEnabled();
});
