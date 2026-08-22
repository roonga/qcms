import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addOption,
  chooseType,
  confirmLifecycle,
  createDraft,
  field,
  fillDate,
  grip,
  insertOptionAbove,
  moveOptionByKey,
  openRowMenuByPointer,
  optionIds,
  pendingRow,
  setNumericConstraint,
  useRowMenu,
} from "./support/questions.js";

/**
 * The question library, driven through the browser (task 032, exit criteria 1 and 2).
 *
 * The centrepiece is a full lifecycle walk over **all seven question types**: create a
 * draft, publish it, open version 2, deprecate version 1. Seven types is not thoroughness
 * for its own sake - each renders a different constraint panel and compiles to a different
 * A2UI control, so a type-specific break (a panel that throws, a definition shape the
 * kernel refuses) is invisible to a walk that only exercises short text. It has to be a
 * browser test rather than a slice test because what is under examination is the assembly:
 * an editor holding a document, a server action forwarding it, the kernel judging it, and
 * the answer landing back on the right field.
 *
 * Everything runs in one signed-in session rather than one per type. Enforced 2FA makes a
 * sign-in three navigations plus a TOTP generation, so seven of them would cost more wall
 * clock than the assertions they carry.
 *
 * `fillStable` everywhere rather than `fill`, for the reason issue #210 records: under
 * `next dev` a route compiled on demand can replace the document after Playwright has
 * typed into it, and the empty required field that results fails a silent browser
 * constraint check much later, as a timeout on a screen the test thought it had left.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("questions");

/** Set by the first test; every later test signs in with it. */
let totpSecret = "";

/**
 * A per-run slug suffix.
 *
 * Question ids are never reused (R6) and the harness database can be reused across local
 * runs, so a fixed slug would make the second run fail with `QUESTION_ID_REUSED` on a
 * screen that is working perfectly. This makes each run's ids its own.
 */
const RUN = Date.now().toString(36);

/** The seven types, by the label the picker shows. */
const TYPES = [
  { slug: "short-text", label: "Short text" },
  { slug: "long-text", label: "Long text" },
  { slug: "number", label: "Number" },
  { slug: "date", label: "Date" },
  { slug: "boolean", label: "Yes or no" },
  { slug: "single-choice", label: "Single choice" },
  { slug: "multi-choice", label: "Multiple choice" },
] as const;

function slugFor(name: string): string {
  return `e2e-${name}-${RUN}`;
}

function questionIdFor(name: string): string {
  return `q_${slugFor(name).replaceAll("-", "_")}`;
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** Create, publish, branch a new version, and deprecate one question of a given type. */
async function walkLifecycle(page: Page, types: readonly { slug: string; label: string }[]) {
  for (const type of types) {
    await createDraft(page, slugFor(type.slug), type.label);
    await expect(page.getByRole("heading", { name: questionIdFor(type.slug) })).toBeVisible();
    // A brand-new question is a draft, and the badge says so in words rather than in
    // colour (the a11y requirement, asserted rather than assumed).
    await expect(page.locator(".qcms-tag").first()).toHaveText("Draft");

    await confirmLifecycle(page, /^Publish version 1$/, "Publish");
    await expect(page.getByRole("link", { name: /Version 1/ })).toContainText("Published");

    await confirmLifecycle(page, /^New version$/, "Create draft");
    await page.waitForURL(/\?v=2$/);
    await expect(page.getByRole("link", { name: /Version 2/ })).toContainText("Draft");

    // Deprecation is a property of the published version, so it happens on v1's screen.
    await page.goto(`/questions/${questionIdFor(type.slug)}?v=1`);
    await confirmLifecycle(page, /^Deprecate version 1$/, "Deprecate");
    await expect(page.getByRole("link", { name: /Version 1/ })).toContainText("Deprecated");
    // Nothing was deleted: v2 is still there, still a draft (R6).
    await expect(page.getByRole("link", { name: /Version 2/ })).toContainText("Draft");
  }
}

test("the whole lifecycle works for the text, number and date types", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await walkLifecycle(page, TYPES.slice(0, 4));
});

test("the whole lifecycle works for the boolean and choice types", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await walkLifecycle(page, TYPES.slice(4));
});

test("option ids survive a relabel and a reorder (exit criterion 2)", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("options"), "Single choice");
  await addOption(page, "Green");

  // The ids as minted, and they are minted from the labels the options were added with.
  // Everything after this asserts they are still exactly these, in whatever order the
  // options have been moved into.
  const minted = await optionIds(page);
  expect(minted).toEqual(["opt_yes_always", "opt_no_never", "opt_green"]);

  await fillStable(field(page, "Option 1 label"), "Crimson");
  expect(await optionIds(page)).toEqual(minted);

  // Reorder by keyboard, which under the 057 grid is Arrow Up/Down on the focused grip
  // rather than a pair of move buttons. The grip travels with its row, so it is still the
  // focused element afterwards - which is what makes a second press move the same option
  // again instead of walking a fixed slot.
  await moveOptionByKey(page, 0, "ArrowDown");
  expect(await optionIds(page)).toEqual([minted[1], minted[0], minted[2]]);
  await expect(page.locator('[data-option-index="1"] [data-option-grip]')).toBeFocused();

  await moveOptionByKey(page, 2, "ArrowUp");
  expect(await optionIds(page)).toEqual([minted[1], minted[2], minted[0]]);

  // The label that travelled with the first minted id is the assertion that catches a
  // reorder implemented over labels rather than over whole options.
  await expect(field(page, "Option 3 label")).toHaveValue("Crimson");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  // And they are still the same ids after a round trip through the API and the database,
  // which is the property every rule and every stored answer depends on.
  await page.reload();
  expect(await optionIds(page)).toEqual([minted[1], minted[2], minted[0]]);
  await expect(field(page, "Option 3 label")).toHaveValue("Crimson");
});

