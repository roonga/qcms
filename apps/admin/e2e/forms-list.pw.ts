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

async function listedSlugs(page: Page): Promise<string[]> {
  const cells = page.getByRole("rowheader");
  return (await cells.allInnerTexts()).map((text) => text.trim());
}

// POST creates an empty title; a builder title reaches storage only through a persistable draft's autosave.
// These fixtures test identity slugs without constructing published questions just to save titles.

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
