import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, openMenu, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

/**
 * An erasure and an export reach one environment and no other, and the
 * cross-environment offer appears only when there is somewhere to offer (ADR-17's Note,
 * Q7, Q8; task 067, criteria 3 and 4).
 *
 * ## Why these claims are browser claims
 *
 * Every one of them is a property of the **composed app** rather than of a component, and
 * each has a cheaper test that cannot see it:
 *
 *  - the API's own suite asserts that a read on one environment's pool cannot see
 *    another's rows. It cannot assert that the screen an operator is looking at is reading
 *    the environment the switcher says it is, because there is no switcher in it.
 *  - the component test for the offer drives it with an invented list. It cannot assert
 *    that the list is **empty** for an ordinary response, which is the state every
 *    response in a real deployment is in and therefore the state a regression would hide
 *    in: an offer that appeared on every response would be noise nobody reads by the time
 *    it matters.
 *  - `@roonga/qcms-csv`'s unit test asserts the name the helper builds. It cannot assert
 *    that the bytes the browser saves carry it, which is what an operator ends up with.
 *
 * ## What is deliberately not here
 *
 * **The offer firing.** It needs the same session identifier to exist in two environments,
 * and a session id is server-minted per environment, so the respondent path cannot produce
 * one on purpose - that state arises when an environment is seeded or copied from another,
 * which is the case Q7 is about and which no browser flow can reach. Its rendering is the
 * component test's and its data is the API's; what this file adds is the half neither can
 * see, that an ordinary response offers nothing.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("erasure-env");
const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";

/** Set by the first test, which walks the account through enrollment. */
let totpSecret = "";
/** A production response, submitted through the real respondent routes. */
let prodSession = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  prodSession = await submitResponse(SLUG, [[ACCIDENT, "no"]]);
});

function switcher(page: Page) {
  return page.getByTestId("qcms-environment-switcher");
}

/** Choose an environment through the real switcher and wait for the screen to be re-read. */
async function choose(page: Page, environment: string): Promise<void> {
  await openMenu(switcher(page).getByRole("button"));
  await page.getByRole("menuitemradio", { name: environment }).click();
  // The control reports its own pending state, so the wait is on the app rather than on a
  // timeout.
  await expect(switcher(page)).toHaveAttribute("data-pending", "false");
  await expect(switcher(page)).toHaveAttribute("data-environment", environment);
}

test("a response's detail offers no other environment when there is nothing elsewhere", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await page.goto(`/forms/${FORM_ID}/responses/${prodSession}`);
  await expect(page.getByRole("button", { name: "Erase respondent data…" })).toBeVisible();
  // Absent, not hidden. The offer is information, and a banner on every response would be
  // furniture - which is what makes it worth reading on the one response it appears on.
  await expect(page.getByTestId("qcms-erasure-elsewhere")).toHaveCount(0);
});

test("the erasure confirmation names the environment it would act in", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${FORM_ID}/responses/${prodSession}`);

  await page.getByRole("button", { name: "Erase respondent data…" }).click();
  const dialog = page.getByTestId("qcms-erase-dialog");
  await expect(dialog).toBeVisible();
  // An erasure performed against the wrong environment is not undoable (Q6, Q7), so the
  // dialog restates which one it is about. Nothing is confirmed here: the destructive
  // button stays disabled until the session id is retyped, and this test never types it.
  await expect(dialog).toContainText("prod");
  await expect(dialog.getByRole("button", { name: "Erase permanently" })).toBeDisabled();
});

test("a response read reaches the selected environment and no other", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${FORM_ID}/responses`);
  await expect(page.getByTestId("qcms-response-browser")).toBeVisible();

  // The same address under a different environment. The admin deliberately carries no
  // environment in its URL (ADR-40, Q6), so this is the same route reading a different
  // pool - which is what makes "one environment and no other" a thing an operator can see
  // rather than a property of a schema.
  await choose(page, "test");
  await page.goto(`/forms/${FORM_ID}/responses/${prodSession}`);
  await expect(page.locator("body")).not.toContainText("Erase respondent data…");

  await page.goto(`/forms/${FORM_ID}/responses`);
  await choose(page, "prod");
  await page.goto(`/forms/${FORM_ID}/responses/${prodSession}`);
  await expect(page.getByRole("button", { name: "Erase respondent data…" })).toBeVisible();
});

test("an export downloads under the environment it was read from (Q8)", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${FORM_ID}/responses`);
  await expect(page.getByTestId("qcms-response-browser")).toBeVisible();

  // `test` first, because the point is the difference. The export is empty there, which
  // changes nothing about its name: the environment is in the name whether or not the file
  // has rows, since the name is what tells an operator which environment the file on
  // their desktop came from.
  await choose(page, "test");
  expect((await downloadExport(page)).suggestedFilename()).toBe(`${FORM_ID}-test-v1-responses.csv`);

  await choose(page, "prod");
  expect((await downloadExport(page)).suggestedFilename()).toBe(`${FORM_ID}-prod-v1-responses.csv`);
});

/** Open the export dialog, pin v1 and download, returning the browser's download. */
async function downloadExport(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByTestId("qcms-export-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Version$/ }).click();
  await page.getByRole("option", { name: "v1", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByTestId("qcms-export-download").click(),
  ]);
  return download;
}
