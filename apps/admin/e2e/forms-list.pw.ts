import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  chooseOption,
  createForm,
  field,
  savedStamp,
  waitForSaveAfter,
} from "./support/forms.js";

/**
 * The form library's search, status filter and sort, in the browser (issue 686).
 *
 * ## What only this layer can prove
 *
 * The render tests one directory over already prove that the screen hands the three
 * values to the API and reads them back out of the URL. What they cannot prove is that
 * the controls exist as controls: a vendored `Select` is a server-rendered button with a
 * hidden native `<select>` behind it, an author operates it by name, and the whole
 * toolbar is a `<form method="get">` whose Apply is a real navigation. So the assertions
 * here are the two properties a stubbed render cannot see - that pressing each control
 * and pressing Apply lands on a URL carrying that control's parameter, and that opening
 * such a URL cold reproduces the same view with the same controls showing the same
 * values.
 *
 * ## Why the fixtures are three forms and not one
 *
 * A sort is only observable across rows, and a filter is only observable when it removes
 * something that would otherwise be there. Three forms, one of them closed, is the
 * smallest set where each control has a visible effect: the search narrows by title as
 * well as by slug, the status filter separates the closed one from the open ones, and the
 * sort reverses an order long enough to be an order.
 *
 * Every assertion is scoped by this run's slug prefix, because the harness database
 * survives a rerun and holds whatever every other admin spec created.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("forms-list");

/** Set by the first test; every later test signs in with it. */
let totpSecret = "";

/** Ids are never reused (R6) and the harness database survives a local rerun. */
const RUN = Date.now().toString(36);

/**
 * A search term that selects this run's three forms and nothing else in a database every
 * other admin spec has also written to.
 *
 * The run id goes BEFORE the distinguishing letter, so this string is a real prefix of
 * all three slugs. With the letter in the middle the scope matched nothing and the
 * library came back empty, which is a false red that looks exactly like a broken filter.
 */
const SCOPE = `e2e-list-${RUN}`;

/** The three fixture forms, in slug order. Titles differ so the search can find them. */
const ALPHA = `${SCOPE}-a`;
const BRAVO = `${SCOPE}-b`;
const CHARLIE = `${SCOPE}-c`;

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** Open the library filtered to this run's forms, with any extra parameters appended. */
async function openLibrary(page: Page, extra = ""): Promise<void> {
  await page.goto(`/forms?q=${SCOPE}${extra}`);
  await expect(page.getByRole("heading", { name: "Forms", level: 1 })).toBeVisible();
}

/** The slugs on screen, in the order the table lists them. */
async function listedSlugs(page: Page): Promise<string[]> {
  const cells = page.getByRole("rowheader");
  return (await cells.allInnerTexts()).map((text) => text.trim());
}

/**
 * Create a form and make its title reach the stored draft.
 *
 * `POST /admin/forms` takes `formId`, `slug` and `defaultLocale` only, so the identity is
 * created with an EMPTY title and `/forms/new` carries what the author typed to the
 * builder in the query string. The builder seeds the working draft from it and the FIRST
 * AUTOSAVE is what persists it. So a form that has only just been created has no stored
 * title for the library's search to match, and the fixture has to make that save happen
 * rather than assume it: adding a step is the smallest edit that does, and waiting on the
 * save strip is what makes it a fact rather than a race.
 */
async function createSavedForm(page: Page, slug: string, title: string): Promise<void> {
  await createForm(page, slug, title);
  const before = await savedStamp(page);
  await addStep(page, "Only step");
  await waitForSaveAfter(page, before);
}