test("an abandoned ghost row consumes no option id (the minting ruling, 2026-08-06)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("ghost"), "Single choice");

  const before = await optionIds(page);
  expect(before).toEqual(["opt_yes_always", "opt_no_never"]);

  // Open the ghost add-row. A row appears, and it is NOT an option: it has no id, so it
  // has no `data-option-index` and contributes nothing to the list of minted ids.
  await page.getByRole("button", { name: "Add option" }).click();
  await expect(pendingRow(page)).toBeFocused();
  expect(await optionIds(page)).toEqual(before);

  // Tab past it without typing, which is the case the ruling is about: the row is
  // abandoned and the document is exactly what it was.
  await pendingRow(page).blur();
  await expect(pendingRow(page)).toHaveCount(0);
  expect(await optionIds(page)).toEqual(before);

  // The option the author does name earns the id its own label derives, unsuffixed. Under
  // minting-at-render this would be `opt_option` (or `opt_green_2` behind a consumed one),
  // and because ids are permanent (R6) that damage would never be repairable.
  await addOption(page, "Green");
  expect(await optionIds(page)).toEqual([...before, "opt_green"]);

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.reload();
  expect(await optionIds(page)).toEqual([...before, "opt_green"]);
});

test("insert lands an option at the top, between two rows and at the bottom", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("insert"), "Single choice");

  // Pointer path: the insert point above a row. Above the first row is the top of the list.
  await insertOptionAbove(page, 0, "Top");
  expect(await optionIds(page)).toEqual(["opt_top", "opt_yes_always", "opt_no_never"]);

  // Between two rows.
  await insertOptionAbove(page, 2, "Middle");
  expect(await optionIds(page)).toEqual([
    "opt_top",
    "opt_yes_always",
    "opt_middle",
    "opt_no_never",
  ]);

  // The end of the list is the ghost add-row, which is what the card makes it.
  await addOption(page, "Bottom");
  expect(await optionIds(page)).toEqual([
    "opt_top",
    "opt_yes_always",
    "opt_middle",
    "opt_no_never",
    "opt_bottom",
  ]);

  // Keyboard path: the row menu on the grip, which is the parity route for insertion and
  // the only route to remove. Insert below row 1 puts a row at index 2.
  await useRowMenu(page, 0, /^Insert option below Top$/);
  await expect(pendingRow(page)).toBeFocused();
  await fillStable(pendingRow(page), "Second");
  await pendingRow(page).blur();
  expect(await optionIds(page)).toEqual([
    "opt_top",
    "opt_second",
    "opt_yes_always",
    "opt_middle",
    "opt_no_never",
    "opt_bottom",
  ]);

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  // Every insert survives the round trip in the position it was put in.
  await page.reload();
  expect(await optionIds(page)).toEqual([
    "opt_top",
    "opt_second",
    "opt_yes_always",
    "opt_middle",
    "opt_no_never",
    "opt_bottom",
  ]);
});

test("a real drag reorders to the position the drop indicator marks", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("drag"), "Single choice");
  await addOption(page, "Green");
  expect(await optionIds(page)).toEqual(["opt_yes_always", "opt_no_never", "opt_green"]);

  const source = grip(page, 0);
  const last = page.locator('[data-option-index="2"]');
  const from = await source.boundingBox();
  const to = await last.boundingBox();
  expect(from, "the grip should be laid out").not.toBeNull();
  expect(to, "the last row should be laid out").not.toBeNull();
  if (from === null || to === null) return;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Past the last row's midpoint, so the live indicator marks the end of the list.
  await page.mouse.move(from.x + from.width / 2, to.y + to.height - 2, { steps: 8 });
  await expect(page.locator(".qcms-opt-insert--drop")).toBeVisible();
  await expect(page.locator(".qcms-opt-row.is-dragging")).toHaveCount(1);
  await page.mouse.up();

  expect(await optionIds(page)).toEqual(["opt_no_never", "opt_green", "opt_yes_always"]);

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.reload();
  expect(await optionIds(page)).toEqual(["opt_no_never", "opt_green", "opt_yes_always"]);
});

