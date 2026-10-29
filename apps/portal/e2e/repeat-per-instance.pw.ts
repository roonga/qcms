import { expect, test } from "./support/gates.js";
import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";

const { repeatTourSlug } = readFixtures();

/** The one instance card this view draws. */
function card(page: import("@playwright/test").Page) {
  return page.locator("fieldset[data-qcms-instance]");
}

function odometer(page: import("@playwright/test").Page) {
  return card(page).getByRole("textbox", { name: "Odometer reading" });
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

  await expect(page.getByTestId("progress")).toHaveText("Step 1 of 3: Vehicle 1");
  await expect(card(page)).toHaveCount(1);
  await expect(page.getByTestId("back-action")).toHaveCount(0);
  await expect(page.getByTestId("primary-action")).toHaveText("Continue");
  await expect(page.getByLabel("Depot name")).toBeVisible();
  await expect(card(page).getByLabel("Depot name")).toHaveCount(0);

  await fillPlate(page, "AAA111");
  await expect(page.getByTestId("progress")).toHaveText("Step 1 of 3: Vehicle 1");
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();

  await navigate(page, "primary-action");
  await expect(page.getByTestId("progress")).toHaveText("Step 2 of 3: Vehicle 2");
  await expect(page.getByRole("heading", { name: "Vehicle 2" })).toBeVisible();
  await expect(page.getByLabel("Depot name")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toHaveCount(0);
  await expect(card(page).getByLabel("Registration plate")).toHaveValue("");
  await expect(page.getByTestId("back-action")).toBeVisible();
  await expect(page.getByTestId("primary-action")).toHaveText("Continue");

  await fillPlate(page, "BBB222");
  await navigate(page, "primary-action");

  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 3: Vehicle 3");
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toBeVisible();

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

  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 4: Vehicle 3");
  await expect(page.getByTestId("primary-action")).toHaveText("Continue");
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toHaveCount(0);

  await navigate(page, "primary-action");
  await expect(page.getByTestId("progress")).toHaveText("Step 4 of 4: Vehicle 4");
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toBeDisabled();
});

test("a member hidden in this instance is not rendered on the hydrated path (#1041)", async ({
  page,
}) => {
  await startTour(page);

  await expect(odometer(page)).toHaveCount(0);
  await fillPlate(page, "AAA111");
  await expect(odometer(page)).toBeVisible();

  await navigate(page, "primary-action");
  await expect(page.getByRole("heading", { name: "Vehicle 2" })).toBeVisible();
  await fillPlate(page, "BBB222");
  await expect(odometer(page)).toHaveCount(0);

  await navigate(page, "back-action");
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();
  await expect(odometer(page)).toBeVisible();
});

test("the move between views is announced once, by the indicator and not twice", async ({
  page,
}) => {
  await startTour(page);
  const announcer = page.getByTestId("flow-announcer");
  await fillPlate(page, "AAA111");
  await navigate(page, "primary-action");

  await expect(page.getByTestId("progress")).toHaveText("Step 2 of 3: Vehicle 2");
  await expect(announcer).toHaveText("");

  await fillPlate(page, "BBB222");
  await navigate(page, "primary-action");
  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 3: Vehicle 3");
  await expect(announcer).toHaveText("");
  await fillPlate(page, "CCC333");
  await expect(announcer).toHaveText("You have answered everything. You can now submit.");
});

test("the first Add to an emptied paginated group lands focus on the new instance", async ({
  page,
}) => {
  await startTour(page);
  for (const round of [1, 2, 3]) {
    const removed = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/roster"),
    );
    await page.getByRole("button", { name: "Remove Vehicle 1" }).click();
    expect((await removed).status(), `removal ${String(round)}`).toBe(200);
  }
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(0);
  await expect(page.getByTestId("progress")).toHaveText("Step 1 of 1");
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toBeEnabled();

  const added = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/roster"),
  );
  await page.getByRole("button", { name: "Add Vehicle" }).click();
  expect((await added).status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeFocused();
});

test("a submit refused for the group's count says so instead of nothing", async ({
  page,
  browserGuard,
}) => {
  browserGuard.expectRequestFailure({ status: 422, url: /\/submit$/ });
  await startTour(page);
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/answers"),
  );
  await page.getByLabel("Depot name").fill("Northern depot");
  await page.getByLabel("Depot name").blur();
  await posted;

  for (const round of [1, 2, 3]) {
    const removed = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/roster"),
    );
    await page.locator('[data-qcms-repeat-action="remove"]').first().click();
    expect((await removed).status(), `removal ${String(round)}`).toBe(200);
  }
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(0);
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");

  const refused = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/submit"),
  );
  await page.getByTestId("primary-action").click();
  expect((await refused).status()).toBe(422);

  await expect(page.getByTestId("count-refusal")).toBeVisible();
  await expect(page.getByTestId("count-refusal")).toHaveText(
    "One of the repeated sections does not have enough entries to submit. Add the entries it needs and try again.",
  );
  await expect(page).not.toHaveURL(/\/done$/);
  await expect(page.getByTestId("count-refusal")).toBeInViewport();

  const added = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/roster"),
  );
  await page.getByRole("button", { name: "Add Vehicle" }).click();
  expect((await added).status()).toBe(200);
  await expect(page.getByTestId("count-refusal")).toHaveCount(0);
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

  await expect(page.getByRole("heading", { name: "Vehicle 3" })).toBeVisible();
  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 4: Vehicle 3");
  await expect(page.locator(".qcms-repeat__status")).toHaveText("Vehicle 4 added.");
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(1);

  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && /\/roster$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "Remove Vehicle 3" }).click();
  expect((await removed).status()).toBe(200);
  await expect(page.getByTestId("progress")).toHaveText("Step 3 of 3: Vehicle 3");
  await expect(page.getByRole("heading", { name: "Vehicle 3" })).toBeVisible();
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toBeEnabled();
});
