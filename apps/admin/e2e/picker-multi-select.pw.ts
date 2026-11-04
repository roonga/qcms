import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  openStep,
  pickerChoice,
  pickerCommit,
  pinLabel,
  pinQuestion,
  pinQuestions,
  pinnedOrder,
  savedStamp,
  waitForSaveAfter,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

// Publish two versions of one question so sibling-version exclusion is observable.
// Serial tests share a form; retain its anchor pin so autosave can persist the step.
// Anchor each save on its own edit before the next test navigates.

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("picker660");
const RUN = Date.now().toString(36).slice(-5);

const ANCHOR = `ms-anchor-${RUN}`;
const ALPHA = `ms-alpha-${RUN}`;
const BETA = `ms-beta-${RUN}`;
const GAMMA = `ms-gamma-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

const ANCHOR_ID = questionIdFor(ANCHOR);
const ALPHA_ID = questionIdFor(ALPHA);
const BETA_ID = questionIdFor(BETA);
const GAMMA_ID = questionIdFor(GAMMA);

let totpSecret = "";

let builderPath = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("authors a library with a two-version question and a step to add into", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await createDraft(page, ALPHA, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2$/);
  await confirmLifecycle(page, /^Publish version 2$/, "Publish");

  await createDraft(page, BETA, "Number");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, GAMMA, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, ANCHOR, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await createForm(page, `picker-multi-${RUN}`, "Multi select");
  builderPath = new URL(page.url()).pathname;
  // Capture the baseline before adding an empty step, which pauses autosave and can cancel the prior save.
  const beforeAnchor = await savedStamp(page);
  await addStep(page, "Only step");

  await pinQuestion(page, ANCHOR_ID, 1);
  await waitForSaveAfter(page, beforeAnchor);
});

test("counts what is chosen, on the tally and on the button that will commit it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(builderPath);
  await openStep(page, "Only step");
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const tally = dialog.getByTestId("qcms-picker-chosen");

  await expect(tally).toContainText("Chosen (0)");
  await expect(dialog.getByRole("button", { name: "Add questions to step" })).toBeDisabled();

  await pickerChoice(dialog, BETA_ID, 1).check();
  await expect(tally).toContainText("Chosen (1)");
  await expect(pickerCommit(dialog, 1)).toBeEnabled();

  await pickerChoice(dialog, GAMMA_ID, 1).check();
  await pickerChoice(dialog, ALPHA_ID, 2).check();
  await expect(tally).toContainText("Chosen (3)");
  await expect(pickerCommit(dialog, 3)).toBeEnabled();

  await expect(tally.getByRole("listitem")).toHaveCount(3);
  await expect(tally).toContainText(`${ALPHA_ID}@2`);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a chosen version withdraws its siblings, and unchoosing gives them back", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(builderPath);
  await openStep(page, "Only step");
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await expect(pickerChoice(dialog, ALPHA_ID, 1)).toBeVisible();
  await expect(pickerChoice(dialog, ALPHA_ID, 2)).toBeVisible();

  await pickerChoice(dialog, ALPHA_ID, 2).check();
  await expect(pickerChoice(dialog, ALPHA_ID, 1)).toHaveCount(0);
  await expect(
    dialog.locator(`[data-picker-question="${ALPHA_ID}"][data-picker-version="1"]`),
  ).toContainText("Version 2 of this question is chosen");

  await dialog
    .getByRole("button", { name: `Remove ${ALPHA_ID} version 2 from the chosen list` })
    .click();
  await expect(dialog.getByTestId("qcms-picker-chosen")).toContainText("Chosen (0)");
  await expect(pickerChoice(dialog, ALPHA_ID, 1)).toBeVisible();

  // Removing the last chosen entry destroys the focused control; focus must return to search so Escape still works.
  await expect(dialog.getByRole("textbox", { name: "Search" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a search that hides a chosen row does not unchoose it", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(builderPath);
  await openStep(page, "Only step");
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await pickerChoice(dialog, BETA_ID, 1).check();
  await dialog.getByRole("textbox", { name: "Search" }).fill(GAMMA);

  await expect(pickerChoice(dialog, BETA_ID, 1)).toHaveCount(0);
  await expect(dialog.getByTestId("qcms-picker-chosen")).toContainText("Chosen (1)");
  await expect(dialog.getByTestId("qcms-picker-chosen")).toContainText(`${BETA_ID}@1`);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("adds three questions in one trip, in the order they were chosen", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(builderPath);
  await openStep(page, "Only step");

  const beforeBatch = await savedStamp(page);

  await pinQuestions(page, [
    { questionId: GAMMA_ID, version: 1 },
    { questionId: ALPHA_ID, version: 2 },
    { questionId: BETA_ID, version: 1 },
  ]);

  await expect
    .poll(async () => pinnedOrder(page))
    .toEqual([ANCHOR_ID, GAMMA_ID, ALPHA_ID, BETA_ID]);
  await expect(pinLabel(page, ALPHA_ID, 2)).toBeVisible();
  await waitForSaveAfter(page, beforeBatch);

  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(pickerChoice(dialog, BETA_ID, 1)).toHaveCount(0);
  await expect(
    dialog.locator(`[data-picker-question="${BETA_ID}"][data-picker-version="1"]`),
  ).toContainText("Already in this form");
});
