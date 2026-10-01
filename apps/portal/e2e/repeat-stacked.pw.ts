import { expect, test } from "./support/gates.js";
import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";

/**
 * The repeating group on the **scripted** path (task 073, ADR-42, ADR-43).
 *
 * The fixture is `repeat-fleet` (`apps/api/e2e/support/fixtures/repeat-fleet-form.json`):
 * one step with a required plain question and one `open` group, `min: 1`, `max: 3`, whose
 * members are a required shortText, an optional date, a longText and a multiChoice.
 *
 * Acceptance cases owned here: **27** (the whole walk, ending in a locked set of the
 * right instances against the right ids, asserted in Postgres), **31** (a summary entry
 * naming the instance, whose anchor lands on that instance's field), **32** (the three
 * focus destinations after a removal), **33** (the status region), **37** (one input per
 * row, at 390 and at the widest project) and **38** (`longText` and `multiChoice` inside
 * a group).
 *
 * The no-JS half of the same fixture is `no-js-repeat.pw.ts`.
 */

const { repeatFleetSlug, databaseUrl } = readFixtures();

/** The group's own controls, by their compiled labels (the compiler's lexicon). */
const ADD = "Add Vehicle";
const removeName = (ordinal: number): string => `Remove Vehicle ${String(ordinal)}`;

/** One instance card, by the ordinal its heading reads. */
function card(page: import("@playwright/test").Page, ordinal: number) {
  return page.locator("fieldset[data-qcms-instance]").nth(ordinal - 1);
}

