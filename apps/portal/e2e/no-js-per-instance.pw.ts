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
    await expect(card(page)).toHaveCount(1);
    await expect(page.getByTestId("progress")).toHaveText(
      `Step ${String(ordinal)} of 3: Vehicle ${String(ordinal)}`,
    );
    await expect(page.getByRole("heading", { name: `Vehicle ${String(ordinal)}` })).toBeVisible();

    await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
    await expect(stepSubmit(page)).toHaveCount(1);

    await expect(page.getByRole("button", { name: ADD })).toHaveCount(ordinal === 3 ? 1 : 0);

    await card(page).getByLabel("Registration plate").fill(plate);
    await expect(page.getByTestId("progress")).toHaveText(
      `Step ${String(ordinal)} of 3: Vehicle ${String(ordinal)}`,
    );

    if (ordinal < 3) {
      await submitStep(page);
      continue;
    }
    const served = page.waitForResponse(
      (response) => response.request().isNavigationRequest() && response.status() === 200,
    );
    await stepSubmit(page).click();
    await served;
    await expect(page).toHaveURL(/\/done$/);
  }

  const db = await openDb(databaseUrl);
  try {
    const rows = (await db.instanceAnswerRows(sessionId)).filter(
      (row) => row.questionId === "q_pi_plate",
    );
    expect(rows.map((row) => row.value)).toEqual(["AAA111", "BBB222", "CCC333"]);
    expect(new Set(rows.map((row) => row.instanceId)).size).toBe(3);
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
  await startTour(page);
  await page.getByLabel("Depot name").fill("Northern depot");
  await card(page).getByLabel("Registration plate").fill("AAA111");
  await submitStep(page);
  await expect(page.getByLabel("Depot name")).toHaveValue("Northern depot");

  for (let round = 0; round < 3; round += 1) {
    const served = page.waitForResponse(
      (response) => response.request().isNavigationRequest() && response.status() === 200,
    );
    await page.locator('[data-qcms-repeat-action="remove"]').first().click();
    await served;
  }
  await expect(card(page)).toHaveCount(0);

  await submitStep(page);
  await expect(page.getByTestId("step-notice")).toBeVisible();
  await expect(page.getByTestId("step-notice")).toHaveText(
    "One of the repeated sections does not have enough entries to submit. Add the entries it needs and try again.",
  );
  await expect(page).not.toHaveURL(/\/done$/);
});

test("the Add on the last view grows the group and the walk gains a view", async ({ page }) => {
  await startTour(page);
  for (const plate of ["AAA111", "BBB222"]) {
    await card(page).getByLabel("Registration plate").fill(plate);
    await submitStep(page);
  }
  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 3: Vehicle 3");

  await card(page).getByLabel("Registration plate").fill("CCC333");
  await rosterPress(page, ADD);

  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 4: Vehicle 3");
  await expect(card(page).getByLabel("Registration plate")).toHaveValue("CCC333");
  await expect(page.getByRole("button", { name: ADD })).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe("");

  await submitStep(page);
  await expect(page.getByTestId("progress")).toHaveText("Step 4 of 4: Vehicle 4");
  await expect(page.getByRole("button", { name: ADD })).toHaveCount(1);
  await expect(page.getByRole("button", { name: ADD })).toBeDisabled();
});
