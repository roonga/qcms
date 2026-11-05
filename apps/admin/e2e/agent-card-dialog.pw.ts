import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { openPanel, propose } from "./support/agent-card.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/* The card opens in a dialog, and a plan walks page by page with Confirm on the review page alone.
   A narrow viewport is the case the panel cannot show a plan in, which is why the dialog exists. */

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcarddialog1230");
const RUN = Date.now().toString(36);

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

const dialog = (page: import("@playwright/test").Page) => page.getByTestId("qcms-acard-dialog");

test("walks a plan in the dialog, confirming on the review page alone", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  // The narrow case: a plan of several steps does not fit the panel, so the dialog carries it.
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("/forms");
  await openPanel(page);

  await propose(page, "plan-blank-to-draft", `make a form here #qcms-fake-new:${RUN}`);
  await page.getByTestId("qcms-acard-open").click();
  await expect(dialog(page)).toBeVisible();

  // Page one of three, and no Confirm until the review page.
  await expect(dialog(page).locator('[data-page="1"]')).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: /^Confirm/u })).toHaveCount(0);

  for (const expected of ["2", "3"]) {
    await dialog(page).getByRole("button", { name: "Next" }).click();
    await expect(dialog(page).locator(`[data-page="${expected}"]`)).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: /^Confirm/u })).toHaveCount(0);
  }

  await dialog(page).getByRole("button", { name: "Next" }).click();
  await expect(dialog(page).locator('[data-page="review"]')).toBeVisible();
  await expect(dialog(page).locator(".qcms-acard__step")).toHaveCount(3);
  await expect(dialog(page).getByRole("button", { name: /^Confirm all 3 steps/u })).toBeVisible();

  // A draft belongs to no environment, so no step of this plan shows an environment line.
  await expect(dialog(page).locator(".qcms-envchip")).toHaveCount(0);

  // Dismissing the dialog leaves the card waiting rather than withdrawing it.
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(".qcms-acard .qcms-acard__state").first()).toHaveText("Proposed");
});

test("titles a single-step dialog with the step and repeats it nowhere", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("/forms");
  await openPanel(page);

  await propose(page, "propose-form-create", `start one here #qcms-fake-new:${RUN}b`);
  await page.getByTestId("qcms-acard-open").click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('[data-page="review"]')).toBeVisible();
  // The dialog's own title is the step's, so the step row carries no second copy of it.
  await expect(dialog(page).locator(".qcms-acard__what")).toHaveCount(0);
  await expect(dialog(page).getByRole("button", { name: "Confirm" })).toBeVisible();
});
