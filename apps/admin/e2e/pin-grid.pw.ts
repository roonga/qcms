import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addOption, confirmLifecycle, createDraft, useRowMenu } from "./support/questions.js";
import {
  addStep,
  createForm,
  openStep,
  pickerChoice,
  pickerCommit,
  pinGrip,
  pinLabel,
  pinQuestion,
  pinRowMenuItem,
  pinnedOrder,
  usePinRowMenu,
  waitForSaved,
} from "./support/forms.js";

/**
 * The step editor's pin list as the ownership grid (issue 517).
 *
 * ## What is here and what is not
 *
 * The ownership CONTRAST is structural and is asserted where it can be seen whole, over
 * the rendered markup, in `components/forms/pin-grid-ownership.test.tsx` (ADR-23: the
 * highest layer that exists for the thing under test). What needs a real browser is
 * everything below, and only that:
 *
 * - the grip menu's five entries, which exist only while the popup is open;
 * - keyboard reorder, which is a key event moving a row and carrying focus with it;
 * - insert-below, which is the menu item that makes a row-boundary insert affordance
 *   legal under WCAG 2.2 SC 2.5.8 and which has to pin into the slot it named;
 * - remove, and where focus lands afterwards;
 * - **the version pin still being operable at 390**, which is the acceptance criterion
 *   a unit test cannot honestly claim, because it is a question about layout.
 *
 * ## The 390 test is a layout claim, so it is measured rather than asserted
 *
 * `plan/admin-mobile-stance.md` item 5 puts "change a question's version pin" on the
 * supported-at-390 path, and the Version column therefore never drops even though Type
 * and Issues do. The last test drives the whole move at a 390px viewport AND measures
 * `document.documentElement.scrollWidth`, because a control reachable only by scrolling
 * the page sideways has failed WCAG 2.2 AA SC 1.4.10 on the way to passing the stance,
 * and axe does not test 1.4.10, so nothing else would catch it.
 *
 * The viewport is set BEFORE the navigation rather than after it. The pin list keys its
 * drops off a media query and would reflow on a resize either way, but issue #575 records
 * a live-resize frame being sampled before a container-query screen settled, and loading
 * at the target width costs nothing and cannot be wrong.
 *
 * ## Why the questions are authored rather than taken from the seed
 *
 * The harness seed creates question versions and leaves them as DRAFTS (`seed.ts` publishes
 * the FORM version, not the library rows). A form can only pin published versions (022,
 * R7), so a spec that pinned a seeded question would find an empty picker. The library is
 * therefore authored through the UI the way an author builds one, which also gives the
 * version test what it needs: one question with v1 and v2 both published, so "move this
 * pin to another version" has somewhere to go.
 *
 * ## One form, mutated in order
 *
 * The tests run serially and each leaves the step as the next one expects it: the reorder
 * puts the order back, the insert adds the fourth pin the remove takes out again. That is
 * cheaper than rebuilding a four-question library per test by a wide margin, and it reads
 * as one author's session, which is what it is.
 */

const EMAIL = uniqueAdminEmail("pingrid");
const RUN = Date.now().toString(36).slice(-5);

