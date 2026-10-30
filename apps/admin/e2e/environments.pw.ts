import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, openMenu, signInWithTotp } from "./support/flow.js";
import { createForm } from "./support/forms.js";

/**
 * The global environment switcher and its banner (ADR-40 Q6, task 065, criterion 6).
 *
 * ## Why this criterion is a browser test and says so
 *
 * The work order names it: **a banner nobody renders is the failure mode here**, and a unit
 * test on the component does not catch a shell that never mounts it. Everything below is a
 * property of the composed app rather than of a component - which screens carry the shell,
 * what survives a navigation, what survives a reload, and what a confirmation dialog says
 * when it opens.
 *
 * ## The three claims, and the order they are made in
 *
 *  1. **The switcher is on every screen** and shows one selection across all of them.
 *  2. **The banner is present under a non-prod environment and absent under `prod`**, which
 *     is what makes its presence information rather than furniture.
 *  3. **A destructive confirmation names the environment**, because an act performed
 *     against the wrong one is not undoable. The close dialog is the one reached here; the
 *     release dialog's own restatement is asserted in `forms-publish.pw.ts` where a
 *     published version exists to release, and the erasure dialog's in the component test
 *     that drives its reasons and its typed confirmation.
 *
 * Nothing here hard-codes a colour. The banner is found by its role and its text, and the
 * switcher by the name it carries, so a palette revision changes neither - and a banner
 * that stopped rendering still fails.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("environments");
const RUN = Date.now().toString(36);
const FORM_SLUG = `e2e-env-form-${RUN}`;

/** Set by the first test, which walks the account through enrollment. */
let totpSecret = "";
let formId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** The screens the shell renders, one per top-level area plus one form-scoped screen. */
function everyArea(): readonly string[] {
  return ["/questions", "/forms", "/operations", "/settings"];
}

function switcher(page: Page) {
  return page.getByTestId("qcms-environment-switcher");
}

function banner(page: Page) {
  return page.getByTestId("qcms-environment-banner");
}

/** Choose an environment through the switcher and wait for the screen to be re-read. */
async function choose(page: Page, environment: string): Promise<void> {
  await openMenu(switcher(page).getByRole("button"));
  await page.getByRole("menuitemradio", { name: environment }).click();
  // The control says when the refresh is in flight, so the wait is on the app's own state
  // rather than on a timeout.
  await expect(switcher(page)).toHaveAttribute("data-pending", "false");
  await expect(switcher(page)).toHaveAttribute("data-environment", environment);
}

test("every screen carries the switcher, and production carries no banner", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  for (const area of everyArea()) {
    await page.goto(area);
    await expect(switcher(page), `${area} carries the switcher`).toBeVisible();
    await expect(switcher(page)).toHaveAttribute("data-environment", "prod");
    // Absent, not hidden: under `prod` there is nothing on screen to read, which is what
    // makes a banner meaningful when it is there.
    await expect(banner(page), `${area} shows no banner under prod`).toHaveCount(0);
  }
});

test("selecting a non-prod environment banners every screen, and persists", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/forms");
  await choose(page, "test");

  // The banner names the environment in words (WCAG 1.4.1: never colour alone) and is a
  // `role="status"` rather than an alert, because it states where the operator is instead
  // of interrupting them.
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toHaveAttribute("data-environment", "test");
  await expect(banner(page)).toContainText("test");

  // Every screen, on a soft navigation. The shell is the only thing that renders it, so a
  // screen outside the shell's layout would simply not have it.
  for (const area of everyArea()) {
    await page.goto(area);
    await expect(banner(page), `${area} banners the selection`).toBeVisible();
    await expect(switcher(page)).toHaveAttribute("data-environment", "test");
  }

  // And across a reload, which is what proves the server resolved it rather than a script
  // correcting the page after load: the cookie rides the navigation, so the first byte of
  // HTML already carries the banner.
  await page.reload();
  await expect(banner(page)).toBeVisible();
  await expect(switcher(page)).toHaveAttribute("data-environment", "test");
});

