import type { Locator, Page } from "@playwright/test";

import { settleTransitions } from "@roonga/qcms-e2e-support/animations";

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
  openPanel,
  openRowMenuByPointer,
  optionIds,
  pendingRow,
  setNumericConstraint,
  useRowMenu,
} from "./support/questions.js";

// fillStable protects against dev-server route compilation replacing the document after typing.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("questions");

let totpSecret = "";

// Ids cannot be reused, and the harness database survives local reruns.
const RUN = Date.now().toString(36);

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

async function walkLifecycle(page: Page, types: readonly { slug: string; label: string }[]) {
  for (const type of types) {
    await createDraft(page, slugFor(type.slug), type.label);
    await expect(page.getByRole("heading", { name: questionIdFor(type.slug) })).toBeVisible();

    await expect(page.locator(".qcms-tag").first()).toHaveText("Draft");

    await confirmLifecycle(page, /^Publish version 1$/, "Publish");
    await expect(page.getByRole("link", { name: /Version 1/ })).toContainText("Published");

    await confirmLifecycle(page, /^New version$/, "Create draft");
    await page.waitForURL(/\?v=2$/);
    await expect(page.getByRole("link", { name: /Version 2/ })).toContainText("Draft");

    await page.goto(`/questions/${questionIdFor(type.slug)}?v=1`);
    await confirmLifecycle(page, /^Deprecate version 1$/, "Deprecate");
    await expect(page.getByRole("link", { name: /Version 1/ })).toContainText("Deprecated");

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

  await openPanel(page, "options");
  await addOption(page, "Green");

  const minted = await optionIds(page);
  expect(minted).toEqual(["opt_yes_always", "opt_no_never", "opt_green"]);

  await fillStable(field(page, "Option 1 label"), "Crimson");
  expect(await optionIds(page)).toEqual(minted);

  await moveOptionByKey(page, 0, "ArrowDown");
  expect(await optionIds(page)).toEqual([minted[1], minted[0], minted[2]]);
  await expect(page.locator('[data-option-index="1"] [data-option-grip]')).toBeFocused();

  await moveOptionByKey(page, 2, "ArrowUp");
  expect(await optionIds(page)).toEqual([minted[1], minted[2], minted[0]]);

  await expect(field(page, "Option 3 label")).toHaveValue("Crimson");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

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
  await openPanel(page, "options");

  const before = await optionIds(page);
  expect(before).toEqual(["opt_yes_always", "opt_no_never"]);

  await page.getByRole("button", { name: "Add option" }).click();
  await expect(pendingRow(page)).toBeFocused();
  expect(await optionIds(page)).toEqual(before);

  await pendingRow(page).blur();
  await expect(pendingRow(page)).toHaveCount(0);
  expect(await optionIds(page)).toEqual(before);

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
  await openPanel(page, "options");

  await insertOptionAbove(page, 0, "Top");
  expect(await optionIds(page)).toEqual(["opt_top", "opt_yes_always", "opt_no_never"]);

  await insertOptionAbove(page, 2, "Middle");
  expect(await optionIds(page)).toEqual([
    "opt_top",
    "opt_yes_always",
    "opt_middle",
    "opt_no_never",
  ]);

  await addOption(page, "Bottom");
  expect(await optionIds(page)).toEqual([
    "opt_top",
    "opt_yes_always",
    "opt_middle",
    "opt_no_never",
    "opt_bottom",
  ]);

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
  await openPanel(page, "options");
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
  await openPanel(page, "options");
  await addOption(page, "Maybe");
  const minted = await optionIds(page);
  expect(minted).toEqual(["opt_yes_always", "opt_no_never", "opt_maybe"]);

  const middle = await openRowMenuByPointer(page, 1);
  await expect(middle.getByRole("menuitem")).toHaveText([
    "Insert option above No, never",
    "Insert option below No, never",
    "Move No, never up",
    "Move No, never down",
    "Remove option No, never",
  ]);

  await middle.getByRole("menuitem", { name: "Move No, never up", exact: true }).click();
  expect(await optionIds(page)).toEqual(["opt_no_never", "opt_yes_always", "opt_maybe"]);
  await expect(page.getByTestId("qcms-announcer")).toHaveText(
    "No, never moved to position 1 of 3.",
  );

  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(grip(page, 0)).toBeFocused();

  const first = await openRowMenuByPointer(page, 0);
  await expect(
    first.getByRole("menuitem", { name: "Move No, never up", exact: true }),
  ).toBeDisabled();
  await expect(
    first.getByRole("menuitem", { name: "Move No, never down", exact: true }),
  ).toBeEnabled();

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

  await first.getByRole("menuitem", { name: "Move No, never down", exact: true }).click();
  expect(await optionIds(page)).toEqual(minted);
  await expect(grip(page, 1)).toBeFocused();

  const last = await openRowMenuByPointer(page, 2);
  await expect(last.getByRole("menuitem", { name: "Move Maybe down", exact: true })).toBeDisabled();
  await expect(last.getByRole("menuitem", { name: "Move Maybe up", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");

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

  await expect(only.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
});

test("the grid's hidden controls are reachable without a pointer", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("keys"), "Single choice");
  await openPanel(page, "options");

  // Measure opacity: Playwright considers opacity-zero controls visible, so visibility alone misses this failure.
  const insert = page.locator('[data-option-index="0"] .qcms-opt-insert').first();
  const opacityOf = (target: Locator): Promise<string> =>
    target.evaluate((element) => getComputedStyle(element).opacity);
  expect(await opacityOf(insert), "the insert point is hidden at rest").toBe("0");
  expect(await opacityOf(grip(page, 0)), "the grip is hidden at rest").toBe("0");

  await field(page, "Option 1 label").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(grip(page, 0)).toBeFocused();
  await expect.poll(() => opacityOf(grip(page, 0))).toBe("1");
  await page.keyboard.press("Shift+Tab");
  await expect(insert).toBeFocused();
  await expect.poll(() => opacityOf(insert)).toBe("1");

  await grip(page, 0).focus();
  await grip(page, 0).press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menu").press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(grip(page, 0)).toBeFocused();

  await field(page, "Option 1 label").focus();
  await page.keyboard.press("Enter");
  await expect(field(page, "Option 2 label")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Add option" })).toBeFocused();

  await field(page, "Option 1 label").focus();
  await page.keyboard.type("XX");
  await page.keyboard.press("Escape");
  await expect(field(page, "Option 1 label")).toHaveValue("Yes, always");
  await expect(field(page, "Option 1 label")).toBeFocused();

  await grip(page, 1).focus();
  await grip(page, 1).press("Enter");
  const remove = page.getByRole("menuitem", { name: /^Remove option No, never$/u });
  await expect(remove).toBeVisible();

  expect(
    await mouseReachOf(remove),
    "Remove option is inside every box that clips it, and a press at its centre lands on it",
  ).toEqual({ clippedBy: null, hit: "the control" });

  await remove.click();
  expect(await optionIds(page)).toEqual(["opt_yes_always"]);

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

// Undo programmatic scrolling before hit-testing. focus and Playwright's scroll-into-view can reveal
// a clipped control inside overflow:hidden and hide a pointer-reachability failure.
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
  await openPanel(page, "options");

  await fillStable(field(page, "Option 2 label"), "");
  await page.getByRole("button", { name: "Save draft" }).click();

  const errored = page.locator('[data-option-index="1"]');
  await expect(errored).toHaveClass(/is-error/);
  await expect(page.locator('[data-option-index="0"]')).not.toHaveClass(/is-error/);

  const cell = errored.locator("textarea");
  await expect(cell).toHaveAttribute("aria-invalid", "true");

  // The message is outside the cell; aria-describedby is required to associate it with the input.
  const describedBy = await cell.getAttribute("aria-describedby");
  expect(describedBy, "the erroring cell names its message line").toBe("qcms-option-error-1");
  const line = page.locator(`#${String(describedBy)}`);
  await expect(line).toBeVisible();
  await expect(line).toHaveClass(/qcms-opt-grid-error/);

  await expect(line).toContainText("Option 2:");

  await expect(page.locator(".qcms-opt-grid-error")).toHaveCount(1);

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
  await openPanel(page, "options");

  const label = page.locator('[data-option-index="0"] .qcms-opt-cell--label');
  const id = page.locator('[data-option-index="0"] .qcms-opt-cell--id');

  await page.setViewportSize({ width: 1280, height: 800 });
  await settleTransitions(page);
  const wideLabel = await label.boundingBox();
  const wideId = await id.boundingBox();
  expect(wideLabel).not.toBeNull();
  expect(wideId).not.toBeNull();
  if (wideLabel === null || wideId === null) return;
  expect(wideId.x, "the ID column is to the right of the label").toBeGreaterThan(wideLabel.x);
  expect(Math.abs(wideId.y - wideLabel.y), "and on the same line").toBeLessThan(12);

  await page.setViewportSize({ width: 390, height: 844 });
  await settleTransitions(page);
  const tightLabel = await label.boundingBox();
  const tightId = await id.boundingBox();
  expect(tightLabel).not.toBeNull();
  expect(tightId).not.toBeNull();
  if (tightLabel === null || tightId === null) return;
  expect(tightId.y, "the ID has folded below the label").toBeGreaterThan(tightLabel.y);
  expect(tightId.x, "and sits in the label's column, not the grip's").toBeGreaterThan(
    tightLabel.x - 4,
  );

  await expect(page.locator('[data-option-index="0"] .qcms-opt-cell--id')).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("a long label-derived option id renders whole at both gate widths", async ({ page }) => {
  test.setTimeout(120_000);

  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("longid"), "Single choice");
  await openPanel(page, "options");

  await addOption(page, "Roadside assistance");
  const cell = page.locator('[data-option-index="2"] .qcms-opt-cell--id');
  await expect(cell).toHaveText("opt_roadside_assistance");

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // DOM text survives clipping, so also measure overflow to prove every character can be read.
    await expect(cell, `the whole id at ${String(width)}px`).toHaveText("opt_roadside_assistance");

    const overflow = await cell.evaluate((node) => ({
      overflowX: node.scrollWidth - node.clientWidth,
      overflowY: node.scrollHeight - node.clientHeight,
      textOverflow: getComputedStyle(node).textOverflow,
      whiteSpace: getComputedStyle(node).whiteSpace,
    }));
    expect(overflow.overflowX, `no horizontal clipping at ${String(width)}px`).toBeLessThanOrEqual(
      1,
    );
    expect(overflow.overflowY, `no vertical clipping at ${String(width)}px`).toBeLessThanOrEqual(1);

    expect(overflow.textOverflow, `no ellipsis at ${String(width)}px`).not.toBe("ellipsis");
    expect(overflow.whiteSpace, `the id may wrap at ${String(width)}px`).not.toBe("nowrap");
  }

  await expect(cell).not.toHaveAttribute("title", /opt_/u);

  await page.setViewportSize({ width: 1280, height: 800 });
});

test("the version preview renders the real control for the type", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("preview"), "Long text");
  await openPanel(page, "preview");

  const preview = page.locator(".qcms-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("textbox", { name: "E2E Long text question" })).toBeVisible();

  await expect(preview.locator("[name^=qcms_]")).toHaveCount(0);
});

test("a preview control accepts input, and nothing leaves the browser", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await createDraft(page, slugFor("interactive"), "Multiple choice");
  await openPanel(page, "preview");

  const preview = page.locator(".qcms-preview");
  const yes = preview.getByRole("checkbox", { name: "Yes, always", exact: true });
  const no = preview.getByRole("checkbox", { name: "No, never", exact: true });

  const tick = async (label: string): Promise<void> => {
    await preview.getByText(label, { exact: true }).click();
  };
  await expect(yes).not.toBeChecked();

  const requests: string[] = [];
  const record = (url: string): void => {
    if (url.includes("/_next/static/") || url.includes("/_next/image")) return;
    if (url.endsWith("/favicon.ico")) return;
    requests.push(url);
  };
  page.on("request", (request) => {
    record(request.url());
  });

  await tick("Yes, always");
  await expect(yes).toBeChecked();

  await tick("No, never");
  await expect(no).toBeChecked();
  await expect(yes).toBeChecked();

  expect(requests, "a preview interaction must issue no request").toEqual([]);

  // Saving is the request recorder's positive control; perform it after asserting preview interactions sent nothing.
  await openPanel(page, "content");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  expect(requests.length, "the request recorder sees traffic when traffic exists").toBeGreaterThan(
    0,
  );

  // The version switch can reconcile the same component; discard answers so one version's state cannot leak into another.
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2/);
  await openPanel(page, "preview");
  await expect(preview.getByRole("checkbox", { name: "Yes, always" })).not.toBeChecked();
});

