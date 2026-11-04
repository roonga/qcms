import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin } from "./support/flow.js";
import {
  addStep,
  createForm,
  openStep,
  pickerChoice,
  pickerCommit,
  pinLabel,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("anchors570");
const RUN = Date.now().toString(36);

const SEEDED_FORM_ID = "frm_auto_quote";

const PICKER_SLUG = `anchors570-pick-${RUN}`;

let pickerFormId = "";

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

async function tabTo(page: Page, target: Locator, budget = 60): Promise<void> {
  for (let step = 0; step < budget; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
}

test("every converted table's row control is in the document's own tab order", async ({ page }) => {
  test.setTimeout(300_000);

  await enrollNewAdmin(page, EMAIL);

  // Publish the library question first; forms cannot pin unpublished versions.
  await createDraft(page, PICKER_SLUG, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  pickerFormId = await createForm(page, `anchors570-form-${RUN}`, "Anchors 570");
  await addStep(page, "Only step");

  // Stay on the step until pinning: an empty step pauses autosave and would disappear after navigation.
  await openStep(page, "Only step");
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const choice = pickerChoice(dialog, questionIdFor(PICKER_SLUG), 1);
  await expect(choice).toBeVisible();

  await tabTo(page, choice);
  await expect(choice, "the picker's row control is reachable by Tab").toBeFocused();
  await page.keyboard.press("Space");
  await expect(choice, "Space toggles it, as a checkbox and not a link").toBeChecked();
  await pickerCommit(dialog, 1).click();
  await expect(dialog).toBeHidden();
  await expect(pinLabel(page, questionIdFor(PICKER_SLUG), 1)).toBeVisible();

  await page.goto(`/questions?q=${PICKER_SLUG}`);
  const questionLink = page.getByRole("link", {
    name: `Open question ${questionIdFor(PICKER_SLUG)}`,
  });
  await expect(questionLink).toHaveAttribute("href", `/questions/${questionIdFor(PICKER_SLUG)}`);
  await tabTo(page, questionLink);
  await expect(questionLink, "the question library's row link is reachable by Tab").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(questionIdFor(PICKER_SLUG)));

  await page.goto("/forms");
  const formLink = page.getByRole("link", { name: `Open form anchors570-form-${RUN}` });
  await expect(formLink).toHaveAttribute("href", `/forms/${pickerFormId}`);
  await tabTo(page, formLink);
  await expect(formLink, "the form library's row link is reachable by Tab").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(pickerFormId));

  await page.goto(`/forms/${SEEDED_FORM_ID}/versions`);
  const versionLink = page.getByRole("link", { name: "View v1" });
  await expect(versionLink).toHaveAttribute("href", `/forms/${SEEDED_FORM_ID}/versions/1`);
  await tabTo(page, versionLink);
  await expect(versionLink, "the version history's row link is reachable by Tab").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/versions/1$`));
});