const COVER = `pg-cover-${RUN}`;
const COUNT = `pg-count-${RUN}`;
const NOTES = `pg-notes-${RUN}`;
const EXTRA = `pg-extra-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

const COVER_ID = questionIdFor(COVER);
const COUNT_ID = questionIdFor(COUNT);
const NOTES_ID = questionIdFor(NOTES);
const EXTRA_ID = questionIdFor(EXTRA);

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";
/** The builder path of the form the rest of this file edits. */
let builderPath = "";

async function openBuilder(page: Page): Promise<void> {
  await page.goto(builderPath);
  await openStep(page, "Driving history");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("authors the library and the step the rest of this file edits", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  // v1 and v2 both published, so the version pin has a second version to move to.
  await createDraft(page, COVER, "Single choice");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2$/);
  // Added before the originals go: the kernel requires a choice question to declare at
  // least one option, so the editor refuses to remove the last one.
  await addOption(page, "Full cover");
  await addOption(page, "Basic cover");
  await useRowMenu(page, 0, /^Remove option /);
  await useRowMenu(page, 0, /^Remove option /);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await confirmLifecycle(page, /^Publish version 2$/, "Publish");

  await createDraft(page, COUNT, "Number");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, NOTES, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, EXTRA, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await createForm(page, `pin-grid-${RUN}`, "Vehicle insurance");
  builderPath = new URL(page.url()).pathname;
  await addStep(page, "Driving history");
  await pinQuestion(page, COVER_ID, 1);
  await pinQuestion(page, COUNT_ID, 1);
  await pinQuestion(page, NOTES_ID, 1);
  await waitForSaved(page);

  expect(await pinnedOrder(page)).toEqual([COVER_ID, COUNT_ID, NOTES_ID]);
});

test("the grip menu offers insert above, insert below, move up, move down and remove", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openBuilder(page);

  await pinGrip(page, COUNT_ID).click();
  const menu = page.getByRole("menu", { name: `Row actions for ${COUNT_ID}` });
  await expect(menu).toBeVisible();

  // All five, in order, each naming its own row so two rows' menus stay distinguishable.
  await expect(menu.getByRole("menuitem")).toHaveText([
    `Insert a question above ${COUNT_ID}`,
    `Insert a question below ${COUNT_ID}`,
    `Move ${COUNT_ID} up`,
    `Move ${COUNT_ID} down`,
    `Remove ${COUNT_ID}`,
  ]);

  // Insert above and insert below are never disabled: they are the equivalent controls a
  // row-boundary insert affordance leans on under SC 2.5.8.
  await expect(
    menu.getByRole("menuitem", { name: `Insert a question above ${COUNT_ID}` }),
  ).toBeEnabled();
  await expect(
    menu.getByRole("menuitem", { name: `Insert a question below ${COUNT_ID}` }),
  ).toBeEnabled();

  // Escape closes it and hands focus back to the grip, so a keyboard operator is never
  // left inside a closed popup.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(pinGrip(page, COUNT_ID)).toBeFocused();
});

/**
 * The two tests below are the roving-focus half of the SC 2.5.8 argument this whole
 * redesign rests on.
 *
 * Insert above and insert below are what make a row-boundary insert affordance legal at a
 * hairline target size: they are the equivalent controls the exception points at. An
 * equivalent control that a keyboard cannot reach is not an equivalent control, so the
 * menu's arrow keys reaching every live item is part of the acceptance criterion rather
 * than a nicety on top of it.
 *
 * A disabled `<button>` cannot take focus, so `.focus()` on one does nothing at all. This
 * menu's items are the caller's, in the caller's order, and the pin list puts Move up and
 * Move down in the MIDDLE and disables them at the ends of the list. The two configurations
 * that strand items are therefore the first row of any step (Move up dead) and a step with
 * one pin (both moves dead), and each has its own test below because they fail differently:
 * the first loses Move down and Remove, the second loses Remove, which is the only route
 * to unpinning a question at all.
 *
 * Both are stated as "the next press lands HERE", not as "the menu has five items", so a
 * regression reports the dead end rather than a count.
 */
test("the menu's arrow keys skip a disabled item on the first row of a step", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openBuilder(page);
  expect(await pinnedOrder(page)).toEqual([COVER_ID, COUNT_ID, NOTES_ID]);

  // First row of the step, so Move up is the dead item and it sits third of five.
  await pinGrip(page, COVER_ID).click();
  await expect(pinRowMenuItem(page, "moveUp")).toBeDisabled();
  await expect(pinRowMenuItem(page, "insertAbove")).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "insertBelow")).toBeFocused();

  // The press that used to do nothing. Move down and Remove live behind Move up, so
  // before this fix a keyboard operator stopped here and every further press was a no-op.
  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "moveDown")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "remove")).toBeFocused();

  // Backwards over the same gap, and the wrap in both directions, because roving is a
  // ring: an implementation that only special-cased "forwards" would pass the four above.
  await page.keyboard.press("ArrowUp");
  await expect(pinRowMenuItem(page, "moveDown")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(pinRowMenuItem(page, "insertBelow")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(pinRowMenuItem(page, "insertAbove")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(pinRowMenuItem(page, "remove")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "insertAbove")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(pinGrip(page, COVER_ID)).toBeFocused();
});

test("keyboard reorder still works, and the grip keeps focus across the move", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openBuilder(page);
  expect(await pinnedOrder(page)).toEqual([COVER_ID, COUNT_ID, NOTES_ID]);

  const grip = pinGrip(page, COVER_ID);
  await grip.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COUNT_ID, COVER_ID, NOTES_ID]);

  // The row is keyed by its question id, so React relocates the existing node and the grip
  // the operator is holding travels with it already focused. That is what makes a second
  // press move the same pin again rather than walking a fixed slot.
  await expect(grip).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COUNT_ID, NOTES_ID, COVER_ID]);
  await expect(grip).toBeFocused();

  // And back where it started, by the menu's single-pointer path rather than by the keys.
  await usePinRowMenu(page, COVER_ID, "moveUp");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COUNT_ID, COVER_ID, NOTES_ID]);
  await usePinRowMenu(page, COVER_ID, "moveUp");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COVER_ID, COUNT_ID, NOTES_ID]);
  await waitForSaved(page);
});

test("insert below pins into the slot it named, not onto the end", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openBuilder(page);

  await usePinRowMenu(page, COVER_ID, "insertBelow");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await pickerChoice(dialog, EXTRA_ID, 1).check();
  await pickerCommit(dialog, 1).click();
  await expect(dialog).toBeHidden();

  // Second, because that is the boundary the menu item named. Appending would put it last.
  await expect
    .poll(async () => pinnedOrder(page))
    .toEqual([COVER_ID, EXTRA_ID, COUNT_ID, NOTES_ID]);
  await waitForSaved(page);
});

test("remove takes the pin out and leaves focus on a neighbouring grip", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openBuilder(page);

  await usePinRowMenu(page, EXTRA_ID, "remove");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COVER_ID, COUNT_ID, NOTES_ID]);

  // Not `<body>`: a removed row takes the focused element with it, and the browser's
  // default is to strand a keyboard operator at the top of the document.
  await expect(pinGrip(page, COVER_ID)).toBeFocused();
  await waitForSaved(page);
});

test("the version pin is operable at 390, and the page never scrolls sideways", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // Loaded AT 390 rather than resized into it (issue #575).
  await page.setViewportSize({ width: 390, height: 844 });
  await openBuilder(page);
  await expect(pinLabel(page, COVER_ID, 1)).toBeVisible();

  // The two columns that DESCRIBE a row are gone at this width and the one that lets an
  // author change what the form serves is not. That is `plan/admin-mobile-stance.md`
  // item 5, stated as a layout rule and tested as one.
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeHidden();
  await expect(page.getByRole("columnheader", { name: "Issues" })).toBeHidden();
  await expect(page.getByRole("columnheader", { name: "Version" })).toBeVisible();

  const trigger = page.getByRole("button", { name: `Move pin for ${COVER_ID}` });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole("menuitem", { name: "Move to v2", exact: true }).click();
  await expect(pinLabel(page, COVER_ID, 2)).toBeVisible();
  await waitForSaved(page);

  // Reaching the control by scrolling the page sideways is not "operable at 390": that is
  // SC 1.4.10 Reflow, which axe does not test, so it is measured here.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, "the builder must not scroll horizontally at 390").toBeLessThanOrEqual(390);
});

test("on a single-pin step, Remove is still reachable with both moves disabled", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // Its own step rather than unpinning "Driving history" down to one: this runs last, and
  // a step the earlier tests never open cannot change what any of them saw.
  await page.goto(builderPath);
  await addStep(page, "Excess");
  await openStep(page, "Excess");
  await pinQuestion(page, EXTRA_ID, 1);
  await waitForSaved(page);
  expect(await pinnedOrder(page)).toEqual([EXTRA_ID]);

  // The worst case for roving: the only row is both the first and the last, so TWO
  // adjacent items are dead and Remove sits behind both of them. Remove is the only route
  // to unpinning a question, so losing it here is a keyboard operator unable to undo a pin.
  await pinGrip(page, EXTRA_ID).click();
  await expect(pinRowMenuItem(page, "moveUp")).toBeDisabled();
  await expect(pinRowMenuItem(page, "moveDown")).toBeDisabled();
  await expect(pinRowMenuItem(page, "insertAbove")).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "insertBelow")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(pinRowMenuItem(page, "remove")).toBeFocused();

  // Reachable is not the same as operable, so it is pressed rather than merely focused:
  // Remove is never disabled on a pin row (unlike the option grid's, which a one-option
  // list turns off), so the key that reaches it must also be able to fire it.
  await page.keyboard.press("Enter");
  await expect.poll(async () => pinnedOrder(page)).toEqual([]);
  await waitForSaved(page);
});