test("a destructive confirmation names the environment it is about", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // Chosen here rather than inherited from the test above: a Playwright test gets a fresh
  // browser context, so the cookie that carries the selection does not cross between them.
  // Persistence is asserted where it is real - across a navigation and a reload, inside one
  // context - rather than against a cookie jar the harness threw away.
  await page.goto("/forms");
  await choose(page, "test");

  formId = await createForm(page, FORM_SLUG, "Environment restatement");
  await page.goto(`/forms/${formId}`);

  // Closing a form is per (form, environment) since task 066 (Q18), so the environment is
  // in the trigger, the title, the body and the confirm button: an operator who has been
  // working in `test` all morning must not read a confirmation that says nothing about
  // where it lands - and since the act itself is now scoped, "Close form" would be
  // ambiguous rather than merely unhelpful.
  await page.getByRole("button", { name: "Close in test" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("qcms-lifecycle-environment")).toContainText("test");
  await expect(dialog).toContainText("Every other environment is unaffected");
  await expect(dialog.getByRole("button", { name: "Close it in test" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The combined publish-and-release action names it in the button itself, so the operator
  // reads which environment they are about to put a version in front of before they press.
  await expect(page.getByRole("button", { name: "Publish to test" })).toBeVisible();
});

test("a dialog never acts in an environment another tab switched to", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // Local UX list A1, reproduced live before the fix: tab A showed "Close it in prod", tab
  // B switched to test, and confirming in tab A closed the form in TEST. The selection is a
  // cookie both tabs share, so tab B is a second page in the same context.
  await page.goto("/forms");
  await choose(page, "prod");
  await page.goto(`/forms/${formId}`);
  await page.getByRole("button", { name: "Close in prod" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Close it in prod" })).toBeVisible();

  const tabB = await page.context().newPage();
  await tabB.goto("/forms");
  await choose(tabB, "test");

  // Tab A still names prod, and its confirmation is refused rather than obeyed in test.
  await dialog.getByRole("button", { name: "Close it in prod" }).click();
  await expect(dialog).toContainText("This tab was showing prod; you have since switched to test");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Nothing was closed in either environment. Tab A, reloaded, is in test and the form is
  // still open there; tab B, back in prod, finds it open there too.
  await page.reload();
  await expect(switcher(page)).toHaveAttribute("data-environment", "test");
  await expect(page.getByRole("button", { name: "Close in test" })).toBeVisible();
  await choose(tabB, "prod");
  await tabB.goto(`/forms/${formId}`);
  await expect(tabB.getByRole("button", { name: "Close in prod" })).toBeVisible();
  await tabB.close();
});

test("a tab coming back into view is re-read under another tab's switch", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/forms");
  await choose(page, "prod");

  const tabB = await page.context().newPage();
  await tabB.goto("/forms");
  await choose(tabB, "test");
  await tabB.close();

  // Still rendered from prod until it is looked at again.
  await expect(switcher(page)).toHaveAttribute("data-environment", "prod");
  // Playwright's default Chromium (the headless shell) never hides a page: measured with
  // probes on every one, page A reports `visible` before tab B opens, while it is open,
  // after it closes and after `bringToFront()`, and receives no `visibilitychange` at any of
  // those points. So the event a returning operator's browser sends cannot be produced by
  // switching tabs here and is dispatched directly. The state the shell checks is asserted
  // first, so a red below is about what the shell does with a return, not about whether the
  // harness produced one.
  await page.bringToFront();
  expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toHaveAttribute("data-environment", "test");
  // The switcher follows the re-read too, rather than keeping the name it was mounted with.
  await expect(switcher(page)).toHaveAttribute("data-environment", "test");

  await choose(page, "prod");
});

test("returning to production takes the banner away", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // The whole round trip in one context, because that is the only place it is a round trip:
  // out to `test`, where the banner is, and back to `prod`, where it is not.
  await page.goto("/forms");
  await choose(page, "test");
  await expect(banner(page)).toBeVisible();

  await choose(page, "prod");
  await expect(banner(page)).toHaveCount(0);

  // On a reload too: the cookie now says `prod`, so there is nothing to take away.
  await page.reload();
  await expect(banner(page)).toHaveCount(0);
  await expect(switcher(page)).toHaveAttribute("data-environment", "prod");
});
