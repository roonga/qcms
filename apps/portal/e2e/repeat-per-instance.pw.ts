import { expect, test } from "./support/gates.js";
import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";

/**
 * The **per-instance step presentation** on the scripted path (task 076, ADR-28 as
 * amended 2026-09-29, ADR-42, ADR-43).
 *
 * The fixture is `repeat-tour`
 * (`apps/api/e2e/support/fixtures/repeat-tour-form.json`): one step, one `open` group at
 * `min: 3, max: 4`, `presentation: "perInstanceStep"`, whose members are a required
 * shortText and an optional number. `min: 3` means the first serve mints three instances,
 * so the step is three **views** before the respondent has done anything, which is this
 * task's exit criterion written as a fixture rather than as a sequence of clicks.
 *
 * Exit criteria proved here: **1** (three views, the indicator says three, Back and
 * Continue traverse them in roster order), **2** (answering never moves the page by
 * itself, on this path), and **5** (Submit appears on the last view and nowhere earlier,
 * with that last view belonging to an instance rather than to a plain step).
 *
 * The no-JS half of the same fixture is `no-js-per-instance.pw.ts`.
 */

const { repeatTourSlug } = readFixtures();

/** The one instance card this view draws. */
function card(page: import("@playwright/test").Page) {
  return page.locator("fieldset[data-qcms-instance]");
}

