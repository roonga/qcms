import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  pinGrip,
  pinLabel,
  pinQuestion,
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
 * - remove, and where focus lands afterwards;
 * - insert-below, which is the menu item that makes the row-boundary insert affordance
 *   legal under WCAG 2.2 SC 2.5.8 and which has to actually pin into the right slot;
 * - **the version pin still being operable at 390**, which is the acceptance criterion
 *   that a unit test cannot honestly claim, because it is a question about layout.
 *
 * ## The 390 test is a layout claim, so it is measured rather than asserted
 *
 * `plan/admin-mobile-stance.md` item 5 puts "change a question's version pin" on the
 * supported-at-390 path, and the Version column therefore never drops even though Type and
 * Issues do. The test below drives the whole move at a 390px viewport AND measures
 * `document.documentElement.scrollWidth`, because a control that is reachable only by
 * scrolling the page sideways has failed WCAG 2.2 AA SC 1.4.10 on the way to passing the
 * stance - and axe does not test 1.4.10, so nothing else would catch it.
 *
 * The viewport is set BEFORE the navigation rather than after it. The pin list keys its
 * drops off a media query and would reflow on a resize either way, but issue #575 records
 * a live-resize frame being sampled before a container-query screen settled, and loading
 * at the target width costs nothing and cannot be wrong.
 *
 * ## The questions are the seeded library, not new ones
 *
 * `q_at_fault_accident` is seeded with v1 and v2 both published, which is exactly what the
 * version-pin test needs and what nothing else in this suite provides for free (R7: only
 * published versions are pinnable, and a pin never auto-upgrades).
 */

const EMAIL = uniqueAdminEmail("pingrid");
const TAIL = Date.now().toString(36).slice(-5);

const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";
const DOB = "q_dob";

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";

/** Build a one-step form holding the three seeded pins, and return its builder URL. */
async function buildStep(page: Page, slug: string): Promise<string> {
  await createForm(page, slug, "Pin grid");
  await addStep(page, "Driving history");
  await pinQuestion(page, ACCIDENT, 1);
  await pinQuestion(page, COUNT, 1);
  await pinQuestion(page, DOB, 1);
  await waitForSaved(page);
  return page.url();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the account the rest of this file signs in with", async ({ page }) => {
  test.setTimeout(180_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  expect(totpSecret.length, "the enrollment produced a TOTP secret").toBeGreaterThan(0);
});

test("the grip menu offers insert above, insert below, move up, move down and remove", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await buildStep(page, `pins-menu-${TAIL}`);

  await pinGrip(page, COUNT).click();
  const menu = page.getByRole("menu", { name: `Row actions for ${COUNT}` });
  await expect(menu).toBeVisible();

  // All five, in order, each naming its own row so two rows' menus stay distinguishable.
  await expect(menu.getByRole("menuitem")).toHaveText([
    `Insert a question above ${COUNT}`,
    `Insert a question below ${COUNT}`,
    `Move ${COUNT} up`,
    `Move ${COUNT} down`,
    `Remove ${COUNT}`,
  ]);

  // Insert above and insert below are never disabled: they are the equivalent controls
  // the row-boundary insert affordance leans on under SC 2.5.8.
  await expect(
    menu.getByRole("menuitem", { name: `Insert a question above ${COUNT}` }),
  ).toBeEnabled();
  await expect(
    menu.getByRole("menuitem", { name: `Insert a question below ${COUNT}` }),
  ).toBeEnabled();

  // Escape closes it and hands focus back to the grip, so a keyboard operator is never
  // left inside a closed popup.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(pinGrip(page, COUNT)).toBeFocused();
});

test("keyboard reorder still works, and the grip keeps focus across the move", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await buildStep(page, `pins-keys-${TAIL}`);

  expect(await pinnedOrder(page)).toEqual([ACCIDENT, COUNT, DOB]);

  const grip = pinGrip(page, ACCIDENT);
  await grip.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COUNT, ACCIDENT, DOB]);

  // The row is keyed by its question id, so React relocates the existing node and the
  // grip the operator is holding travels with it already focused. That is what makes a
  // second press move the same pin again rather than walking a fixed slot.
  await expect(grip).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COUNT, DOB, ACCIDENT]);
  await expect(grip).toBeFocused();

  // And back, by the menu's single-pointer path rather than by the keys.
  await usePinRowMenu(page, ACCIDENT, "moveUp");
  await expect.poll(async () => pinnedOrder(page)).toEqual([COUNT, ACCIDENT, DOB]);
});

test("insert below pins into the slot it named, not onto the end", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createForm(page, `pins-insert-${TAIL}`, "Pin grid insert");
  await addStep(page, "Driving history");
  await pinQuestion(page, ACCIDENT, 1);
  await pinQuestion(page, DOB, 1);
  await waitForSaved(page);
  expect(await pinnedOrder(page)).toEqual([ACCIDENT, DOB]);

  await usePinRowMenu(page, ACCIDENT, "insertBelow");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("row")
    .filter({ hasText: COUNT })
    .filter({ hasText: "v1" })
    .first()
    .click();
  await expect(dialog).toBeHidden();

  // Between the two, because that is the boundary the menu item named.
  await expect.poll(async () => pinnedOrder(page)).toEqual([ACCIDENT, COUNT, DOB]);
});

test("remove takes the pin out and leaves focus on a neighbouring grip", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await buildStep(page, `pins-remove-${TAIL}`);

  await usePinRowMenu(page, COUNT, "remove");
  await expect.poll(async () => pinnedOrder(page)).toEqual([ACCIDENT, DOB]);

  // Not `<body>`: a removed row takes the focused element with it, and the default is to
  // strand a keyboard operator at the top of the document with no announcement.
  await expect(pinGrip(page, ACCIDENT)).toBeFocused();
});

test("the version pin is operable at 390, and the page never scrolls sideways", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const builder = await buildStep(page, `pins-390-${TAIL}`);

  // Loaded AT 390 rather than resized into it (issue #575).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(builder);
  await expect(pinLabel(page, ACCIDENT, 1)).toBeVisible();

  // The two columns that DESCRIBE a row are gone at this width, and the one that lets an
  // author change what the form serves is not. That is `plan/admin-mobile-stance.md`
  // item 5, stated as a layout rule and tested as one.
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeHidden();
  await expect(page.getByRole("columnheader", { name: "Issues" })).toBeHidden();
  await expect(page.getByRole("columnheader", { name: "Version" })).toBeVisible();

  const trigger = page.getByRole("button", { name: `Move pin for ${ACCIDENT}` });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole("menuitem", { name: "Move to v2", exact: true }).click();
  await expect(pinLabel(page, ACCIDENT, 2)).toBeVisible();
  await waitForSaved(page);

  // Reaching the control by scrolling the page sideways is not "operable at 390": that is
  // SC 1.4.10 Reflow, which axe does not test, so it is measured here.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, "the builder must not scroll horizontally at 390").toBeLessThanOrEqual(390);
});
