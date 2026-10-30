import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { createForm } from "./support/forms.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

/**
 * The Operations forms table in a browser: its URL state, its filter boundaries and the
 * two global queues that share its mode.
 *
 * # What only a browser can report
 *
 * The address arithmetic is unit-tested in `lib/ops/operations-forms.test.ts` and the six
 * render states in `app/(shell)/operations-states.test.tsx`. Three facts are not available
 * at either layer: that applying a filter leaves the mode header, the environment and the
 * page heading where they were; that browser back restores the view the operator left; and
 * that the moved routes land where they say they do.
 *
 * # One persona
 *
 * Every account this harness creates holds the installation claim (`shell-modes.pw.ts`
 * explains why), so the queue links a claim-only caller would see cannot be varied here.
 * The capability rule itself is in `lib/shell/modes.test.ts`.
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

test("lists the forms this caller operates, separating unreleased from closed intake", async ({
  page,
}) => {
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await createForm(page, ALPHA, "Operations alpha");
  await createForm(page, BETA, "Operations beta");

  await page.goto("/operations");

  const table = page.getByTestId("qcms-operations-table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: ALPHA })).toHaveCount(1);
  await expect(table.getByRole("row").filter({ hasText: BETA })).toHaveCount(1);
  // Neither has been released, which is its own reading rather than closed intake.
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
  // The header, the mode, the environment and the heading are all where they were.
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
  await expect(heading).toBeVisible();
  await expect(chip).toHaveAttribute("data-environment", environment ?? "");
});

test("leaving the environment an address names resets the page and keeps the term", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  // The header's control decides the environment, so this address names one the operator
  // is not in: `createForm` left the selection on `test`.
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
  // The queue's own rail offers the way back to the table.
  await page.getByTestId("qcms-webhooks-rail").getByRole("link", { name: "Operations" }).click();
  await expect(page).toHaveURL(/\/operations$/u);

  await page.getByTestId("qcms-operations-rail").getByRole("link", { name: "Erasure log" }).click();
  await expect(page).toHaveURL(/\/responses\/erasures$/u);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
});