async function startTour(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(`/f/${repeatTourSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();
  await waitForHydration(page);
}

/** Press Continue or Back and wait for the step read the cursor move makes. */
async function navigate(page: import("@playwright/test").Page, name: string): Promise<void> {
  // Waits for the read and then asserts its status, so a refusal fails with a status
  // rather than as a bare timeout on a heading that never changed. The cursor move is a
  // GET of the step route with the index the portal wants drawn.
  const read = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname.endsWith("/step"),
  );
  await page.getByTestId(name).click();
  const response = await read;
  expect(response.status(), `the ${name} step read`).toBe(200);
}

/** Fill this view's required plate and wait for the answer the blur posts (ADR-31). */
async function fillPlate(page: import("@playwright/test").Page, value: string): Promise<void> {
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/answers"),
  );
  await card(page).getByLabel("Registration plate").fill(value);
  await card(page).getByLabel("Registration plate").blur();
  await posted;
}

test("three live instances are three views, in roster order, with one Submit at the end", async ({
  page,
}) => {
  await startTour(page);

  // Exit criterion 1, the counting half: the indicator counts VIEWS, so one step holding
  // three live instances reads "of 3" and not "of 1".
  await expect(page.getByTestId("progress")).toHaveText("Step 1 of 3: Vehicle 1");
  await expect(card(page)).toHaveCount(1);
  // Back is hidden on the first view exactly as it is on the first step (042's screen
  // contract), which is the cursor behaving identically whatever a view happens to be.
  await expect(page.getByTestId("back-action")).toHaveCount(0);
  // Exit criterion 5: not Submit yet, on either of the first two views.
  await expect(page.getByTestId("primary-action")).toHaveText("Continue");

  // Each instance's own required field, filled on its own page.
  await fillPlate(page, "AAA111");
  // Exit criterion 2: answering moved nothing. Still view 1, still Vehicle 1.
  await expect(page.getByTestId("progress")).toHaveText("Step 1 of 3: Vehicle 1");
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();

  await navigate(page, "primary-action");
  await expect(page.getByTestId("progress")).toHaveText("Step 2 of 3: Vehicle 2");
  await expect(page.getByRole("heading", { name: "Vehicle 2" })).toBeVisible();
  // Roster order: Vehicle 1 is not on this page at all, and Vehicle 2's plate is empty
  // rather than carrying Vehicle 1's answer.
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toHaveCount(0);
  await expect(card(page).getByLabel("Registration plate")).toHaveValue("");
  // Back exists from the second view on, and this is still not the last one.
  await expect(page.getByTestId("back-action")).toBeVisible();
  await expect(page.getByTestId("primary-action")).toHaveText("Continue");

  await fillPlate(page, "BBB222");
  await navigate(page, "primary-action");

  // The last view, and it belongs to an INSTANCE rather than to a plain step, which is
  // the part of exit criterion 5 that could have been missed by counting steps.
  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 3: Vehicle 3");
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  // And the group's Add control is on this view and was on neither earlier one.
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toBeVisible();

  // Back traverses the views in roster order, one view at a time.
  await navigate(page, "back-action");
  await expect(page.getByTestId("progress")).toHaveText("Step 2 of 3: Vehicle 2");
  await expect(card(page).getByLabel("Registration plate")).toHaveValue("BBB222");
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toHaveCount(0);
  await navigate(page, "back-action");
  await expect(page.getByTestId("progress")).toHaveText("Step 1 of 3: Vehicle 1");
  await expect(card(page).getByLabel("Registration plate")).toHaveValue("AAA111");
  await expect(page.getByTestId("back-action")).toHaveCount(0);
});

test("the Add control is on the last view and growing the group appends a view", async ({
  page,
}) => {
  await startTour(page);
  // Continue gates on THIS VIEW's required questions, so each vehicle's plate is filled
  // on its own page before the cursor moves (ADR-28: Continue advances only after the
  // current page validates).
  await fillPlate(page, "AAA111");
  await navigate(page, "primary-action");
  await fillPlate(page, "BBB222");
  await navigate(page, "primary-action");
  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 3: Vehicle 3");
  await fillPlate(page, "CCC333");

  const written = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && /\/roster$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "Add Vehicle" }).click();
  expect((await written).status(), "POST /roster for Add Vehicle").toBe(200);

  // Four instances, four views, and the respondent is still standing on view 3: growing
  // the roster APPENDS to the view list, so no page they already walked is renumbered.
  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 4: Vehicle 3");
  await expect(page.getByTestId("primary-action")).toHaveText("Continue");
  // The Add control moved with the end of the walk, and this page is no longer the end.
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toHaveCount(0);

  await navigate(page, "primary-action");
  await expect(page.getByTestId("progress")).toHaveText("Step 4 of 4: Vehicle 4");
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toBeVisible();
  // `max: 4`, so the group is full and the control says so rather than disappearing.
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toBeDisabled();
});

test("an Add announces without moving the page, and a removal clamps onto Q11's destination", async ({
  page,
}) => {
  await startTour(page);
  await fillPlate(page, "AAA111");
  await navigate(page, "primary-action");
  await fillPlate(page, "BBB222");
  await navigate(page, "primary-action");
  await fillPlate(page, "CCC333");

  const written = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && /\/roster$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "Add Vehicle" }).click();
  expect((await written).status()).toBe(200);

  // **The page did not move**, which is ADR-28 and not an omission: Continue, Back and
  // Submit are the only things that move it, and an Add is not one of them. So the
  // respondent stays on Vehicle 3 and the indicator tells them a fourth exists.
  await expect(page.getByRole("heading", { name: "Vehicle 3" })).toBeVisible();
  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 4: Vehicle 3");
  // Q11's announcement half is intact and is what tells them the press worked, since the
  // new instance's own heading is a page further along and cannot be focused from here.
  await expect(page.locator(".qcms-repeat__status")).toHaveText("Vehicle 4 added.");
  // And the new instance's heading is genuinely not in this document, so nothing could
  // have landed on it.
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(1);

  // A removal needs no focus policy of its own here: the view list shrinks, the API
  // clamps the committed cursor into it, and Q11's destinations fall out of that
  // arithmetic. Removing the instance this view draws leaves the index naming the one
  // that took its position, which is Q11's first destination in terms.
  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && /\/roster$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "Remove Vehicle 3" }).click();
  expect((await removed).status()).toBe(200);
  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 3: Vehicle 3");
  // The ordinals renumbered, so what was Vehicle 4 is now Vehicle 3 and is the page the
  // respondent is standing on.
  await expect(page.getByRole("heading", { name: "Vehicle 3" })).toBeVisible();
  // Three views again, and this is the last of them, so Submit is back on it.
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toBeEnabled();
});