test("the row menu reorders an option with a single pointer and no dragging", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("nodrag"), "Single choice");
  await addOption(page, "Maybe");
  const minted = await optionIds(page);
  expect(minted).toEqual(["opt_yes_always", "opt_no_never", "opt_maybe"]);

  // A middle row's menu, opened by one press that travels nowhere. Five items, in the
  // order all three POCs draw, each naming the row it acts on.
  const middle = await openRowMenuByPointer(page, 1);
  await expect(middle.getByRole("menuitem")).toHaveText([
    "Insert option above No, never",
    "Insert option below No, never",
    "Move No, never up",
    "Move No, never down",
    "Remove option No, never",
  ]);

  // The reorder itself, and the whole point of the issue: a tap on an ordinary control
  // moved the row, with no gesture anywhere in it.
  await middle.getByRole("menuitem", { name: "Move No, never up", exact: true }).click();
  expect(await optionIds(page)).toEqual(["opt_no_never", "opt_yes_always", "opt_maybe"]);
  await expect(page.getByTestId("qcms-announcer")).toHaveText(
    "No, never moved to position 1 of 3.",
  );
  // The menu closes and the moved row keeps the operator, at its NEW index rather than on
  // whatever slid into the old slot.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(grip(page, 0)).toBeFocused();

  // The first row: Move up is gone, and it is gone as a native `disabled` button rather
  // than a live control that refuses.
  const first = await openRowMenuByPointer(page, 0);
  await expect(
    first.getByRole("menuitem", { name: "Move No, never up", exact: true }),
  ).toBeDisabled();
  await expect(
    first.getByRole("menuitem", { name: "Move No, never down", exact: true }),
  ).toBeEnabled();

  // Which puts a dead item at position three of five, the arrangement issue 517 fixed:
  // arrowing down has to skip it, or Move down and Remove are unreachable by keyboard.
  await expect(first.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(
    first.getByRole("menuitem", { name: "Move No, never down", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    first.getByRole("menuitem", { name: "Remove option No, never", exact: true }),
  ).toBeFocused();

  // And the other direction moves too, by pointer, back to where the row started.
  await first.getByRole("menuitem", { name: "Move No, never down", exact: true }).click();
  expect(await optionIds(page)).toEqual(minted);
  await expect(grip(page, 1)).toBeFocused();

  // The last row is the mirror image.
  const last = await openRowMenuByPointer(page, 2);
  await expect(last.getByRole("menuitem", { name: "Move Maybe down", exact: true })).toBeDisabled();
  await expect(last.getByRole("menuitem", { name: "Move Maybe up", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");

  // A single-option grid has no move to offer at all, and no Remove either. Reached by
  // removing rows through the same pointer path, since that is the state an author gets
  // to it from.
  const lastMenu = await openRowMenuByPointer(page, 2);
  await lastMenu.getByRole("menuitem", { name: "Remove option Maybe", exact: true }).click();
  const middleMenu = await openRowMenuByPointer(page, 1);
  await middleMenu.getByRole("menuitem", { name: "Remove option No, never", exact: true }).click();
  expect(await optionIds(page)).toEqual(["opt_yes_always"]);

  const only = await openRowMenuByPointer(page, 0);
  await expect(
    only.getByRole("menuitem", { name: "Move Yes, always up", exact: true }),
  ).toBeDisabled();
  await expect(
    only.getByRole("menuitem", { name: "Move Yes, always down", exact: true }),
  ).toBeDisabled();
  await expect(
    only.getByRole("menuitem", { name: "Remove option Yes, always", exact: true }),
  ).toBeDisabled();
  // Three of five dead, and the menu still opens onto a live item rather than stranding
  // focus on a button that cannot take it.
  await expect(only.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
});

test("the grid's hidden controls are reachable without a pointer", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("keys"), "Single choice");

  // The grip and the insert point are hidden at rest and revealed by hover OR focus.
  // Focus is the half a pointer-only implementation forgets, so it is the half asserted -
  // and asserted on computed OPACITY, because the card hides them with opacity and
  // Playwright counts an opacity-0 element as visible.
  const insert = page.locator('[data-option-index="0"] .qcms-opt-insert').first();
  const opacityOf = (target: Locator): Promise<string> =>
    target.evaluate((element) => getComputedStyle(element).opacity);
  expect(await opacityOf(insert), "the insert point is hidden at rest").toBe("0");
  expect(await opacityOf(grip(page, 0)), "the grip is hidden at rest").toBe("0");

  // Reached by real keyboard travel, in the order the card specifies: the label's cell
  // walks back through the grip and then the insert point.
  await field(page, "Option 1 label").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(grip(page, 0)).toBeFocused();
  await expect.poll(() => opacityOf(grip(page, 0))).toBe("1");
  await page.keyboard.press("Shift+Tab");
  await expect(insert).toBeFocused();
  await expect.poll(() => opacityOf(insert)).toBe("1");

  // Enter on the focused grip opens the row menu; Escape closes it and hands focus back,
  // so a keyboard operator is never stranded inside a closed popup.
  await grip(page, 0).focus();
  await grip(page, 0).press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menu").press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(grip(page, 0)).toBeFocused();

  // Enter in a label commits and moves to the next row's label; on the last row it moves
  // to the ghost add-row, which is where the card puts the end of the rhythm.
  await field(page, "Option 1 label").focus();
  await page.keyboard.press("Enter");
  await expect(field(page, "Option 2 label")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Add option" })).toBeFocused();

  // Escape inside a cell reverts the in-flight edit and keeps focus where it was.
  await field(page, "Option 1 label").focus();
  await page.keyboard.type("XX");
  await page.keyboard.press("Escape");
  await expect(field(page, "Option 1 label")).toHaveValue("Yes, always");
  await expect(field(page, "Option 1 label")).toBeFocused();

  // Remove lives in the row menu rather than in a second row-end control, per the card,
  // which makes that menu the ONLY route to it - so it has to be reachable with a pointer
  // as well as without one, on a two-option list, which is what this draft is and what a
  // new choice question seeds. Asserted here because this is the test that used to walk
  // straight past the defect: it drove the menu on exactly this configuration while
  // "Remove option" hung 95px below the grid's clipped bottom edge.
  await grip(page, 1).focus();
  await grip(page, 1).press("Enter");
  const remove = page.getByRole("menuitem", { name: /^Remove option No, never$/u });
  await expect(remove).toBeVisible();
  // One assertion over both answers, so a red reports the clipping box AND what a press
  // would have hit instead, rather than stopping at whichever question was asked first.
  expect(
    await mouseReachOf(remove),
    "Remove option is inside every box that clips it, and a press at its centre lands on it",
  ).toEqual({ clippedBy: null, hit: "the control" });

  // Then press it, from the menu just proved reachable: `useRowMenu` would re-press the
  // grip and toggle this menu shut, and a fresh one is not the one that was measured.
  await remove.click();
  expect(await optionIds(page)).toEqual(["opt_yes_always"]);

  // One option left, so Remove is now the disabled item, and roving has to cope with it.
  //
  // This grid shares `components/row-menu.tsx` with the step editor's pin list (issue 517),
  // and the pin list is where a disabled item in the MIDDLE of the list first stranded the
  // items behind it. Here the disabled item is LAST, which is why nothing was ever visibly
  // broken and why the defect stayed latent: no live item sits behind Remove. What was
  // still wrong is the wrap - pressing ArrowDown on the last live item aimed at the dead
  // Remove and did nothing, so the ring was open. Asserted here rather than only on the
  // pin list, so the shared component is proved in both item orders its callers use.
  const menuItem = (key: string): Locator =>
    page.locator(`[role="menuitem"][data-row-menu-item="${key}"]`);
  await grip(page, 0).focus();
  await grip(page, 0).press("Enter");
  await expect(menuItem("remove")).toBeDisabled();
  await expect(menuItem("insertAbove")).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(menuItem("insertBelow")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menuItem("insertAbove")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menuItem("insertBelow")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

/**
 * Can a mouse actually reach `target`, with any programmatic scroll undone first?
 *
 * The undoing is the whole point, and it is why neither `toBeVisible()` nor a plain
 * `.click()` can stand in for this. Chromium scrolls an `overflow: hidden` box
 * programmatically, so `focus()` and Playwright's own scroll-into-view both haul a
 * clipped control back into the box before they touch it: on the CSS this replaced,
 * focusing "Remove option" moved the grid's `scrollTop` from 0 to 96 and the click
 * landed, on a configuration where a person with a mouse could not press it at all. A
 * hidden box has no scrollbar, so a user can neither cause that scroll nor undo it.
 *
 * So the offsets go back to 0 on every clipping ancestor first, and then the two
 * questions a pointer really asks get asked: is the control inside every box that
 * clips it, and does a press at its centre land on it. `elementFromPoint` alone would
 * be the better single check, but it reports only "something else is there" - the
 * ancestor walk names the box, which is what turns a red into a diagnosis.
 */
async function mouseReachOf(target: Locator): Promise<{ clippedBy: string | null; hit: string }> {
  return target.evaluate((element) => {
    const nameOf = (node: Element): string =>
      typeof node.className === "string" && node.className !== "" ? node.className : node.tagName;

    let clippedBy: string | null = null;
    for (let box = element.parentElement; box !== null; box = box.parentElement) {
      const style = getComputedStyle(box);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;
      box.scrollTop = 0;
      box.scrollLeft = 0;
      const inner = box.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const outside =
        rect.bottom > inner.bottom + 1 ||
        rect.top < inner.top - 1 ||
        rect.right > inner.right + 1 ||
        rect.left < inner.left - 1;
      if (outside && clippedBy === null) clippedBy = nameOf(box);
    }

    const rect = element.getBoundingClientRect();
    const under = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (under === null) return { clippedBy, hit: "nothing" };
    return {
      clippedBy,
      hit: under === element || element.contains(under) ? "the control" : nameOf(under),
    };
  });
}

test("a cleared label renders the grid's error state, joined to its message line", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("blank"), "Single choice");

  // Clearing a committed row is now the ONLY route to a blank option: the pending path
  // abandons a row it cannot name, so an empty label can no longer be created. That makes
  // this state both harder to reach and the one most likely to lose coverage, so it is
  // asserted in the standing browser suite.
  await fillStable(field(page, "Option 2 label"), "");
  await page.getByRole("button", { name: "Save draft" }).click();

  // The kernel's issue lands on `options.1.label`, so the SECOND row wears the error and
  // the first does not - an error rendered on every row would pass a looser assertion.
  const errored = page.locator('[data-option-index="1"]');
  await expect(errored).toHaveClass(/is-error/);
  await expect(page.locator('[data-option-index="0"]')).not.toHaveClass(/is-error/);

  const cell = errored.locator("textarea");
  await expect(cell).toHaveAttribute("aria-invalid", "true");

  // The message line sits BELOW the grid rather than in the cell (the card's layout), so
  // the two are only one thing for an assistive technology if `aria-describedby` joins
  // them. That join is the whole reason the split placement is acceptable, so it is the
  // part asserted rather than the mere presence of some red text.
  const describedBy = await cell.getAttribute("aria-describedby");
  expect(describedBy, "the erroring cell names its message line").toBe("qcms-option-error-1");
  const line = page.locator(`#${String(describedBy)}`);
  await expect(line).toBeVisible();
  await expect(line).toHaveClass(/qcms-opt-grid-error/);
  // Named by position, so a reader of a line under a six-row grid knows which row it is.
  await expect(line).toContainText("Option 2:");

  // And exactly one line: an error rendered per row would stack duplicates under the grid.
  await expect(page.locator(".qcms-opt-grid-error")).toHaveCount(1);

  // The state clears when the author fixes it, which is the half a one-way assertion misses.
  await fillStable(field(page, "Option 2 label"), "No, never");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await expect(page.locator(".qcms-opt-grid-error")).toHaveCount(0);
  await expect(errored).not.toHaveClass(/is-error/);
});

test("the narrow layout folds the ID under the label, keyed off the editor's width", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("compact"), "Single choice");

  const label = page.locator('[data-option-index="0"] .qcms-opt-cell--label');
  const id = page.locator('[data-option-index="0"] .qcms-opt-cell--id');

  // Wide: three columns, so the ID sits to the RIGHT of the label on the same line.
  await page.setViewportSize({ width: 1280, height: 800 });
  const wideLabel = await label.boundingBox();
  const wideId = await id.boundingBox();
  expect(wideLabel).not.toBeNull();
  expect(wideId).not.toBeNull();
  if (wideLabel === null || wideId === null) return;
  expect(wideId.x, "the ID column is to the right of the label").toBeGreaterThan(wideLabel.x);
  expect(Math.abs(wideId.y - wideLabel.y), "and on the same line").toBeLessThan(12);

  // Narrow: two columns, the ID folded onto a second line inside the label's column. This
  // is a CONTAINER query on the grid, not a viewport media query, so the same DOM reflows
  // and no option id is ever rendered twice.
  await page.setViewportSize({ width: 390, height: 844 });
  const tightLabel = await label.boundingBox();
  const tightId = await id.boundingBox();
  expect(tightLabel).not.toBeNull();
  expect(tightId).not.toBeNull();
  if (tightLabel === null || tightId === null) return;
  expect(tightId.y, "the ID has folded below the label").toBeGreaterThan(tightLabel.y);
  expect(tightId.x, "and sits in the label's column, not the grip's").toBeGreaterThan(
    tightLabel.x - 4,
  );
  // One DOM, one id: the fold must not be a second copy of the cell.
  await expect(page.locator('[data-option-index="0"] .qcms-opt-cell--id')).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("the version preview renders the real control for the type", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("preview"), "Long text");

  // The preview is compiled by the API and drawn by the shared renderer, so what appears
  // here is literally the control a respondent gets: a long-text question compiles to a
  // TextArea, which is a textbox carrying the question's label.
  const preview = page.locator(".qcms-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("textbox", { name: "E2E Long text question" })).toBeVisible();
  // No abuse decoy in a preview: the honeypot belongs to a respondent-facing step.
  await expect(preview.locator("[name^=qcms_]")).toHaveCount(0);
});

/**
 * The preview is LOCALLY interactive: a control accepts input, and nothing leaves the
 * browser (task 032 review batch, item 7).
 *
 * Both halves matter, and the first one is a regression test for a real defect the Code
 * Owner found at the gate. The renderer is controlled, so the original component - which
 * passed a document but no `onChange` - produced controls that were focusable and looked
 * live but were FROZEN: every click wrote back the value the control already had, and a
 * checkbox could not be ticked. That is not "what a respondent sees" either, which was
 * the whole reason the preview deliberately avoids `disabled`/`inert`, and it left the
 * on-screen promise that nothing is saved describing behaviour the control could not
 * exhibit.
 *
 * The second half is the property that makes the first one safe, and it is asserted as an
 * ABSENCE of requests rather than as "the click worked". An absence is only worth
 * asserting if the instrument was armed, so the recorder stays attached through a
 * positive control at the end: an action that must talk to the server, proving the same
 * listener does see traffic when traffic exists.
 */
test("a preview control accepts input, and nothing leaves the browser", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Multiple choice, because the checkbox is the control the defect was found on and the
  // one whose frozen state is most obviously wrong to a human.
  await createDraft(page, slugFor("interactive"), "Multiple choice");

  const preview = page.locator(".qcms-preview");
  const yes = preview.getByRole("checkbox", { name: "Yes, always", exact: true });
  const no = preview.getByRole("checkbox", { name: "No, never", exact: true });
  // Clicked by their visible label text, not by the input: react-aria puts a decorative
  // indicator over the real checkbox, which intercepts pointer events. This is the same
  // convention `apps/portal/e2e/support/kitchen-sink.ts` encodes for the same controls.
  const tick = async (label: string): Promise<void> => {
    await preview.getByText(label, { exact: true }).click();
  };
  await expect(yes).not.toBeChecked();

  /**
   * Every request the page issues from here on.
   *
   * `_next/static` chunks and the favicon are the dev server's own asset traffic, not
   * this app talking to its BFF: `next dev` compiles routes on demand, so a chunk can
   * arrive at any moment for reasons that have nothing to do with the click.
   */
  const requests: string[] = [];
  const record = (url: string): void => {
    if (url.includes("/_next/static/") || url.includes("/_next/image")) return;
    if (url.endsWith("/favicon.ico")) return;
    requests.push(url);
  };
  page.on("request", (request) => {
    record(request.url());
  });

  // THE CLICK LANDS. This is the assertion the frozen preview failed.
  await tick("Yes, always");
  await expect(yes).toBeChecked();
  // A second control, so the answers map is proven to hold more than one entry rather
  // than to be a single latched boolean, and the first one is proven not to be cleared.
  await tick("No, never");
  await expect(no).toBeChecked();
  await expect(yes).toBeChecked();

  // AND NOTHING WAS SENT. Ticking two boxes is two ADR-31 commit moments' worth of
  // gesture on the respondent side; here it must produce no request at all, because the
  // preview has no `postAnswer`, no fetch and nothing to persist to.
  expect(requests, "a preview interaction must issue no request").toEqual([]);

  // POSITIVE CONTROL: the recorder above is armed. Saving the draft is the same screen's
  // one deliberate trip to the server, so if this list were also empty the assertion
  // above would be measuring a listener that never fires.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  expect(requests.length, "the request recorder sees traffic when traffic exists").toBeGreaterThan(
    0,
  );

  // The answers are discarded on a version switch. The switch is a `?v=` navigation on
  // the same route, so React can reconcile the preview in place and keep its state; v1's
  // ticks must not reappear under v2's controls, whichever navigation kind Next chooses.
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2$/);
  await expect(preview.getByRole("checkbox", { name: "Yes, always" })).not.toBeChecked();
});

test("errors from the API are readable, and land on the field that caused them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Scoped to the page content: Next renders its own empty `role="alert"` route announcer
  // outside `<main>`, so an unscoped `getByRole("alert")` is a strict-mode violation on
  // every screen in the app.
  const alert = page.getByRole("main").getByRole("alert");

  // 1. A kernel rejection, addressed by path: shortest above longest is
  //    MIN_LENGTH_ABOVE_MAX_LENGTH at ["constraints","minLength"], so it has to appear on
  //    the "Shortest answer" field rather than as a banner with no home.
  await createDraft(page, slugFor("invalid"), "Short text");
  await setNumericConstraint(page, "Shortest answer", "10");
  await setNumericConstraint(page, "Longest answer", "5");
  // Anchor on the message field the commit produced before clicking Save (task 048): that
  // insertion is what reflows the page, and an un-anchored click lands its mousedown and its
  // mouseup on different elements, so no `click` event fires at all. The full reasoning is
  // on `setNumericConstraint`.
  await expect(field(page, "Message when the answer is too long")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(alert).toContainText("The engine rejected this draft");
  await expect(field(page, "Shortest answer")).toHaveAttribute("aria-invalid", "true");

  // 2. R6 in the one place an author meets it: a slug that resolves to an id already used.
  //    The two slugs differ, the ids do not.
  await page.goto("/questions/new");
  await fillStable(field(page, "Slug"), slugFor("invalid").replaceAll("-", "_"));
  await fillStable(field(page, "Label"), "Duplicate id");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(alert).toContainText("never reused");

  // 3. VERSION_IMMUTABLE, reached the way an author actually reaches it: two tabs on the
  //    same draft, one of which publishes it. The stale tab still shows a live editor, and
  //    its save has to explain the rule rather than fail silently.
  await createDraft(page, slugFor("immutable"), "Short text");
  const stale = page.url();
  const other = await page.context().newPage();
  await other.goto(stale);
  await confirmLifecycle(other, /^Publish version 1$/, "Publish");
  await other.close();

  await fillStable(field(page, "Label"), "Edited after publish");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(alert).toContainText("frozen");
  await expect(alert).toContainText("new version");
});

test("the list filters, and says something useful when it finds nothing", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/questions");
  await expect(page.getByRole("heading", { name: "Questions", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Question library" })).toBeVisible();

  // A search that matches nothing is a different state from an empty library, and says so:
  // suggesting the seed command to someone whose library is full would be noise.
  await fillStable(field(page, "Search"), `no-such-question-${RUN}`);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("No question matches this search.")).toBeVisible();

  // The filter lives in the URL, so it is a place an author can link to.
  await expect(page).toHaveURL(/[?&]q=no-such-question/);

  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page.getByRole("table", { name: "Question library" })).toBeVisible();
});

test("the type column and the type filter narrow the library (issue #218)", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  // Scoped to this run's questions, so the assertions do not depend on what else the
  // harness database happens to hold.
  await page.goto(`/questions?q=e2e-number-${RUN}`);
  const numberRow = page.getByRole("row").filter({ hasText: questionIdFor("number") });
  await expect(numberRow).toContainText("Number");

  // The filter is the API's, so it has to survive the round trip rather than hide rows
  // client-side: the date question exists and matches the search, and must still be gone.
  await page.goto(`/questions?q=e2e-&type=date`);
  await expect(page.getByRole("row").filter({ hasText: questionIdFor("date") })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: questionIdFor("number") })).toHaveCount(0);

  // And it is reachable from the toolbar, not just from a hand-written URL.
  await page.goto("/questions");
  const picker = page.getByRole("button", { name: /Type$/ });
  await picker.click();
  await page.getByRole("option", { name: "Yes or no", exact: true }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/[?&]type=boolean/);
  await expect(page.getByRole("row").filter({ hasText: questionIdFor("number") })).toHaveCount(0);
});