test("errors from the API are readable, and land on the field that caused them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const alert = page.getByRole("main").getByRole("alert");

  await createDraft(page, slugFor("invalid"), "Short text");
  await openPanel(page, "constraints");
  await setNumericConstraint(page, "Shortest answer", "10");
  await setNumericConstraint(page, "Longest answer", "5");

  await expect(page.locator('[data-rail-panel="messages"]')).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(alert).toContainText("The engine rejected this draft");

  await expect(field(page, "Shortest answer")).toHaveAttribute("aria-invalid", "true");
  await expect(field(page, "Shortest answer")).toBeFocused();

  await page.goto("/questions/new");
  await fillStable(field(page, "Slug"), slugFor("invalid").replaceAll("-", "_"));
  await fillStable(field(page, "Label"), "Duplicate id");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(alert).toContainText("never reused");

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

  await fillStable(field(page, "Search"), `no-such-question-${RUN}`);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("No question matches this search.")).toBeVisible();

  await expect(page).toHaveURL(/[?&]q=no-such-question/);

  await page.getByRole("main").getByRole("link", { name: "Clear filters" }).click();
  await expect(page.getByRole("table", { name: "Question library" })).toBeVisible();
});

test("the type column and the type filter narrow the library (issue #218)", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto(`/questions?q=e2e-number-${RUN}`);
  const numberRow = page.getByRole("row").filter({ hasText: questionIdFor("number") });
  await expect(numberRow).toContainText("Number");

  await page.goto(`/questions?q=e2e-&type=date`);
  await expect(page.getByRole("row").filter({ hasText: questionIdFor("date") })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: questionIdFor("number") })).toHaveCount(0);

  await page.goto("/questions");
  const picker = page.getByRole("button", { name: /Type$/ });
  await picker.click();
  await page.getByRole("option", { name: "Yes or no", exact: true }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/[?&]type=boolean/);
  await expect(page.getByRole("row").filter({ hasText: questionIdFor("number") })).toHaveCount(0);
});

