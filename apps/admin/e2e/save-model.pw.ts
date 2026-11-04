import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  field,
  issueSummary,
  openFormDetails,
  pinQuestion,
  savedStamp,
  waitForSaveAfter,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("savemodel");

const RUN = Date.now().toString(36);

const PINNED_SLUG = `e2e-save-model-pin-${RUN}`;

const DRAFT_SLUG = `e2e-save-model-draft-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

// Pin a non-UTC zone without daylight saving: saved-at labels use the operator's clock after hydration.
test.use({ timezoneId: "Asia/Kolkata", locale: "en-US" });

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("the builder states one save model, in ambient chrome outside the validation panel", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await createDraft(page, PINNED_SLUG, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await createForm(page, `e2e-save-model-${RUN}`, "Save model");
  await addStep(page, "Only step");
  await pinQuestion(page, questionIdFor(PINNED_SLUG), 1);
  await waitForSaved(page);

  await openFormDetails(page);

  const strip = page.getByTestId("qcms-save-status");
  const panel = page.getByTestId("qcms-validation-status");

  await expect(strip).toHaveCount(1);
  await expect(strip).toBeVisible();

  await expect(page.getByTestId("qcms-save-model")).toHaveCount(0);
  await page.getByRole("button", { name: "How does this screen save?" }).click();
  await expect(page.getByTestId("qcms-save-model")).toHaveText(
    "This draft saves automatically as you edit.",
  );
  await page.getByRole("button", { name: "How does this screen save?" }).click();

  await expect(panel.getByTestId("qcms-save-state")).toHaveCount(0);
  await expect(strip.getByTestId("qcms-save-state")).toHaveCount(1);

  await expect(strip.getByTestId("qcms-save-state")).toHaveAttribute("aria-live", "polite");
  await expect(strip.getByTestId("qcms-save-state")).toContainText(/^Last saved /);

  const sentence = (await strip.getByTestId("qcms-save-state").textContent()) ?? "";
  // Accept either a GMT offset or abbreviation; ICU chooses the short-zone spelling.
  expect(sentence.trim(), "the saved-at time names its zone").toMatch(/(?:GMT[^\s]*|[A-Z]{2,5})$/u);

  expect(sentence, "the saved-at time is on the operator's clock").not.toMatch(/\bUTC\b/u);
  expect(sentence, "no seconds: HH:MM only").not.toMatch(/\d{1,2}:\d{2}:\d{2}/u);

  await expect(panel).toHaveAttribute("aria-live", "polite");
  await expect(issueSummary(page)).toHaveText("No issues. Everything here would pass a publish.");
  await expect(strip).not.toContainText(/issue/iu);

  // Wait on the machine instant because the displayed sentence has only minute precision.
  const before = await savedStamp(page);
  await fillStable(field(page, "Form title"), "Save model, renamed");
  await waitForSaveAfter(page, before);
  expect(await savedStamp(page), "a second save moved the instant").not.toBe(before);
});

test("the rules route states the same one model, and no second one beside it", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const slug = `e2e-save-model-rules-${RUN}`;
  const formId = await createForm(page, slug, "Rules save model");
  await addStep(page, "Only step");
  await pinQuestion(page, questionIdFor(PINNED_SLUG), 1);
  await waitForSaved(page);

  await page.goto(`/forms/${formId}/rules`);
  const strip = page.getByTestId("qcms-save-status");

  await expect(strip).toHaveCount(1);
  await expect(strip.getByTestId("qcms-save-state")).toHaveText("Not saved yet");
  await expect(strip).not.toHaveAttribute("data-saved-at", /./u);

  await page.getByRole("button", { name: "How does this screen save?" }).click();
  await expect(page.getByTestId("qcms-save-model")).toHaveText(
    "This draft saves automatically as you edit.",
  );
  await page.getByRole("button", { name: "How does this screen save?" }).click();

  await expect(page.getByTestId("qcms-validation-status")).toHaveCount(0);
  await expect(strip).not.toContainText(/issue/iu);

  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await expect(page.locator("section[data-rule-id]")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const paused = page.getByTestId("qcms-autosave-paused");
  await expect(paused).toBeVisible();
  await expect(paused).toHaveAttribute("data-paused-reason", "ruleWithoutTarget");

  await page.locator("tr[data-rule-id]").getByRole("button", { name: "Remove" }).click();
  await expect(paused).toHaveCount(0);
  await expect(strip.getByTestId("qcms-save-state")).toContainText(/^Last saved /, {
    timeout: 30_000,
  });
});

test("the question editor states its manual model, visibly, with no ambient strip", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/questions/new");
  const note = page.getByTestId("qcms-manual-save-note");
  await expect(note).toHaveCount(1);
  await expect(note).toBeVisible();
  await expect(note).toContainText("This editor does not save automatically.");

  await expect(note).toContainText("discards what you have written");
  await expect(
    page.getByRole("main").getByRole("button", { name: "Create draft" }),
    "and the control it is about is beside it",
  ).toBeVisible();

  await expect(note).not.toHaveAttribute("title", /./u);

  await expect(page.getByTestId("qcms-save-status")).toHaveCount(0);
  await expect(page.getByTestId("qcms-save-state")).toHaveCount(0);

  await createDraft(page, DRAFT_SLUG, "Long text");
  await expect(page).toHaveURL(new RegExp(`/questions/${questionIdFor(DRAFT_SLUG)}`, "u"));
  await expect(page.getByTestId("qcms-manual-save-note")).toContainText(
    "This editor does not save automatically.",
  );
  await expect(page.getByTestId("qcms-manual-save-note")).toContainText("discards unsaved changes");
  await expect(
    page.getByRole("main").getByRole("button", { name: "Save draft" }),
    "and the control it is about is beside it",
  ).toBeVisible();
  await expect(page.getByTestId("qcms-save-status")).toHaveCount(0);

  await page.goto(`/questions/${questionIdFor(PINNED_SLUG)}`);
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect(page.getByTestId("qcms-manual-save-note")).toHaveCount(0);
  await expect(page.getByTestId("qcms-save-status")).toHaveCount(0);
});