test("a row opens its question from the keyboard alone", async ({ page }) => {
  // Not an axe check: axe cannot tell whether the route into a row is *reachable*.
  //
  // ## What this test used to have to do, and why it does not any more (issue 570)
  //
  // Until issue 570 the vendored kit table's ROW was the navigation, and reaching it from
  // the keyboard needed a retried `row.focus()` with `data-focused` as the readiness
  // discriminator, because the server rendered the row already carrying `tabindex="-1"`
  // and a focus arriving before hydration succeeded on a node React then replaced (issue
  // #419). Contract §2 retired that handler: the identifying cell carries a real anchor
  // now, the component is not even a client component any more, and an anchor in server
  // HTML is focusable and activatable from the moment the document parses. There is no
  // hydration race left to time around, so the retry is gone with the thing it was
  // guarding.
  //
  // The assertion is stronger than the one it replaces, not weaker. Tabbing to the link
  // proves it is in the document's own tab order rather than merely programmatically
  // focusable, which is what a keyboard author actually has.
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/questions?q=${slugFor("preview")}`);

  const link = page.getByRole("link", { name: `Open question ${questionIdFor("preview")}` });
  await expect(link).toBeVisible();

  // Tab from the top of the document until the link takes focus, rather than focusing it
  // directly. A bounded walk: the toolbar above the table is a handful of controls, and a
  // regression that drops the link out of the tab order exhausts the budget and fails
  // here rather than passing on a `focus()` no keyboard can perform.
  for (
    let step = 0;
    step < 40 && !(await link.evaluate((el) => el === document.activeElement));
    step++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(link).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(questionIdFor("preview")));
});

/*
 * The coverage gap behind issue #220, in two halves.
 *
 * The lifecycle walk above publishes every type with an *empty* constraint panel, so no
 * spec ever rendered a frozen version whose constraint controls carry saved values - and a
 * frozen panel is the one place those controls are disabled. A fault that needs both
 * (disabled *and* valued) was invisible to the whole suite while being reproducible by
 * hand. The two halves are separate tests rather than one so a failure names the control
 * that produced it: the numeric panel and the date panel are different vendored components
 * with different controlled-state behaviour.
 */

test("a frozen number version renders cleanly with its bounds saved", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await createDraft(page, slugFor("frozen-number"), "Number");
  await setNumericConstraint(page, "Smallest value", "1");
  await setNumericConstraint(page, "Largest value", "10");
  // Same anchor as the API-errors test above, for the same reason (`setNumericConstraint`).
  await expect(field(page, "Message when the value is too large")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  // The bounds are still on screen after the save. React 19 resets a form once its action
  // resolves, and this editor is controlled, so an un-prevented reset used to hand every
  // constraint control back its mount-time value here - silently for a NumberField, whose
  // empty state is a number (`NaN`) rather than an absent value. The author saw "Draft
  // saved." over an editor that had quietly emptied itself, and the next save would have
  // written that emptiness over the stored document.
  await expect(field(page, "Smallest value")).toHaveValue("1");
  await expect(field(page, "Largest value")).toHaveValue("10");

  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  // The hard navigation is the point: a client-side link would never server-render this
  // screen, so only `goto` puts the frozen panel through hydration.
  await page.goto(`/questions/${questionIdFor("frozen-number")}?v=1`);
  await expect(field(page, "Smallest value")).toHaveValue("1");
  await expect(field(page, "Smallest value")).toBeDisabled();
});

test("a frozen date version renders cleanly with its bounds saved", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await createDraft(page, slugFor("frozen-date"), "Date");
  await fillDate(page, "Earliest date", "01012030");
  await fillDate(page, "Latest date", "12312030");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  // Both dates survive the save. This is the loud half of the same fault: a DatePicker's
  // empty state is an absent value, so the reset also flipped it from controlled to
  // uncontrolled and react-stately said so on the console - which is how issue #220's
  // console fault was reachable at all.
  await expect(page.getByRole("group", { name: "Earliest date" })).toContainText("1/1/2030");
  await expect(page.getByRole("group", { name: "Latest date" })).toContainText("12/31/2030");

  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await page.goto(`/questions/${questionIdFor("frozen-date")}?v=1`);
  await expect(page.getByRole("group", { name: "Earliest date" })).toContainText("2030");
});

/*
 * Author-supplied validation messages and boolean label overrides (task 048, ADR-32 and
 * ADR-36), exit criteria 4 and 5.
 *
 * The property under examination is a **three-state field**: no field at all, a field
 * showing the default as a placeholder, and a field holding an override. Only the browser
 * can distinguish the first two, because "the box is empty and the default is visible in it"
 * is a rendering fact rather than a data one, and the unit tests can only prove what leaves
 * the editor. Both halves are needed: `lib/questions/definition.test.ts` proves the wire
 * payload, these prove the author's screen.
 */

const TOO_SHORT = "Message when the answer is too short";

test("a validation message inherits until it is written, then round-trips (048)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("messages"), "Short text");

  // NO CONSTRAINT, NO FIELD. This is the whole reason the kernel's ORPHAN_MESSAGE_KEY is
  // unreachable from this screen rather than merely caught by it.
  await expect(field(page, TOO_SHORT)).toHaveCount(0);
  await expect(page.getByText("There is nothing to write a message for yet.")).toBeVisible();

  // Setting the constraint reveals its message field, and the field's PLACEHOLDER is the
  // sentence a respondent would see, with this question's own bound interpolated.
  await setNumericConstraint(page, "Shortest answer", "8");
  await expect(field(page, TOO_SHORT)).toHaveAttribute(
    "placeholder",
    "Answer must be at least 8 characters",
  );
  await expect(field(page, TOO_SHORT)).toHaveValue("");

  // BLANK INHERITS. Saving an untouched box must store nothing, so after the round trip the
  // default is still a placeholder rather than having become the author's content - which is
  // what keeps a later improvement to the shipped wording reaching this question.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.reload();
  await expect(field(page, TOO_SHORT)).toHaveValue("");
  await expect(field(page, TOO_SHORT)).toHaveAttribute(
    "placeholder",
    "Answer must be at least 8 characters",
  );

  // NON-BLANK OVERRIDES, through the API and the database and back.
  const authored = "A policy number is 8 characters long.";
  await fillStable(field(page, TOO_SHORT), authored);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.reload();
  await expect(field(page, TOO_SHORT)).toHaveValue(authored);

  // And clearing the constraint takes the message with it: the field goes, the next save
  // drops the orphaned key, and bringing the constraint back brings back an EMPTY field
  // rather than a remembered sentence for a rule that stopped existing.
  await setNumericConstraint(page, "Shortest answer", "");
  await expect(field(page, TOO_SHORT)).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.reload();
  await setNumericConstraint(page, "Shortest answer", "8");
  await expect(field(page, TOO_SHORT)).toHaveValue("");
});

test("each boolean label overrides independently of the other (048, ADR-36)", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("bool-labels"), "Yes or no");

  const yes = field(page, "Label for the affirmative choice");
  const no = field(page, "Label for the negative choice");
  // Both start on the lexicon, shown as placeholders.
  await expect(yes).toHaveAttribute("placeholder", "Yes");
  await expect(no).toHaveAttribute("placeholder", "No");
  await expect(yes).toHaveValue("");

  // Override ONE. The mixed pair is the case worth the browser: a paired control would have
  // dragged "No" along, and the compiler's per-label fallback would never be exercised.
  await fillStable(yes, "I was at fault");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.reload();
  await expect(field(page, "Label for the affirmative choice")).toHaveValue("I was at fault");
  await expect(field(page, "Label for the negative choice")).toHaveValue("");
  await expect(field(page, "Label for the negative choice")).toHaveAttribute("placeholder", "No");

  // The preview is compiled by the API and drawn by the shared renderer, so it is where the
  // resolved pair shows: the override for one label, the lexicon for the other.
  const preview = page.locator(".qcms-preview");
  await expect(preview.getByText("I was at fault", { exact: true })).toBeVisible();
  await expect(preview.getByText("No", { exact: true })).toBeVisible();
});

test("the type picker is locked once the question exists", async ({ page }) => {
  // R6 made visible: after creation the picker is gone entirely, replaced by a sentence
  // that says why. A screen that merely disabled it would leave an author waiting for it
  // to become enabled.
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/questions/${questionIdFor("preview")}`);
  await expect(page.getByRole("button", { name: /Type$/ })).toHaveCount(0);
  await expect(page.getByText("Type is locked to Long text.")).toBeVisible();

  // And the creation screen still offers it, so the assertion above is about this screen
  // rather than about a picker that stopped rendering everywhere.
  await page.goto("/questions/new");
  await chooseType(page, "Date");
});
