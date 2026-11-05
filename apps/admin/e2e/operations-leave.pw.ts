import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

/**
 * Leaving Operations in a browser: the warning an incidental link raises, the silence of
 * movement inside the mode, browser back, and the Exit control that returns the operator
 * to where they came from.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("opsleave");
const FORM_ID = "frm_auto_quote";
const OUTSIDE = "qcms-e2e-outside-link";

let secret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/**
 * Operations draws no link out of itself today, so the spec plants one: the warning listens
 * for every same-origin link, and a planted one is what an incidental link will be.
 */
async function plantOutsideLink(page: Page, href: string): Promise<void> {
  await page.evaluate(
    ({ id, target }) => {
      document.getElementById(id)?.remove();
      const link = document.createElement("a");
      link.id = id;
      link.href = target;
      link.textContent = "Open the form editor";
      document.querySelector("main#main-content")?.prepend(link);
    },
    { id: OUTSIDE, target: href },
  );
}

const leaveDialog = (page: Page) => page.getByRole("alertdialog", { name: "Leave Operations?" });

test("a link out of Operations asks first, and Stay keeps the operator in Operations", async ({
  page,
}) => {
  secret = await enrollNewAdmin(page, EMAIL);
  await page.goto("/operations");
  await waitForHydration(page);
  await plantOutsideLink(page, `/forms/${FORM_ID}`);

  const link = page.locator(`#${OUTSIDE}`);
  await link.click();
  const dialog = leaveDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This link opens Forms, outside Operations.");
  await expect(dialog).toContainText("you selected in Operations does not apply there.");
  // Stay first and focused, so Enter and Escape both keep the operator where they are.
  await expect(dialog.getByRole("button", { name: "Stay in Operations" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/operations$/u);
  await expect(link).toBeFocused();

  await link.click();
  await leaveDialog(page).getByRole("button", { name: "Stay in Operations" }).click();
  await expect(leaveDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/operations$/u);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
});

test("Leave goes, and browser back returns to Operations without asking", async ({ page }) => {
  await signInWithTotp(page, EMAIL, secret);
  await page.goto("/operations");
  await waitForHydration(page);
  await plantOutsideLink(page, `/forms/${FORM_ID}`);

  await page.locator(`#${OUTSIDE}`).click();
  await leaveDialog(page).getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${FORM_ID}$`, "u"));
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByTestId("qcms-mode-header")).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/operations$/u);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
  await expect(leaveDialog(page)).toHaveCount(0);
});

test("moving inside Operations, its global queues and the avatar menu asks nothing", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, secret);
  await page.goto("/operations");
  await waitForHydration(page);

  await page.locator(`tr[data-form-id="${FORM_ID}"]`).getByTestId("qcms-operations-name").click();
  await expect(page).toHaveURL(new RegExp(`/operations/forms/${FORM_ID}/`, "u"));
  await expect(leaveDialog(page)).toHaveCount(0);

  await page
    .getByTestId("qcms-operations-form-rail")
    .getByRole("link", { name: "Operations" })
    .click();
  await expect(page).toHaveURL(/\/operations$/u);
  await page
    .getByTestId("qcms-operations-rail")
    .getByRole("link", { name: "Delivery failures" })
    .click();
  await expect(page).toHaveURL(/\/webhooks$/u);
  await expect(leaveDialog(page)).toHaveCount(0);

  await page.getByTestId("account-menu").getByRole("button").click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/u);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
  await expect(leaveDialog(page)).toHaveCount(0);

  // Back inside the mode is movement inside it too.
  await page.goBack();
  await expect(page).toHaveURL(/\/webhooks$/u);
  await expect(leaveDialog(page)).toHaveCount(0);
});

test("Exit Operations returns to where the operator came from, without the warning", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, secret);
  await page.goto(`/forms/${FORM_ID}/rules`);
  await waitForHydration(page);

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Operations" })
    .click();
  await expect(page).toHaveURL(/\/operations$/u);
  await page.locator(`tr[data-form-id="${FORM_ID}"]`).getByTestId("qcms-operations-name").click();
  await expect(page).toHaveURL(new RegExp(`/operations/forms/${FORM_ID}/`, "u"));

  const exit = page.getByTestId("qcms-mode-exit");
  await expect(exit).toHaveAttribute("href", `/forms/${FORM_ID}/rules`);
  await exit.click();
  await expect(page).toHaveURL(new RegExp(`/forms/${FORM_ID}/rules$`, "u"));
  await expect(leaveDialog(page)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

test("Exit Operations falls back to the authoring landing when nothing says where", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, secret);
  // A tab of its own: where the first tab came from is not this one's.
  const fresh = await page.context().newPage();
  try {
    await fresh.goto("/operations");
    await waitForHydration(fresh);
    await fresh.getByTestId("qcms-mode-exit").click();
    await expect(fresh).toHaveURL(/\/questions$/u);
    await expect(leaveDialog(fresh)).toHaveCount(0);
  } finally {
    await fresh.close();
  }
});
