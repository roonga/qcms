import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { chooseEnvironment } from "./support/environment.js";
import { createForm } from "./support/forms.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("opsforms");
const RUN = Date.now().toString(36);
const ALPHA = `e2e-ops-alpha-${RUN}`;
const BETA = `e2e-ops-beta-${RUN}`;

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("lists the forms this caller operates, separating unreleased from closed intake", async ({
  page,
}) => {
  // Enrollment and two form creations, each route compiled for the first time when this
  // file runs on its own, which spends the default budget before the last navigation.
  test.setTimeout(120_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await createForm(page, ALPHA, "Operations alpha");
  await createForm(page, BETA, "Operations beta");

  await page.goto("/operations");

  const table = page.getByTestId("qcms-operations-table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: ALPHA })).toHaveCount(1);
  await expect(table.getByRole("row").filter({ hasText: BETA })).toHaveCount(1);

  await expect(
    table.getByRole("row").filter({ hasText: ALPHA }).getByText("No release"),
  ).toHaveCount(2);
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

  await chooseEnvironment(page, "test");

  await page.goto(`/operations?env=prod&q=${ALPHA}&cursor=stale`);
  await waitForHydration(page);

  const chip = page.getByTestId("qcms-mode-header").getByTestId("qcms-environment-switcher");
  await expect(chip).toHaveAttribute("data-environment", "test");

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
  // Every context link names its own row, so two rows' Responses links are distinguishable.
  const contexts = row.getByTestId("qcms-operations-contexts");
  for (const context of ["Versions", "Links", "Webhooks", "Responses"]) {
    await expect(contexts.getByRole("link", { name: `${context} for ${ALPHA}` })).toBeVisible();
  }

  await contexts.getByRole("link", { name: `Responses for ${ALPHA}` }).click();

  // The responses of that form, read where the chip said, rather than a refusal.
  await expect(page).toHaveURL(/\/forms\/frm_[^/]+\/responses$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Responses" })).toBeVisible();
  await expect(page.getByTestId("qcms-response-browser")).toBeVisible();

  // The form's name still leads to the form itself for a caller who may read it.
  await page.goto("/operations");
  await waitForHydration(page);
  await expect(row).toHaveCount(1);
  await row.getByTestId("qcms-operations-name").click();
  await expect(page).toHaveURL(/\/forms\/frm_[^/]+$/u);
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
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);

  await page.getByTestId("qcms-webhooks-rail").getByRole("link", { name: "Operations" }).click();
  await expect(page).toHaveURL(/\/operations$/u);

  await page.getByTestId("qcms-operations-rail").getByRole("link", { name: "Erasure log" }).click();
  await expect(page).toHaveURL(/\/responses\/erasures$/u);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
});
