import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addOption, confirmLifecycle, createDraft, useRowMenu } from "./support/questions.js";
import {
  addStep,
  createForm,
  openStep,
  pickerChoice,
  pickerCommit,
  pinGrip,
  pinLabel,
  pinQuestion,
  pinRowMenuItem,
  pinVersionTrigger,
  pinnedOrder,
  savedStamp,
  usePinRowMenu,
  waitForSaveAfter,
} from "./support/forms.js";

// Serial tests mutate one shared form; wait for each final edit before the next test navigates.
// Keep two published versions for the version-pin test. The last unpin pauses autosave instead of saving.
// The 390px check covers the step screen; route-only reflow tests never open its pin grid.

const EMAIL = uniqueAdminEmail("pingrid");
const RUN = Date.now().toString(36).slice(-5);

const COVER = `pg-cover-${RUN}`;
const COUNT = `pg-count-${RUN}`;
const NOTES = `pg-notes-${RUN}`;
const EXTRA = `pg-extra-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

const COVER_ID = questionIdFor(COVER);
const COUNT_ID = questionIdFor(COUNT);
const NOTES_ID = questionIdFor(NOTES);
const EXTRA_ID = questionIdFor(EXTRA);

let totpSecret = "";

let builderPath = "";

async function openBuilder(page: Page): Promise<void> {
  await page.goto(builderPath);
  await openStep(page, "Driving history");
}

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("authors the library and the step the rest of this file edits", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await createDraft(page, COVER, "Single choice");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2$/);

  await addOption(page, "Full cover");
  await addOption(page, "Basic cover");
  await useRowMenu(page, 0, /^Remove option /);
  await useRowMenu(page, 0, /^Remove option /);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await confirmLifecycle(page, /^Publish version 2$/, "Publish");

  await createDraft(page, COUNT, "Number");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, NOTES, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, EXTRA, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await createForm(page, `pin-grid-${RUN}`, "Vehicle insurance");
  builderPath = new URL(page.url()).pathname;
  await addStep(page, "Driving history");
  await pinQuestion(page, COVER_ID, 1);
  await pinQuestion(page, COUNT_ID, 1);

  const beforeLastPin = await savedStamp(page);
  await pinQuestion(page, NOTES_ID, 1);
  await waitForSaveAfter(page, beforeLastPin);

  expect(await pinnedOrder(page)).toEqual([COVER_ID, COUNT_ID, NOTES_ID]);
});

test("the grip menu offers insert above, insert below, move up, move down and remove", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openBuilder(page);

  await pinGrip(page, COUNT_ID).click();
  const menu = page.getByRole("menu", { name: `Row actions for ${COUNT_ID}` });
  await expect(menu).toBeVisible();

  await expect(menu.getByRole("menuitem")).toHaveText([
    `Insert a question above ${COUNT_ID}`,
    `Insert a question below ${COUNT_ID}`,
    `Move ${COUNT_ID} up`,
    `Move ${COUNT_ID} down`,
    `Remove ${COUNT_ID}`,
  ]);

  await expect(
    menu.getByRole("menuitem", { name: `Insert a question above ${COUNT_ID}` }),
  ).toBeEnabled();
  await expect(
    menu.getByRole("menuitem", { name: `Insert a question below ${COUNT_ID}` }),
  ).toBeEnabled();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(pinGrip(page, COUNT_ID)).toBeFocused();
});

// The hairline insert target relies on equivalent menu controls under WCAG 2.5.8.
// Those controls must be keyboard reachable, including across disabled items.
test("the menu's arrow keys skip a disabled item on the first row of a step", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openBuilder(page);
  expect(await pinnedOrder(page)).toEqual([COVER_ID, COUNT_ID, NOTES_ID]);

  await pinGrip(page, COVER_ID).click();
  await expect(pinRowMenuItem(page, "moveUp")).toBeDisabled();
  await expect(pinRowMenuItem(page, "insertAbove")).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "insertBelow")).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "moveDown")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "remove")).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await expect(pinRowMenuItem(page, "moveDown")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(pinRowMenuItem(page, "insertBelow")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(pinRowMenuItem(page, "insertAbove")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(pinRowMenuItem(page, "remove")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "insertAbove")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(pinGrip(page, COVER_ID)).toBeFocused();
});

test("keyboard reorder still works, and the grip keeps focus across the move", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openBuilder(page);
  expect(await pinnedOrder(page)).toEqual([COVER_ID, COUNT_ID, NOTES_ID]);

  const grip = pinGrip(page, COVER_ID);
  await grip.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COUNT_ID, COVER_ID, NOTES_ID]);

  await expect(grip).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COUNT_ID, NOTES_ID, COVER_ID]);
  await expect(grip).toBeFocused();

  await usePinRowMenu(page, COVER_ID, "moveUp");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COUNT_ID, COVER_ID, NOTES_ID]);
  const beforeLastMove = await savedStamp(page);
  await usePinRowMenu(page, COVER_ID, "moveUp");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COVER_ID, COUNT_ID, NOTES_ID]);
  // Wait for the final move: that is the state the next test's navigation must read.
  await waitForSaveAfter(page, beforeLastMove);
});

test("insert below pins into the slot it named, not onto the end", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openBuilder(page);

  const beforeInsert = await savedStamp(page);
  await usePinRowMenu(page, COVER_ID, "insertBelow");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await pickerChoice(dialog, EXTRA_ID, 1).check();
  await pickerCommit(dialog, 1).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => pinnedOrder(page))
    .toEqual([COVER_ID, EXTRA_ID, COUNT_ID, NOTES_ID]);

  await waitForSaveAfter(page, beforeInsert);
});

test("remove takes the pin out and leaves focus on a neighbouring grip", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openBuilder(page);

  const beforeRemove = await savedStamp(page);
  await usePinRowMenu(page, EXTRA_ID, "remove");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COVER_ID, COUNT_ID, NOTES_ID]);

  await expect(pinGrip(page, COVER_ID)).toBeFocused();
  // Assert focus first: waiting for save visits the form screen and returns, changing focus.
  await waitForSaveAfter(page, beforeRemove);
});

// This fixture lacks version-state tags, rules and long content; it does not measure that richer grid at 320px.
test("the version pin is operable at 390, and the page never scrolls sideways", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.setViewportSize({ width: 390, height: 844 });
  await openBuilder(page);
  await expect(pinLabel(page, COVER_ID, 1)).toBeVisible();

  await expect(page.getByRole("columnheader", { name: "Type" })).toBeHidden();
  await expect(page.getByRole("columnheader", { name: "Issues" })).toBeHidden();
  await expect(page.getByRole("columnheader", { name: "Version" })).toBeVisible();

  const beforeVersionMove = await savedStamp(page);

  const trigger = pinVersionTrigger(page, COVER_ID, 1);
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole("menuitem", { name: "Move to v2", exact: true }).click();
  await expect(pinLabel(page, COVER_ID, 2)).toBeVisible();
  await waitForSaveAfter(page, beforeVersionMove);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, "the builder must not scroll horizontally at 390").toBeLessThanOrEqual(390);
});

test("on a single-pin step, Remove is still reachable with both moves disabled", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto(builderPath);
  // Capture the baseline before adding an empty step, which pauses autosave and can cancel the prior save.
  const beforeExtraPin = await savedStamp(page);
  await addStep(page, "Excess");
  await openStep(page, "Excess");
  await pinQuestion(page, EXTRA_ID, 1);
  await waitForSaveAfter(page, beforeExtraPin);
  expect(await pinnedOrder(page)).toEqual([EXTRA_ID]);

  await pinGrip(page, EXTRA_ID).click();
  await expect(pinRowMenuItem(page, "moveUp")).toBeDisabled();
  await expect(pinRowMenuItem(page, "moveDown")).toBeDisabled();
  await expect(pinRowMenuItem(page, "insertAbove")).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "insertBelow")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "remove")).toBeFocused();

  await page.keyboard.press("Enter");
  await expect.poll(async () => pinnedOrder(page)).toEqual([]);

  const paused = page.getByTestId("qcms-autosave-paused");
  await expect(paused).toBeVisible();
  await expect(paused).toHaveAttribute("data-paused-reason", "emptyStep");
});