test("creates the library this spec reads, and closes one of its forms", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await createSavedForm(page, ALPHA, "Alpha zebra");

  // Bravo is the closed one, and it is closed here rather than later because
  // `createSavedForm` leaves the browser on the builder of the form it just made. Closing
  // needs no publish: it is the identity's own lifecycle, which is exactly what the
  // Status filter narrows on.
  await createSavedForm(page, BRAVO, "Bravo quokka");
  await page.getByRole("button", { name: "Close form" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Close it" }).click();
  await expect(page.getByTestId("qcms-form-closed")).toBeVisible({ timeout: 30_000 });

  await createSavedForm(page, CHARLIE, "Charlie zebra");

  await openLibrary(page);
  expect(await listedSlugs(page)).toEqual([ALPHA, BRAVO, CHARLIE]);
});

test("searches the library from the toolbar, and puts the term in the URL", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/forms");

  await fillStable(field(page, "Search"), ALPHA);
  await page.getByRole("button", { name: "Apply" }).click();

  // The term is in the address, which is what makes a filtered library a link.
  await expect(page).toHaveURL(new RegExp(`[?&]q=${ALPHA}`));
  expect(await listedSlugs(page)).toEqual([ALPHA]);
  await expect(page.getByTestId("qcms-forms-count")).toHaveText("1 form.");
});

test("searches the form title, which is not a column on this screen", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/forms");

  // The hint under the field promises the title as well as the slug, and the title lives
  // in the draft definition rather than on the row: this is the assertion that the
  // promise is kept by the API rather than by a substring test over what is rendered.
  await fillStable(field(page, "Search"), "quokka");
  await page.getByRole("button", { name: "Apply" }).click();

  expect(await listedSlugs(page)).toEqual([BRAVO]);
});

test("filters by status from the toolbar", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openLibrary(page);

  await chooseOption(page.locator("form.qcms-filters"), "Status", "Closed");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page).toHaveURL(/[?&]status=closed/);
  expect(await listedSlugs(page)).toEqual([BRAVO]);

  // The narrowing is the API's, so it survives the round trip rather than hiding rows in
  // the browser: the two open forms exist and match the search, and must still be gone.
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

  // No interaction with the toolbar at all: this is the bookmark case, and it has to
  // reproduce both the rows and the state of the three controls that produced them.
  await openLibrary(page, "&status=open&sort=slug-desc");

  expect(await listedSlugs(page)).toEqual([CHARLIE, ALPHA]);
  await expect(page.getByTestId("qcms-forms-count")).toHaveText("2 forms.");

  const toolbar = page.locator("form.qcms-filters");
  await expect(field(page, "Search")).toHaveValue(SCOPE);
  // A `Select` trigger announces its current value followed by its label, so the value
  // is what the button reads out - which is what an author navigating by name hears.
  await expect(toolbar.getByRole("button", { name: /Status$/ })).toContainText("Open");
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

  // A search that matches nothing is a different state from a library with no forms in
  // it, and says so: offering "create the first form" to someone whose library is full
  // would be noise.
  await expect(page.getByText("No form matches this search.")).toBeVisible();
  await expect(page.getByTestId("qcms-forms-count")).toHaveCount(0);

  // One control with that name, not two: the panel carries it while the toolbar's link
  // stands down.
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/forms$/);
  await expect(page.getByRole("table", { name: "Form library" })).toBeVisible();
});

test("the toolbar is reachable and operable from the keyboard alone", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openLibrary(page);

  // Every control is named, which is what a screen-reader user navigates by. Asserting
  // the accessible names resolve is the check axe cannot make: axe sees a labelled
  // control, not whether the label is the one an author would look for.
  await expect(field(page, "Search")).toBeVisible();
  const toolbar = page.locator("form.qcms-filters");
  await expect(toolbar.getByRole("button", { name: /Status$/ })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: /Sort by$/ })).toBeVisible();

  // Apply from the keyboard, without ever pointing at it: a native submit, so Enter in
  // the search field is enough and no handler has to be attached for it to work.
  await field(page, "Search").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`[?&]q=${SCOPE}`));
  expect(await listedSlugs(page)).toEqual([ALPHA, BRAVO, CHARLIE]);
});