async function startRepeatFlow(page: import("@playwright/test").Page): Promise<string> {
  await page.goto(`/f/${repeatFleetSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  // The first serve mints `min: 1`, so the respondent meets a card rather than an empty
  // group with a button (ADR-42's minting rule).
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();
  await waitForHydration(page);
  return new URL(page.url()).pathname.split("/")[2]!;
}

/** Type into one instance's plate field and wait for the answer to be recorded. */
async function fillPlate(
  page: import("@playwright/test").Page,
  ordinal: number,
  value: string,
): Promise<void> {
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/answers$/.test(new URL(response.url()).pathname) &&
      response.status() === 200,
  );
  await card(page, ordinal).getByLabel("Registration plate").fill(value);
  // shortText commits on blur (ADR-31), so the post is the blur's.
  await card(page, ordinal).getByLabel("Registration plate").blur();
  await posted;
}

/** Press Add or Remove and wait for the roster write the API answers. */
async function rosterPress(page: import("@playwright/test").Page, name: string): Promise<void> {
  // Waits for the roster write and then ASSERTS its status, rather than waiting for a 200.
  // The difference is diagnostic: a refused write (a belt refusal, a rate limit, a
  // `REPEAT_MAX_REACHED`) would otherwise never satisfy the predicate and the failure would
  // read as a timeout with nothing to act on.
  const written = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/roster$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name }).click();
  const response = await written;
  expect(response.status(), `POST /roster for "${name}"`).toBe(200);
}

test("case 27: answer, add, remove and submit lands the right instances (scripted)", async ({
  page,
}) => {
  const sessionId = await startRepeatFlow(page);

  await page.getByLabel("Fleet reference").fill("NORTH-1");
  await page.getByLabel("Fleet reference").blur();
  await fillPlate(page, 1, "AAA111");

  // Add a second and a third, filling each. `max: 3`, so the third is the last the
  // group admits and the Add control goes away with it.
  await rosterPress(page, ADD);
  await expect(page.getByRole("heading", { name: "Vehicle 2" })).toBeVisible();
  await fillPlate(page, 2, "BBB222");
  await rosterPress(page, ADD);
  await fillPlate(page, 3, "CCC333");
  await expect(page.getByRole("button", { name: ADD })).toBeDisabled();

  // Remove the second. The ordinals renumber and the IDS do not: what was vehicle 3 is
  // now vehicle 2, and its answer travels with its id rather than with its position.
  await rosterPress(page, removeName(2));
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(2);
  await expect(card(page, 2).getByLabel("Registration plate")).toHaveValue("CCC333");

  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);

  // The locked set, read straight out of Postgres: two live instances, each carrying
  // the plate it was given, and the removed one's answer excluded but still in the
  // ledger (I6, ADR-42: a removal is never a delete).
  const db = await openDb(databaseUrl);
  try {
    const answers = await db.lockedAnswers(sessionId);
    const plates = answers
      .filter((answer) => answer.questionId === "q_rf_plate")
      .map((answer) => answer.value);
    expect(plates).toEqual(["AAA111", "CCC333"]);
    // Every repeated answer names its instance; the plain question names none.
    for (const answer of answers.filter((entry) => entry.questionId === "q_rf_plate")) {
      expect(answer.instanceId).toMatch(/^ins_/);
    }
    expect(
      answers.find((answer) => answer.questionId === "q_rf_fleet_ref")?.instanceId,
    ).toBeUndefined();

    // The ledger kept all three, including the removed instance's: a removal is an
    // appended row and never a delete (I6, ADR-42), so the audit trail holds what the
    // respondent did while the submission holds what they meant.
    const ledger = await db.instanceAnswerRows(sessionId);
    expect(ledger.filter((row) => row.questionId === "q_rf_plate")).toHaveLength(3);
    const roster = await db.rosterRows(sessionId);
    expect(roster.filter((row) => row.event === "added")).toHaveLength(3);
    expect(roster.filter((row) => row.event === "removed")).toHaveLength(1);
  } finally {
    await db.close();
  }
});

test("case 33: adding announces through a polite status region, as a sentence", async ({
  page,
}) => {
  await startRepeatFlow(page);
  const status = page.locator('[role="status"]');
  await expect(status).toHaveAttribute("aria-live", "polite");

  await rosterPress(page, ADD);
  // A whole sentence and never a changing number: 4.1.3's own Understanding warns that
  // updating only the digit in "3 items" can announce just "three".
  await expect(status).toHaveText("Vehicle 2 added.");

  await rosterPress(page, removeName(2));
  await expect(status).toHaveText("Vehicle 2 removed, 1 remaining.");
});

test("case 32: focus lands on the instance that took the removed one's place", async ({ page }) => {
  await startRepeatFlow(page);
  await rosterPress(page, ADD);
  await rosterPress(page, ADD);
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(3);

  const third = await card(page, 3).getAttribute("data-qcms-instance");
  await rosterPress(page, removeName(2));
  // APG names this destination in terms for a destructive operation on a list: the item
  // following the deleted one, so a screen reader confirms the deletion by reading what
  // is now in that position. It is the instance that WAS third, renumbered to 2.
  await expect(page.locator(":focus")).toHaveAttribute("id", third!);
  await expect(page.locator(":focus")).toHaveText("Vehicle 2");
});

test("case 32: focus falls back to the previous instance when the last is removed", async ({
  page,
}) => {
  await startRepeatFlow(page);
  await rosterPress(page, ADD);
  const first = await card(page, 1).getAttribute("data-qcms-instance");
  await rosterPress(page, removeName(2));
  // Nothing took its place, so the previous instance's heading is the destination. This
  // and the only-instance case are this design's reading of APG's reasoning rather than
  // its words, which is recorded in ADR-43.
  await expect(page.locator(":focus")).toHaveAttribute("id", first!);
});

test("case 32: focus lands on the new instance's heading after an add", async ({ page }) => {
  await startRepeatFlow(page);
  await rosterPress(page, ADD);
  const second = await card(page, 2).getAttribute("data-qcms-instance");
  await expect(page.locator(":focus")).toHaveAttribute("id", second!);
  await expect(page.locator(":focus")).toHaveText("Vehicle 2");
});

test("case 31: a summary entry names the instance and anchors at its field", async ({ page }) => {
  await startRepeatFlow(page);
  await rosterPress(page, ADD);
  // Vehicle 1's plate is filled and Vehicle 2's is not, so the blocked Continue reports
  // exactly one gap and it has to say WHICH vehicle.
  await page.getByLabel("Fleet reference").fill("NORTH-1");
  await page.getByLabel("Fleet reference").blur();
  await fillPlate(page, 1, "AAA111");

  const second = await card(page, 2).getAttribute("data-qcms-instance");
  await page.getByTestId("primary-action").click();
  const summary = page.getByTestId("error-summary");
  await expect(summary).toBeVisible();
  // "Vehicle 2: Registration plate needs an answer." Three identical sentences on a
  // three-vehicle step would name no field at all, which is the WCAG 3.3.1 distinctness
  // problem issue #326 solved once for label-less questions.
  const entry = summary.getByRole("link", { name: /^Vehicle 2: Registration plate/ });
  await expect(entry).toBeVisible();

  await entry.click();
  // The anchor is the QUALIFIED field id, so it lands in that instance's card and in no
  // other. Focus is inside the field wrapper the renderer keyed by the same string.
  await expect(card(page, 2).getByLabel("Registration plate")).toBeFocused();
  await expect(page.locator(`[data-qcms-field="${second!}/q_rf_plate"]`)).toBeVisible();
});

test("case 38: longText and multiChoice are answerable inside a group", async ({ page }) => {
  const sessionId = await startRepeatFlow(page);
  await page.getByLabel("Fleet reference").fill("NORTH-1");
  await page.getByLabel("Fleet reference").blur();
  await fillPlate(page, 1, "AAA111");

  // The two types the table presentation refuses (Q12's deliberate asymmetry): a stacked
  // card gives each a full row, so neither is cramped and both are ordinary answers.
  const notes = card(page, 1).getByLabel("Anything else about this vehicle?");
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/answers$/.test(new URL(response.url()).pathname) &&
      response.status() === 200,
  );
  await notes.fill("Kerbed wheel, cosmetic only.");
  await notes.blur();
  await posted;

  const grouped = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/answers$/.test(new URL(response.url()).pathname) &&
      response.status() === 200,
  );
  await card(page, 1).getByText("Roof rack").click();
  // multiChoice commits when focus leaves the group (ADR-31), and the qualified name is
  // what the commit-moment table is keyed by, so this proves the table saw the
  // expansion rather than falling back to the default moment.
  await page.getByLabel("Fleet reference").focus();
  await grouped;

  const db = await openDb(databaseUrl);
  try {
    const rows = (await db.instanceAnswerRows(sessionId)).filter((row) =>
      ["q_rf_notes", "q_rf_extras"].includes(row.questionId),
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.instanceId).toMatch(/^ins_/);
    }
    expect(rows.find((row) => row.questionId === "q_rf_extras")?.value).toEqual(["opt_roof_rack"]);
  } finally {
    await db.close();
  }
});

test("case 37: one input per row, with no two controls sharing a horizontal band", async ({
  page,
}) => {
  await startRepeatFlow(page);
  await rosterPress(page, ADD);

  // The ruling is one input per row at EVERY width (Q12), so the geometry is asserted
  // rather than the stylesheet. Every control in a card starts at the card's content
  // edge and no two overlap vertically: a side-by-side pair would share a band.
  const boxes = await page.evaluate(() => {
    const column = document.querySelector<HTMLElement>(".qcms-repeat__fields");
    if (column === null) return [];
    return [...column.querySelectorAll<HTMLElement>("[data-qcms-field]")].map((field) => {
      // `display: contents` wrappers have no box of their own, so measure what they
      // render: the first element child that does.
      const box = (field.firstElementChild ?? field).getBoundingClientRect();
      return {
        left: Math.round(box.left),
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
      };
    });
  });
  expect(boxes.length).toBe(4);
  const lefts = new Set(boxes.map((box) => box.left));
  expect(lefts.size, "every control starts at the card's content edge").toBe(1);
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  for (let i = 1; i < sorted.length; i += 1) {
    expect(
      sorted[i]!.top,
      "no control starts above the one before it ends: that is a shared band",
    ).toBeGreaterThanOrEqual(sorted[i - 1]!.bottom);
  }
  // And no horizontal page scroll, at whatever width this project runs.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
