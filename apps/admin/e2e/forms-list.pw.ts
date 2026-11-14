import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  chooseOption,
  createForm,
  field,
  pinQuestion,
  waitForSaved,
} from "./support/forms.js";
import { publishDraftThroughWizard } from "./support/publish.js";

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("forms-list");

let totpSecret = "";

const RUN = Date.now().toString(36);

const SCOPE = `e2e-list-${RUN}`;

const ALPHA = `${SCOPE}-a`;
const BRAVO = `${SCOPE}-b`;
const CHARLIE = `${SCOPE}-c`;

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

async function openLibrary(page: Page, extra = ""): Promise<void> {
  await page.goto(`/forms?q=${SCOPE}${extra}`);
  await expect(page.getByRole("heading", { name: "Forms", level: 1 })).toBeVisible();
}

// A row leads with the form's title, so the address comes off the row rather than out of the
// cell's own text.
async function listedSlugs(page: Page): Promise<string[]> {
  const rows = page.locator("table[data-testid='qcms-forms-table'] tbody tr");
  return rows.evaluateAll((elements) =>
    elements.map((row) => row.getAttribute("data-form-slug") ?? ""),
  );
}

function rowMenuTrigger(page: Page, name: string) {
  return page.getByRole("button", { name: `Actions for form ${name}` });
}

function rowMenu(page: Page, name: string) {
  return page.getByRole("menu", { name: `Actions for form ${name}` });
}

async function openRowMenu(page: Page, name: string): Promise<void> {
  const trigger = rowMenuTrigger(page, name);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(rowMenu(page, name)).toBeVisible();
}

async function formIdOf(page: Page, slug: string): Promise<string> {
  const id = await page.locator(`tr[data-form-slug="${slug}"]`).getAttribute("data-form-id");
  expect(id, `a listed row for ${slug}`).toBeTruthy();
  return id ?? "";
}

test("creates the library this spec reads, and closes one of its forms", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await createForm(page, ALPHA, "Alpha zebra");

  // Publish and release before closing: the closed state belongs to an environment's release, not the form identity.
  const bravoId = await createForm(page, BRAVO, "Bravo quokka");
  await addStep(page, "Driving history");
  await pinQuestion(page, "q_at_fault_accident", 2);

  await waitForSaved(page);
  await publishDraftThroughWizard(page, { formId: bravoId, version: 1, environment: "test" });

  await page.goto(`/operations/forms/${bravoId}/availability`);
  await page.getByRole("button", { name: "Close to new responses in test" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Close it in test" }).click();
  await expect(page.getByTestId("qcms-form-closed")).toBeVisible({ timeout: 30_000 });

  await createForm(page, CHARLIE, "Charlie zebra");

  await openLibrary(page);
  expect(await listedSlugs(page)).toEqual([ALPHA, BRAVO, CHARLIE]);
});

test("names each row by its title, with the address under it and the id to copy", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openLibrary(page);

  await expect(page.getByRole("columnheader", { name: "Form ID" })).toHaveCount(0);

  const row = page.locator(`tr[data-form-slug="${ALPHA}"]`);
  await expect(row.getByRole("link", { name: "Open form Alpha zebra" })).toBeVisible();
  await expect(row.locator(".qcms-rowlead__address")).toHaveText(ALPHA);
  await expect(row.getByRole("button", { name: /^Copy form id frm_/u })).toBeVisible();
});

test("ends each row with a menu of that form's own screens", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openLibrary(page);

  const formId = await formIdOf(page, ALPHA);
  await openRowMenu(page, "Alpha zebra");

  const menu = rowMenu(page, "Alpha zebra");
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  await expect(menu.getByRole("menuitem", { name: "Form details" })).toHaveAttribute(
    "href",
    `/forms/${formId}`,
  );
  await expect(menu.getByRole("menuitem", { name: "Preview" })).toHaveAttribute(
    "href",
    `/forms/${formId}/preview`,
  );
  await expect(menu.getByRole("menuitem", { name: "Links" })).toHaveAttribute(
    "href",
    `/operations/forms/${formId}/links`,
  );
});

test("opens, walks and closes that menu from the keyboard alone", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openLibrary(page);

  const formId = await formIdOf(page, ALPHA);
  const trigger = rowMenuTrigger(page, "Alpha zebra");

  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = rowMenu(page, "Alpha zebra");
  await expect(menu).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(menu.getByRole("menuitem", { name: "Form details" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Preview" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/preview$`));
});

for (const width of [320, 390]) {
  test(`the row menu opens inside a ${String(width)}px viewport`, async ({ page }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, EMAIL, totpSecret);
    await page.setViewportSize({ width, height: 900 });
    await openLibrary(page);

    await openRowMenu(page, "Alpha zebra");
    await expect(
      rowMenu(page, "Alpha zebra").getByRole("menuitem", { name: "Links" }),
    ).toBeVisible();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `an open row menu fits ${String(width)} (SC 1.4.10)`,
    ).toBeLessThanOrEqual(width);
  });
}

test("searches the library from the toolbar, and puts the term in the URL", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/forms");

  await fillStable(field(page, "Search"), ALPHA);
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page).toHaveURL(new RegExp(`[?&]q=${ALPHA}`));
  expect(await listedSlugs(page)).toEqual([ALPHA]);
});

test("filters by status from the toolbar", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openLibrary(page);

  await chooseOption(page.locator("form.qcms-filters"), "Availability", "Closed");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page).toHaveURL(/[?&]status=closed/);
  expect(await listedSlugs(page)).toEqual([BRAVO]);

  await expect(page.getByRole("rowheader", { name: ALPHA })).toHaveCount(0);
});

test("sorts the library from the toolbar", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openLibrary(page);

  await chooseOption(page.locator("form.qcms-filters"), "Sort by", "Slug (Z to A)");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page).toHaveURL(/[?&]sort=slug-desc/);
  expect(await listedSlugs(page)).toEqual([CHARLIE, BRAVO, ALPHA]);
});

test("reopens a filtered library from its URL alone, controls and all", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await openLibrary(page, "&status=unreleased&sort=slug-desc");

  expect(await listedSlugs(page)).toEqual([CHARLIE, ALPHA]);

  const toolbar = page.locator("form.qcms-filters");
  await expect(field(page, "Search")).toHaveValue(SCOPE);

  await expect(toolbar.getByRole("button", { name: /Availability$/ })).toContainText(
    "Not Released",
  );
  await expect(toolbar.getByRole("button", { name: /Sort by$/ })).toContainText("Slug (Z to A)");
});

test("says something useful when the filters match nothing, and offers the way back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/forms");

  await fillStable(field(page, "Search"), `no-such-form-${RUN}`);
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByText("No form matches this search.")).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/forms$/);
  await expect(page.getByRole("table", { name: "Form library" })).toBeVisible();
});

test("the toolbar is reachable and operable from the keyboard alone", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openLibrary(page);

  await expect(field(page, "Search")).toBeVisible();
  const toolbar = page.locator("form.qcms-filters");
  await expect(toolbar.getByRole("button", { name: /Availability$/ })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: /Sort by$/ })).toBeVisible();

  await field(page, "Search").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`[?&]q=${SCOPE}`));
  expect(await listedSlugs(page)).toEqual([ALPHA, BRAVO, CHARLIE]);
});