test("a row opens its question from the keyboard alone", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/questions?q=${slugFor("preview")}`);

  const link = page.getByRole("link", { name: `Open question ${questionIdFor("preview")}` });
  await expect(link).toBeVisible();

  // Tab through the real order: direct focus can reach a link that a keyboard cannot.
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

test("a frozen number version renders cleanly with its bounds saved", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await createDraft(page, slugFor("frozen-number"), "Number");
  await openPanel(page, "constraints");
  await setNumericConstraint(page, "Smallest value", "1");
  await setNumericConstraint(page, "Largest value", "10");

  await expect(page.locator('[data-rail-panel="messages"]')).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  await expect(field(page, "Smallest value")).toHaveValue("1");
  await expect(field(page, "Largest value")).toHaveValue("10");

  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  // Hard navigation exercises frozen-panel hydration; a client-side link alone cannot prove that path.
  await page.goto(`/questions/${questionIdFor("frozen-number")}?v=1&panel=constraints`);
  await expect(field(page, "Smallest value")).toHaveValue("1");
  await expect(field(page, "Smallest value")).toBeDisabled();
});

test("a frozen date version renders cleanly with its bounds saved", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await createDraft(page, slugFor("frozen-date"), "Date");
  await openPanel(page, "constraints");
  await fillDate(page, "Earliest date", "01012030");
  await fillDate(page, "Latest date", "12312030");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  await expect(page.getByRole("group", { name: "Earliest date" })).toContainText("01/01/2030");
  await expect(page.getByRole("group", { name: "Latest date" })).toContainText("31/12/2030");

  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await page.goto(`/questions/${questionIdFor("frozen-date")}?v=1&panel=constraints`);
  await expect(page.getByRole("group", { name: "Earliest date" })).toContainText("2030");
});

const TOO_SHORT = "Message when the answer is too short";

test("a validation message inherits until it is written, then round-trips (048)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("messages"), "Short text");
  await openPanel(page, "constraints");

  await expect(field(page, TOO_SHORT)).toHaveCount(0);
  await expect(page.locator('[data-rail-panel="messages"]')).toHaveCount(0);

  await setNumericConstraint(page, "Shortest answer", "8");
  await openPanel(page, "messages");
  await expect(field(page, TOO_SHORT)).toHaveAttribute(
    "placeholder",
    "Answer must be at least 8 characters",
  );
  await expect(field(page, TOO_SHORT)).toHaveValue("");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  await page.reload();
  await expect(field(page, TOO_SHORT)).toHaveValue("");
  await expect(field(page, TOO_SHORT)).toHaveAttribute(
    "placeholder",
    "Answer must be at least 8 characters",
  );

  const authored = "A policy number is 8 characters long.";
  await fillStable(field(page, TOO_SHORT), authored);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.reload();
  await expect(field(page, TOO_SHORT)).toHaveValue(authored);

  await openPanel(page, "constraints");
  await setNumericConstraint(page, "Shortest answer", "");
  await expect(field(page, TOO_SHORT)).toHaveCount(0);
  await expect(page.locator('[data-rail-panel="messages"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.reload();
  await setNumericConstraint(page, "Shortest answer", "8");
  await openPanel(page, "messages");
  await expect(field(page, TOO_SHORT)).toHaveValue("");
});

test("each boolean label overrides independently of the other (048, ADR-36)", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("bool-labels"), "Yes or no");
  await openPanel(page, "booleanLabels");

  const yes = field(page, "Label for the affirmative choice");
  const no = field(page, "Label for the negative choice");

  await expect(yes).toHaveAttribute("placeholder", "Yes");
  await expect(no).toHaveAttribute("placeholder", "No");
  await expect(yes).toHaveValue("");

  await fillStable(yes, "I was at fault");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.reload();
  await expect(field(page, "Label for the affirmative choice")).toHaveValue("I was at fault");
  await expect(field(page, "Label for the negative choice")).toHaveValue("");
  await expect(field(page, "Label for the negative choice")).toHaveAttribute("placeholder", "No");

  await openPanel(page, "preview");
  const preview = page.locator(".qcms-preview");
  await expect(preview.getByText("I was at fault", { exact: true })).toBeVisible();
  await expect(preview.getByText("No", { exact: true })).toBeVisible();
});

test("the type picker is locked once the question exists", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/questions/${questionIdFor("preview")}`);
  await expect(page.getByRole("button", { name: /Type$/ })).toHaveCount(0);

  await expect(page.getByTestId("qcms-question-rail")).toContainText("Long text (locked)");
  await expect(page.getByRole("main")).not.toContainText("Type is locked to");

  await page.goto("/questions/new");
  await chooseType(page, "Date");
});
