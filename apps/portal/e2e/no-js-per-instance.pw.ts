import { expect, test } from "./support/gates.js";
import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { stepSubmit, submitStep } from "./support/no-js.js";

/**
 * The **per-instance step presentation without scripting** (task 076, ADR-28 as amended
 * 2026-08-31 and 2026-09-29, ADR-43).
 *
 * The fixture is `repeat-tour`: one step, one `open` group at `min: 3, max: 4`,
 * `presentation: "perInstanceStep"`, with a required plate and an optional odometer per
 * instance. The first serve mints three instances, so the step is three views.
 *
 * ## Why this path is a different design and not the same one with a feature missing
 *
 * ADR-28's amendment of 2026-08-31 says the no-JS fallback is a **single
 * readiness-labelled button with no Back control**, which is the accepted shape by design
 * (task 044) rather than a shortfall: without script there is no per-step validation round
 * trip to gate a Continue on. So "Back and Continue traverse the views" cannot be a claim
 * about both paths, and what this path does instead is ruled:
 *
 * - the server serves **the first view whose instance is incomplete**, confirmed by the
 *   Code Owner on 2026-09-29, so each press of the one button moves one vehicle forward;
 * - there is **no Back**, and an earlier instance is reached through the review step
 *   rather than through a control this task adds;
 * - the group's **Add control is on the last view**, so an open-ended group can still
 *   grow. It is the same `__qop` named submit button on the same form, posting to 073's
 *   Server Action, which re-renders in its own 200 and lands focus by `autofocus` rather
 *   than by a fragment (Q28, ruled 2026-10-01).
 *
 * Exit criteria proved here: **3** (the walk completes through all three views with one
 * button and no Back, and the Add control is on the last view) and the no-JS half of
 * **2** (answering never moves the page by itself - without scripting nothing moves until
 * the button is pressed, which is the property stated from the other side).
 */

test.use({ javaScriptEnabled: false });

const { repeatTourSlug, databaseUrl } = readFixtures();

const ADD = "Add Vehicle";

/** The one instance card this view draws. */
function card(page: import("@playwright/test").Page) {
  return page.locator("fieldset[data-qcms-instance]");
}

