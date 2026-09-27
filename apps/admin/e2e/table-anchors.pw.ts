import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin } from "./support/flow.js";
import {
  addStep,
  createForm,
  openStep,
  pickerChoice,
  pickerCommit,
  pinLabel,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/**
 * Issue 570: the converted tables' rows are reachable without a mouse.
 *
 * `plan/admin-design-contracts.md` §2 asks the row's identifying cell for "a real anchor
 * (open-in-new-tab and middle-click work)". `app/(shell)/table-anchors.test.tsx` proves the anchor
 * is in the server HTML with a resolvable `href`, which is the same statement made about a
 * string. This spec makes it about a browser, which is the layer ADR-23 assigns to
 * behaviour a browser is the only thing that performs.
 *
 * ## The claim, and the way it is made
 *
 * **It used to be made two ways.** A `without JavaScript` block ran with scripting switched
 * off for the whole context and followed a link in each of the three navigating tables. It
 * is deleted, and the note where it stood says why: the admin requires JavaScript now (Code
 * Owner, 2026-09-27), and the keyboard walk below already asserts the same three `href`s and
 * the same three destinations.
 *
 * The defect the spec exists for is untouched by that. Before issue 570 a whole-row click
 * handler was the only route into a question or a form, and a handler is not a link however
 * much it behaves like one for a mouse user: it cannot be opened in a new tab, it cannot be
 * middle-clicked, and it has no address to read. All three are true with scripting fully on,
 * which is why the claim outlives the ruling and the scriptless walk does not.
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
 * `components/forms/library-picker.tsx` has no address to link to: choosing a row stages a
 * pin for the draft the author is editing. Its rows carry a named CHECKBOX since issue 660
 * made the dialog multi-select, and the reasoning is on the component. The claim made about
 * it here is the one §2 actually wants from an anchor - a real, announced,
 * keyboard-operable, named control - and no no-JS claim at all, because a modal dialog over
 * client-held draft state has never had one to make.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("anchors570");
const RUN = Date.now().toString(36);

/** The seeded insurance fixture: already published, so it has a version history to read. */
const SEEDED_FORM_ID = "frm_auto_quote";

const PICKER_SLUG = `anchors570-pick-${RUN}`;

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
  // Enrolled rather than signed in: enforced 2FA sends a fresh account to enrollment, and
  // this file has one test, so the secret it returns has no later reader.
  await enrollNewAdmin(page, EMAIL);

  // A form can only pin PUBLISHED versions (022), so the library is authored first.
  await createDraft(page, PICKER_SLUG, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  pickerFormId = await createForm(page, `anchors570-form-${RUN}`, "Anchors 570");
  await addStep(page, "Only step");

  // 1. The picker, from the builder this walk is already standing on. It comes first and
  //    stays in place on purpose: a step lives in the autosaved draft, so navigating away
  //    and back finds a form with no step whenever the debounce has not landed.
  //
  //    Named by the row it acts on, not "Add" repeated down a column. That is the property
  //    §2's amendment asks of an identifying column's copy control, for the same reason: a
  //    control announced identically on every row tells a screen-reader author nothing.
  await openStep(page, "Only step");
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const choice = pickerChoice(dialog, questionIdFor(PICKER_SLUG), 1);
  await expect(choice).toBeVisible();

  //    Space, not Enter. A checkbox toggles on Space and an `<a href>` activates on Enter
  //    only, so this is the assertion that would notice the control quietly becoming a
  //    link-shaped thing. The choice is then committed by the dialog's own button, which
  //    is where "a button acts" now lives.
  await tabTo(page, choice);
  await expect(choice, "the picker's row control is reachable by Tab").toBeFocused();
  await page.keyboard.press("Space");
  await expect(choice, "Space toggles it, as a checkbox and not a link").toBeChecked();
  await pickerCommit(dialog, 1).click();
  await expect(dialog).toBeHidden();
  await expect(pinLabel(page, questionIdFor(PICKER_SLUG), 1)).toBeVisible();

  // 2. The question library. The identifying cell is the ID, and the anchor's accessible
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

  // 3. The form library. The identifying cell is the SLUG, so the link text is a name and
  //    not a hex string, and the form id keeps a column of its own.
  await page.goto("/forms");
  const formLink = page.getByRole("link", { name: `Open form anchors570-form-${RUN}` });
  await expect(formLink).toHaveAttribute("href", `/forms/${pickerFormId}`);
  await tabTo(page, formLink);
  await expect(formLink, "the form library's row link is reachable by Tab").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(pickerFormId));

  // 4. The version history, where the link used to live in a list underneath the table.
  await page.goto(`/forms/${SEEDED_FORM_ID}/versions`);
  const versionLink = page.getByRole("link", { name: "View v1" });
  await expect(versionLink).toHaveAttribute("href", `/forms/${SEEDED_FORM_ID}/versions/1`);
  await tabTo(page, versionLink);
  await expect(versionLink, "the version history's row link is reachable by Tab").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/versions/1$`));
});

/*
 * A `without JavaScript` block stood here and is DELETED (Code Owner, 2026-09-27: the admin
 * requires JavaScript and stops at a message without it,
 * `plan/admin-design-contracts.md`). It signed in with scripting off and clicked a row link
 * in each of the three navigating tables, asserting each destination.
 *
 * Its claim is kept and nothing is converted, because the test above already makes the
 * whole of it with scripting on: for each of the three tables it asserts the row control is
 * an `<a>` carrying the exact `href` the route resolves to, and then activates it and
 * asserts the destination. The scriptless walk added the same three destinations a second
 * time. What the deleted block uniquely reached - a browser following an anchor with no
 * bundle loaded - is now unreachable by construction, since `e2e/requires-js.pw.ts` asserts
 * a scriptless operator never gets past the message.
 *
 * The surviving argument for an anchor is the one the 2026-08-22 correction left standing:
 * open-in-new-tab and middle-click are the browser acting on an `href`, and a row that
 * reacts to a click has none to act on. That is `href`-shaped rather than scripting-shaped,
 * and it is what the assertions above check.
 */
