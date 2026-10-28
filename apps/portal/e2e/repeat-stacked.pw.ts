import { expect, test } from "./support/gates.js";
import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";

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
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();
  await waitForHydration(page);
  return new URL(page.url()).pathname.split("/")[2]!;
}

function answerPosted(page: import("@playwright/test").Page, questionId: string): Promise<unknown> {
  return page.waitForResponse((response) => {
    if (response.request().method() !== "POST" || response.status() !== 200) return false;
    if (!/\/answers$/.test(new URL(response.url()).pathname)) return false;
    const body = response.request().postDataJSON() as { questionId?: unknown } | null;
    const posted = typeof body?.questionId === "string" ? body.questionId : "";
    return posted === questionId || posted.endsWith(`/${questionId}`);
  });
}

/** Type into one instance's plate field and wait for the answer to be recorded. */
async function fillPlate(
  page: import("@playwright/test").Page,
  ordinal: number,
  value: string,
): Promise<void> {
  const posted = answerPosted(page, "q_rf_plate");
  await card(page, ordinal).getByLabel("Registration plate").fill(value);
  await card(page, ordinal).getByLabel("Registration plate").blur();
  await posted;
}

/** Press Add or Remove and wait for the roster write the API answers. */
async function rosterPress(page: import("@playwright/test").Page, name: string): Promise<void> {
  const written = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && /\/roster$/.test(new URL(response.url()).pathname),
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

  await rosterPress(page, ADD);
  await expect(page.getByRole("heading", { name: "Vehicle 2" })).toBeVisible();
  await fillPlate(page, 2, "BBB222");
  await rosterPress(page, ADD);
  await fillPlate(page, 3, "CCC333");
  await expect(page.getByRole("button", { name: ADD })).toBeDisabled();

  await rosterPress(page, removeName(2));
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(2);
  await expect(card(page, 2).getByLabel("Registration plate")).toHaveValue("CCC333");

  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);

  const db = await openDb(databaseUrl);
  try {
    const answers = await db.lockedAnswers(sessionId);
    const plates = answers
      .filter((answer) => answer.questionId === "q_rf_plate")
      .map((answer) => answer.value);
    expect(plates).toEqual(["AAA111", "CCC333"]);
    for (const answer of answers.filter((entry) => entry.questionId === "q_rf_plate")) {
      expect(answer.instanceId).toMatch(/^ins_/);
    }
    expect(
      answers.find((answer) => answer.questionId === "q_rf_fleet_ref")?.instanceId,
    ).toBeUndefined();

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
  await page.getByLabel("Fleet reference").fill("NORTH-1");
  await page.getByLabel("Fleet reference").blur();
  await fillPlate(page, 1, "AAA111");

  const second = await card(page, 2).getAttribute("data-qcms-instance");
  await page.getByTestId("primary-action").click();
  const summary = page.getByTestId("error-summary");
  await expect(summary).toBeVisible();
  const entry = summary.getByRole("link", { name: /^Vehicle 2: Registration plate/ });
  await expect(entry).toBeVisible();

  await entry.click();
  await expect(card(page, 2).getByLabel("Registration plate")).toBeFocused();
  await expect(page.locator(`[data-qcms-field="${second!}/q_rf_plate"]`)).toBeVisible();
});

test("case 38: longText and multiChoice are answerable inside a group", async ({ page }) => {
  const sessionId = await startRepeatFlow(page);
  await page.getByLabel("Fleet reference").fill("NORTH-1");
  const fleetPosted = answerPosted(page, "q_rf_fleet_ref");
  await page.getByLabel("Fleet reference").blur();
  await fleetPosted;
  await fillPlate(page, 1, "AAA111");

  const notes = card(page, 1).getByLabel("Anything else about this vehicle?");
  const posted = answerPosted(page, "q_rf_notes");
  await notes.fill("Kerbed wheel, cosmetic only.");
  await notes.blur();
  await posted;

  const grouped = answerPosted(page, "q_rf_extras");
  await card(page, 1).getByText("Roof rack", { exact: true }).click();
  const roofRack = card(page, 1).getByRole("checkbox", { name: "Roof rack", exact: true });
  await expect(roofRack).toBeChecked();
  await roofRack.focus();
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

  const boxes = await page.evaluate(() => {
    const column = document.querySelector<HTMLElement>(".qcms-repeat__fields");
    if (column === null) return [];
    return [...column.querySelectorAll<HTMLElement>("[data-qcms-field]")].map((field) => {
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
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
