import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/**
 * The membership screens in a browser (ADR-41, SEC-15; task 069).
 *
 * # Criterion 22 is the reason this spec exists
 *
 * "The admin's help text for the setting says a grant on `test` responses is a grant on
 * personal data, **asserted in the browser suite because a warning nobody renders is the
 * failure mode**." A catalog entry is not a warning; a sentence on screen is. So the
 * assertion is that the sentence is rendered, in those terms, **before** anybody turns the
 * switch on - because a warning that appeared after the decision would arrive too late to
 * be one.
 *
 * # What else is asserted here rather than in an integration test
 *
 * The three facts only a browser can report:
 *
 *   - the area is reachable from the shell's own navigation, so an operator finds it
 *     without being given a URL;
 *   - the four panels of a workspace page are on screen together, each named by its own
 *     heading, which is what makes "each is a different authority" legible; and
 *   - the second-approver switch's help text states all **three** of its effects, because
 *     an operator who reads one switch should not learn the third when a grant is refused.
 *
 * Who may call what is the API's, and `apps/api/e2e/security/01-authorization-matrix.e2e.ts`
 * is where that is asserted; nothing here is a check this app performs.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("membership069");

/** The workspace a bootstrapped installation is seeded with (ADR-41, task 068). */
const WORKSPACE_ID = "org_default_workspace";

/** Set by the first test; the rest sign in again with it (serial shares no context). */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("the membership area is reachable from the shell's navigation", async ({ page }) => {
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await page.getByRole("link", { name: "Workspaces" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();

  // The seeded workspace is there, and the reader's own access is beside it: everybody
  // reads their own grants, because a workspace's membership list is its owners' to see.
  await expect(page.getByRole("heading", { level: 2, name: "Your own access" })).toBeVisible();
  await expect(
    page.getByText("You hold the installation-wide claim", { exact: false }),
  ).toBeVisible();
  // And what that claim does NOT grant is on the same line, because an administrator who
  // meets a refused response screen should be able to read why where they read what they
  // hold.
  await expect(
    page.getByText("It grants no response read, export or erasure anywhere", { exact: false }),
  ).toBeVisible();
});

test("a workspace page carries its four panels, each named", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}`);

  for (const heading of ["Members", "Access groups", "Workspace settings", "Access audit"]) {
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }

  // The four rules the name convention rests on, as the one sentence beside the groups:
  // the fields decide, and nothing reads a name to authorise anything.
  await expect(
    page.getByText("is a label rather than a mechanism", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Nothing reads a name to authorise anything", { exact: false }),
  ).toBeVisible();
});

test("the seed setting's help text says a grant on test responses is a grant on personal data", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}`);

  // **Criterion 22.** Q57's own words, on screen, with the switch still off: "a grant on
  // test responses is a grant on personal data, because a test run can involve real
  // respondents". The checkbox is found by its label, so this also pins that the sentence
  // is beside the control rather than somewhere else on the page.
  const seed = page.getByLabel("Seed a new editor with dev and test response access");
  await expect(seed).toBeVisible();
  await expect(seed).not.toBeChecked();
  await expect(
    page.getByText("A grant on test responses is a grant on personal data", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("because a test run can involve real respondents", { exact: false }),
  ).toBeVisible();
  // And what turning it on does, including that the act is recorded.
  await expect(
    page.getByText("turning it on is written to the access audit", { exact: false }),
  ).toBeVisible();
});

test("the two-person switch states all three of its effects", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}`);

  const twoPerson = page.getByLabel("Require a second approver for production");
  await expect(twoPerson).toBeVisible();
  await expect(twoPerson).not.toBeChecked();
  // One switch, three effects (Q30, Q51, Q56). The third is the one an operator would
  // otherwise meet as a refused grant with no explanation.
  for (const effect of [
    "A release to production is refused for the account that published the version",
    "a production endpoint change takes a second approver's confirmation",
    "nobody can grant themselves a responses role",
  ]) {
    await expect(page.getByText(effect, { exact: false })).toBeVisible();
  }
});