/** Start the flow without scripting and land on the first view. */
async function startTour(page: import("@playwright/test").Page): Promise<string> {
  await page.goto(`/f/${repeatTourSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2]!;
}

/**
 * Press a `__qop` button and wait for the page the **200** carries back.
 *
 * The same shape `no-js-repeat.pw.ts` uses and for the same reasons: a native submission
 * the browser refused looks exactly like one that submitted and changed nothing, and the
 * first `__qop` post of a run pays for the dev server compiling the Server Action route.
 */
async function rosterPress(page: import("@playwright/test").Page, name: string): Promise<void> {
  const served = page.waitForResponse((response) => response.request().isNavigationRequest(), {
    timeout: 120_000,
  });
  await page.getByRole("button", { name }).click();
  expect((await served).status(), `the ${name} post's own response`).toBe(200);
}

test("the walk completes through all three views with one button and no Back", async ({ page }) => {
  const sessionId = await startTour(page);

  for (const [index, plate] of ["AAA111", "BBB222", "CCC333"].entries()) {
    const ordinal = index + 1;
    // One view, one instance card, and the chrome names which vehicle it is: the
    // indicator counts views, so three instances read "of 3".
    await expect(card(page)).toHaveCount(1);
    await expect(page.getByTestId("progress")).toHaveText(
      `Step ${String(ordinal)} of 3: Vehicle ${String(ordinal)}`,
    );
    await expect(page.getByRole("heading", { name: `Vehicle ${String(ordinal)}` })).toBeVisible();

    // **No Back control, on any view.** That is ADR-28's amendment and not an omission,
    // so it is asserted rather than assumed: a Back here would be a control this task was
    // told not to add.
    await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
    // Exactly one control posts the step, whatever the group's own buttons do.
    await expect(stepSubmit(page)).toHaveCount(1);

    // The Add control is on the LAST view and on neither earlier one.
    await expect(page.getByRole("button", { name: ADD })).toHaveCount(ordinal === 3 ? 1 : 0);

    await card(page).getByLabel("Registration plate").fill(plate);
    // Nothing has moved: without scripting there is no post until the button is pressed,
    // which is the no-JS half of "answering never moves the rendered page by itself".
    await expect(page.getByTestId("progress")).toHaveText(
      `Step ${String(ordinal)} of 3: Vehicle ${String(ordinal)}`,
    );

    if (ordinal < 3) {
      await submitStep(page);
      // The server chose the next page, because the respondent has no control that could:
      // the first view whose instance is incomplete is the one after this.
      continue;
    }
    // The last required answer completes the flow, so this press submits the session.
    const served = page.waitForResponse(
      (response) => response.request().isNavigationRequest() && response.status() === 200,
    );
    await stepSubmit(page).click();
    await served;
    await expect(page).toHaveURL(/\/done$/);
  }

  // Every instance's answer is in the ledger under its own instance id, which is what a
  // walk through three views was for.
  const db = await openDb(databaseUrl);
  try {
    const rows = (await db.instanceAnswerRows(sessionId)).filter(
      (row) => row.questionId === "q_pi_plate",
    );
    expect(rows.map((row) => row.value)).toEqual(["AAA111", "BBB222", "CCC333"]);
    // Three different instances, which is what the walk was for: the same question
    // answered three times under three ids rather than three times over itself.
    expect(new Set(rows.map((row) => row.instanceId)).size).toBe(3);
    // And the sealed set carries all three, each qualified by its own instance.
    const locked = (await db.lockedAnswers(sessionId)).filter(
      (answer) => answer.questionId === "q_pi_plate",
    );
    expect(locked.map((answer) => answer.value)).toEqual(["AAA111", "BBB222", "CCC333"]);
    expect(new Set(locked.map((answer) => answer.instanceId)).size).toBe(3);
  } finally {
    await db.close();
  }
});

test("a submit refused for the group's count carries a notice, without scripting", async ({
  page,
}) => {
  // The same refusal on the path with no rapid feedback at all (`REPEAT_COUNT_OUT_OF_RANGE`,
  // ADR-42). Without the notice the press returned the same step and said nothing, which on
  // this path reaches the respondent least equipped for it.
  await startTour(page);
  // One answer first, for the same reason as the hydrated case: a session with no answers
  // at all is refused earlier and differently (`NOTHING_TO_SUBMIT`).
  //
  // The plate is filled with it, and that is the browser rather than a choice: the plate
  // carries HTML `required`, so a Continue with it empty never leaves the page - which is
  // the 2026-09-13 ruling working. What survives the removals is the DEPOT answer, since a
  // removed instance's answers are excluded (I6), and that is what gets the session past
  // `NOTHING_TO_SUBMIT` to the sweep.
  await page.getByLabel("Depot name").fill("Northern depot");
  await card(page).getByLabel("Registration plate").fill("AAA111");
  await submitStep(page);
  await expect(page.getByLabel("Depot name")).toHaveValue("Northern depot");

  // Label-agnostic, because each removal renumbers the ordinal the drawn instance reads.
  for (const round of [1, 2, 3]) {
    const served = page.waitForResponse(
      (response) => response.request().isNavigationRequest() && response.status() === 200,
    );
    await page.locator('[data-qcms-repeat-action="remove"]').first().click();
    await served;
    void round;
  }
  await expect(card(page)).toHaveCount(0);

  // Nothing required is left, so this press reaches the submit rather than the step route's
  // own missing-required report.
  await submitStep(page);
  await expect(page.getByTestId("step-notice")).toBeVisible();
  await expect(page.getByTestId("step-notice")).toHaveText(
    "One of the repeated sections does not have enough entries to submit. Add the entries it needs and try again.",
  );
  await expect(page).not.toHaveURL(/\/done$/);
});

test("the Add on the last view grows the group and the walk gains a view", async ({ page }) => {
  await startTour(page);
  // Walk to the last view, which is where the Add control is.
  for (const plate of ["AAA111", "BBB222"]) {
    await card(page).getByLabel("Registration plate").fill(plate);
    await submitStep(page);
  }
  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 3: Vehicle 3");

  // The Add rides 073's Server Action: the same `__qop` button, the same form, and a 200
  // re-render carrying the typed values back (Q28). **It lands no `autofocus`**, and that
  // is deliberate for a paginating group (Q31, ruled 2026-10-03): the new instance is a
  // view one page further along, so the heading Q11 names is not in this document, and
  // nothing on this page changed for focus to move to.
  await card(page).getByLabel("Registration plate").fill("CCC333");
  await rosterPress(page, ADD);

  // Four instances, four views, and the re-render is the view the respondent was on: the
  // list grew at its end, so nothing they had already walked moved.
  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 4: Vehicle 3");
  await expect(card(page).getByLabel("Registration plate")).toHaveValue("CCC333");
  // This page is no longer the end of the walk, so the Add control is not on it either.
  await expect(page.getByRole("button", { name: ADD })).toHaveCount(0);
  // And no URL fragment, which is the half of Q28 that is a prohibition: `autofocus` and
  // a fragment target are mutually exclusive, so a page carrying both lands nowhere.
  expect(new URL(page.url()).hash).toBe("");

  await submitStep(page);
  await expect(page.getByTestId("progress")).toHaveText("Step 4 of 4: Vehicle 4");
  await expect(page.getByRole("button", { name: ADD })).toHaveCount(1);
  // `max: 4`: the group is full, so the control is disabled rather than absent.
  await expect(page.getByRole("button", { name: ADD })).toBeDisabled();
});
