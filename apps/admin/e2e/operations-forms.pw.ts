import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { chooseEnvironment } from "./support/environment.js";
import { createForm } from "./support/forms.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

/**
 * The Operations forms table in a browser, for the facts no other layer has: that a filter
 * leaves the header, the environment and the heading where they were, that browser back
 * restores the view, and that each redirected address lands where it says.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("opsforms");
const RUN = Date.now().toString(36);
const ALPHA = `e2e-ops-alpha-${RUN}`;
const BETA = `e2e-ops-beta-${RUN}`;

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("lists the forms this caller operates, separating unreleased from closed", async ({
  page,
}) => {
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await createForm(page, ALPHA, "Operations alpha");
  await createForm(page, BETA, "Operations beta");

  await page.goto("/operations");
  await waitForHydration(page);

  // The table pages at 25 rows, so narrow it to this run rather than asserting on whichever
  // page the accumulated fixtures leave these two on.
  const filters = page.getByTestId("qcms-rail-filters");
  await fillStable(filters.getByRole("textbox", { name: "Search" }), RUN);
  await filters.getByRole("button", { name: "Apply" }).click();

  const table = page.getByTestId("qcms-operations-table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: ALPHA })).toHaveCount(1);
  await expect(table.getByRole("row").filter({ hasText: BETA })).toHaveCount(1);
  const alpha = table.getByRole("row").filter({ hasText: ALPHA });
  await expect(alpha.locator('td[data-released="false"]')).toHaveText("None");
  await expect(alpha.locator('td[data-availability="unreleased"]')).toHaveText("Not Released");
});

test("a filter narrows the rows below it and changes nothing above them", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/operations");
  await waitForHydration(page);

  const heading = page.getByRole("heading", { level: 1, name: "Operations" });
  await expect(heading).toBeVisible();
  const chip = page.getByTestId("qcms-mode-header").getByTestId("qcms-environment-switcher");
  const environment = await chip.getAttribute("data-environment");

  const filters = page.getByTestId("qcms-rail-filters");
  await fillStable(filters.getByRole("textbox", { name: "Search" }), ALPHA);
  await filters.getByRole("button", { name: "Apply" }).click();

  await expect(page).toHaveURL(new RegExp(`q=${ALPHA}`, "u"));
  const table = page.getByTestId("qcms-operations-table");
  await expect(table.getByRole("row").filter({ hasText: BETA })).toHaveCount(0);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
  await expect(heading).toBeVisible();
  await expect(chip).toHaveAttribute("data-environment", environment ?? "");
});

test("leaving the environment an address names resets the page and keeps the term", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  // The selection is this browser context's own, so it is made here rather than inherited
  // from the test that created the forms: Playwright gives each test a fresh context.
  await chooseEnvironment(page, "test");

  // The address names an environment the operator is not in.
  await page.goto(`/operations?env=prod&q=${ALPHA}&cursor=stale`);
  await waitForHydration(page);

  const chip = page.getByTestId("qcms-mode-header").getByTestId("qcms-environment-switcher");
  await expect(chip).toHaveAttribute("data-environment", "test");

  // The term survives; the page position does not, and every link names the environment
  // in force rather than the one the address asked for.
  const clear = page.getByTestId("qcms-rail-filters").getByRole("link", { name: "Clear filters" });
  await expect(clear).toHaveAttribute("href", "/operations?env=test");
  await expect(
    page.getByTestId("qcms-rail-filters").getByRole("textbox", { name: "Search" }),
  ).toHaveValue(ALPHA);
});

test("a row opens the form's operational contexts in the environment the chip names", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await chooseEnvironment(page, "test");
  await page.goto("/operations");
  await waitForHydration(page);

  const row = page.getByTestId("qcms-operations-table").getByRole("row").filter({ hasText: ALPHA });
  await expect(row).toHaveCount(1);
  // Every context link names its own row. The first the caller may open is the form's
  // NAME, so the list beside it is the rest; an account here holds every cell.
  const contexts = row.getByTestId("qcms-operations-contexts");
  for (const context of ["Links", "Webhooks", "Availability"]) {
    await expect(contexts.getByRole("link", { name: `${context} for ${ALPHA}` })).toBeVisible();
  }
  // No authoring screen is offered from here.
  await expect(contexts.getByRole("link", { name: `Versions for ${ALPHA}` })).toHaveCount(0);

  await row.getByTestId("qcms-operations-name").click();

  // The name opens the row's first operational context, read where the chip said.
  await expect(page).toHaveURL(/\/operations\/forms\/frm_[^/]+\/responses$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Responses" })).toBeVisible();
  await expect(page.getByTestId("qcms-response-browser")).toBeVisible();
});

test("the addresses the operational screens had still arrive, with their query", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/operations");
  await waitForHydration(page);
  const formId = await page
    .getByTestId("qcms-operations-table")
    .getByRole("row")
    .filter({ hasText: ALPHA })
    .getAttribute("data-form-id");

  // What only a browser reports: each config redirect lands, and the response list's
  // filters survive the hop.
  await page.goto(`/forms/${formId}/responses?flagged=true`);
  await expect(page).toHaveURL(
    new RegExp(`/operations/forms/${formId}/responses\\?flagged=true$`, "u"),
  );

  await page.goto(`/forms/${formId}/links`);
  await expect(page).toHaveURL(new RegExp(`/operations/forms/${formId}/links$`, "u"));

  await page.goto(`/forms/${formId}/webhooks`);
  await expect(page).toHaveURL(new RegExp(`/operations/forms/${formId}/webhooks$`, "u"));

  await page.goto(`/operations/forms/${formId}/intake`);
  await expect(page).toHaveURL(new RegExp(`/operations/forms/${formId}/availability$`, "u"));

  // Nothing is released here, so the screen reads the row's third word and offers no verb.
  await expect(page.getByTestId("qcms-form-availability-reading")).toHaveText("Not Released");
  await expect(page.getByText("Availability: Not Released")).toBeVisible();
  await expect(page.getByTestId("qcms-form-not-released")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Close to new responses/u })).toHaveCount(0);
});

test("the legacy responses picker redirects to the Operations table", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/responses");

  await expect(page).toHaveURL(/\/operations$/u);
  await expect(page.getByTestId("qcms-operations-table")).toBeVisible();
});

test("the global queues are Operations destinations, reached from its rail", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/operations");

  const rail = page.getByTestId("qcms-operations-rail");
  await rail.getByRole("link", { name: "Delivery failures" }).click();

  await expect(page).toHaveURL(/\/webhooks$/u);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await page.getByTestId("qcms-webhooks-rail").getByRole("link", { name: "Erasure log" }).click();
  await expect(page).toHaveURL(/\/responses\/erasures$/u);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");

  // The rails hold queues and filters only, so the way back to the forms list is the group's title.
  await page
    .getByTestId("qcms-mode-header")
    .getByRole("link", { name: "Operations", exact: true })
    .click();
  await expect(page).toHaveURL(/\/operations$/u);
  await expect(
    page.getByTestId("qcms-operations-rail").getByRole("link", { name: "Delivery failures" }),
  ).toBeVisible();
});
