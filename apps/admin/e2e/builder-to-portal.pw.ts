import type { Locator, Page } from "@playwright/test";
import { deriveAppearance } from "@roonga/qcms-core";

import { PORTAL_PORT } from "../../portal/e2e/support/harness-config.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addStep, createForm, pinQuestion, waitForSaved } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { chooseDestination, chooseSource, releaseThroughWizard } from "./support/publish.js";
import { confirmLifecycle, createDraft, draftLabel } from "./support/questions.js";

/**
 * X3 across both stacks: a look set in the builder's appearance drawer, published through the
 * wizard, and then read off the respondent's own page in the portal. The admin halves are
 * covered on their own elsewhere; what this proves is the crossing, which no single stack can.
 */

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("builder121");
const RUN = Date.now().toString(36);
const TEXT_SLUG = `e2e-b2p-text-${RUN}`;
const TEXT_ID = `q_${TEXT_SLUG.replaceAll("-", "_")}`;
const TEXT_LABEL = draftLabel("longText");
const FORM_SLUG = `e2e-b2p-${RUN}`;
const STEP_TITLE = "About you";

/** The shipped theme the drawer applies, and the look a respondent must end up reading. */
const PLUM = deriveAppearance({ primary: "#6d28a8", secondary: "#5f5470" }).palettes;
const TEXT_BASE_PX = 20;

let totpSecret = "";
let formId = "";

function surface(page: Page): Locator {
  return page.getByTestId("qcms-builder-device").getByTestId("qcms-preview-surface");
}

function drawer(page: Page): Locator {
  return page.getByTestId("qcms-appearance-drawer");
}

function rootToken(page: Page, name: string): Promise<string> {
  return page
    .locator("html")
    .evaluate((element, token) => getComputedStyle(element).getPropertyValue(token).trim(), name);
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("builds a draft for the builder to dress", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await createDraft(page, TEXT_SLUG, "longText");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  formId = await createForm(page, FORM_SLUG, "Builder to portal");
  await addStep(page, STEP_TITLE);
  await pinQuestion(page, TEXT_ID, 1);
  await waitForSaved(page);
});

test("dresses it in the drawer, publishes through the wizard and hands back to the builder", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1440, height: 900 });
  const build = `/forms/${formId}/build`;
  await page.goto(build);
  await waitForHydration(page);
  await expect(surface(page).getByText(TEXT_LABEL)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(drawer(page)).toBeVisible();
  await drawer(page).getByLabel("Theme", { exact: true }).selectOption({ label: "Plum" });
  await drawer(page).getByRole("button", { name: "Large", exact: true }).click();
  await expect(page.getByTestId("qcms-appearance-text-size")).toHaveValue(String(TEXT_BASE_PX));
  await page.getByTestId("qcms-appearance-done").locator("button").click();
  await expect(page.getByText("Appearance saved to the draft.")).toBeVisible();

  // The builder's own Publish, which is the wizard with a hand-back to this screen.
  await Promise.all([
    page.waitForURL(new RegExp(`/forms/${formId}/publish`, "u")),
    page.getByRole("link", { name: "Publish" }).click(),
  ]);
  const changes = page.getByTestId("qcms-publish-changes");
  await expect(changes).toBeVisible();
  await expect(changes.getByTestId("qcms-publish-change-list")).toContainText(STEP_TITLE);

  // Driven where the builder left it, rather than through the shared helper: the helper
  // navigates to the wizard itself, which would drop the `returnTo` the builder put there.
  await chooseSource(page, "The shared draft");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();
  await chooseDestination(destinations, "test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("qcms-publish-review")).toBeVisible();
  await expect(page.getByTestId("qcms-freeze-summary")).toBeVisible();
  await page.getByRole("button", { name: /^Publish to /u }).click();
  const result = page.getByTestId("qcms-publish-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText("Version 1 is published.");

  await Promise.all([
    page.waitForURL(new RegExp(`${build}$`, "u")),
    page.getByTestId("qcms-publish-return").click(),
  ]);
  await waitForHydration(page);
  // The publish took the draft with it, so the builder offers another rather than a preview.
  await expect(page.getByTestId("qcms-builder")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a new draft", exact: true })).toBeVisible();
});

test("the respondent reads the published look in the portal", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // There is no anonymous entry under an environment prefix, so the respondent's own address
  // reaches `prod` alone: the version the builder dressed has to be released there first.
  await releaseThroughWizard(page, { formId, version: 1, environment: "prod" });

  await page.goto(`http://localhost:${String(PORTAL_PORT)}/f/${FORM_SLUG}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/u);
  await expect(page.getByTestId("step-card")).toBeVisible({ timeout: 60_000 });

  // The frozen version's own appearance, on the first byte: the carrier, the palette the
  // drawer chose and the base size it set, not the deployment's.
  await expect(page.locator("html")).toHaveAttribute("data-qcms-form-appearance", "");
  expect(await rootToken(page, "--color-primary")).toBe(PLUM.light.primary);
  expect(await rootToken(page, "--text-base")).toBe(String(TEXT_BASE_PX / 16));
});
