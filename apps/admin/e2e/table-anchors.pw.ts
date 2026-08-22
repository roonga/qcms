import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  openStep,
  pickerAddButton,
  pinLabel,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/**
 * Issue 570: the converted tables' rows are reachable without a mouse and without
 * JavaScript.
 *
 * `plan/admin-design-contracts.md` §2 asks the row's identifying cell for "a real anchor
 * (open-in-new-tab and no-JS work)". `app/(shell)/table-anchors.test.tsx` proves the anchor
 * is in the server HTML with a resolvable `href`, which is the same statement made about a
 * string. This spec makes it about a browser, which is the layer ADR-23 assigns to
 * behaviour a browser is the only thing that performs.
 *
 * ## The two claims, and the two ways they are made
 *
 * **Without JavaScript.** The `without JavaScript` block runs with scripting switched off
 * for the whole context, follows a link in each of the three navigating tables and asserts
 * the destination. This is the claim the defect was about: before this change a whole-row
 * click handler was the only route into a question or a form, and a handler is not a link
 * however much it behaves like one for a mouse user. The auth screens have always been
 * native forms (issue 031's decision, restated by the 2026-07-31 sign-out ruling), so the
 * whole loop below - sign in, list, open - runs with no client JavaScript whatsoever.
 *
 * **From the keyboard.** Tabbing to the control rather than focusing it directly, because
 * `focus()` proves only that a node accepts focus and a keyboard author has the document's
 * tab order and nothing else. Middle-click and "open in new tab" are not tested as gestures
 * for a deliberate reason: they are the browser acting on an `href`, so testing them would
 * be testing Chromium. What is testable, and is tested, is that the thing under the cursor
 * IS an anchor with a real destination rather than a row that reacts to a click.
 *
 * ## Why the picker is here and is different
 *
 * `components/forms/library-picker.tsx` has no address to link to: choosing a row adds a
 * pin to the draft the author is editing. Its rows carry a named button instead, and the
 * reasoning is on the component. The claim made about it here is the one §2 actually wants
 * from an anchor - a real, announced, keyboard-operable control - and no no-JS claim at
 * all, because a modal dialog over client-held draft state has never had one to make.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("anchors570");
const RUN = Date.now().toString(36);

/** The seeded insurance fixture: already published, so it has a version history to read. */
const SEEDED_FORM_ID = "frm_auto_quote";

const PICKER_SLUG = `anchors570-pick-${RUN}`;

/** Set by the first test, which enrolls the account every later test signs in with. */
let totpSecret = "";
/** The form the picker test opens, built by the first test. */
let pickerFormId = "";

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/**
 * Tab from wherever focus is until `target` has it, or give up.
 *
 * The budget is generous rather than tuned: what this is proving is membership of the tab
 * order, so the only outcomes that matter are "arrived" and "never arrives". A regression
 * that drops the control out of the order exhausts the budget and fails on the assertion
 * after the loop, naming the control.
 */
async function tabTo(page: Page, target: Locator, budget = 60): Promise<void> {
  for (let step = 0; step < budget; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
}

test("every converted table's row control is in the document's own tab order", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  // A form can only pin PUBLISHED versions (022), so the library is authored first.
  await createDraft(page, PICKER_SLUG, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  pickerFormId = await createForm(page, `anchors570-form-${RUN}`, "Anchors 570");
  await addStep(page, "Only step");
  // A step lives in the autosaved draft. Leaving the builder before the save lands and
  // coming back finds a form with no step, and the picker test below has nothing to open.
  await waitForSaved(page);

  // 1. The question library. The identifying cell is the ID, and the anchor's accessible
  //    name says where it goes rather than repeating the id a screen reader has just read
  //    from the row header.
  await page.goto(`/questions?q=${PICKER_SLUG}`);
  const questionLink = page.getByRole("link", {
    name: `Open question ${questionIdFor(PICKER_SLUG)}`,
  });
  await expect(questionLink).toHaveAttribute("href", `/questions/${questionIdFor(PICKER_SLUG)}`);
  await tabTo(page, questionLink);
  await expect(questionLink, "the question library's row link is reachable by Tab").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(questionIdFor(PICKER_SLUG)));

  // 2. The form library. The identifying cell is the SLUG, so the link text is a name and
  //    not a hex string, and the form id keeps a column of its own.
  await page.goto("/forms");
  const formLink = page.getByRole("link", { name: `Open form anchors570-form-${RUN}` });
  await expect(formLink).toHaveAttribute("href", `/forms/${pickerFormId}`);
  await tabTo(page, formLink);
  await expect(formLink, "the form library's row link is reachable by Tab").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(pickerFormId));

  // 3. The version history, where the link used to live in a list underneath the table.
  await page.goto(`/forms/${SEEDED_FORM_ID}/versions`);
  const versionLink = page.getByRole("link", { name: "View v1" });
  await expect(versionLink).toHaveAttribute("href", `/forms/${SEEDED_FORM_ID}/versions/1`);
  await tabTo(page, versionLink);
  await expect(versionLink, "the version history's row link is reachable by Tab").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/versions/1$`));
});

test("the picker's row control is a named button a keyboard can operate", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${pickerFormId}`);
  await openStep(page, "Only step");

  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Named by the row it acts on, not "Add" repeated down a column. This is the property
  // §2's amendment asks of an identifying column's copy control, for the same reason: a
  // control announced identically on every row tells a screen-reader author nothing.
  const add = pickerAddButton(dialog, questionIdFor(PICKER_SLUG), 1);
  await expect(add).toBeVisible();

  // Space, not Enter. A `<button>` takes both and an `<a href>` takes only Enter, so this
  // is the assertion that would notice the control quietly becoming a link-shaped thing.
  await tabTo(page, add);
  await expect(add, "the picker's add button is reachable by Tab").toBeFocused();
  await page.keyboard.press("Space");

  await expect(dialog).toBeHidden();
  await expect(pinLabel(page, questionIdFor(PICKER_SLUG), 1)).toBeVisible();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the three navigating tables open their rows with scripting off", async ({ page }) => {
    test.setTimeout(240_000);
    await signInWithTotp(page, EMAIL, totpSecret);

    // The question library. Nothing on this page has hydrated, and nothing needs to: the
    // route is in the server HTML, which is exactly what `onRowAction` never put there.
    await page.goto(`/questions?q=${PICKER_SLUG}`);
    await expect(page.getByRole("table", { name: "Question library" })).toBeVisible();
    await page.getByRole("link", { name: `Open question ${questionIdFor(PICKER_SLUG)}` }).click();
    await expect(page).toHaveURL(new RegExp(questionIdFor(PICKER_SLUG)));

    // The form library.
    await page.goto("/forms");
    await expect(page.getByRole("table", { name: "Form library" })).toBeVisible();
    await page.getByRole("link", { name: `Open form anchors570-form-${RUN}` }).click();
    await expect(page).toHaveURL(new RegExp(pickerFormId));

    // The version history. Its rows were never the control, but its view links were a
    // separate list beside the table; the claim here is that folding them into the rows
    // did not cost the no-JS path that list already had.
    await page.goto(`/forms/${SEEDED_FORM_ID}/versions`);
    await expect(page.getByRole("table", { name: "Published versions" })).toBeVisible();
    await page.getByRole("link", { name: "View v1" }).click();
    await expect(page).toHaveURL(/\/versions\/1$/);
  });
});
