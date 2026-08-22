import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, captureInto } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addOption, createDraft, openRowMenuByPointer } from "./support/questions.js";

/**
 * Screenshot evidence for issue 680's design gate: the option grid's row menu carrying the
 * single-pointer, non-dragging reorder path.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-680.pw.ts
 * ```
 *
 * ## What the reviewer is being asked to judge
 *
 * > **Can you tell, from the menu alone, which way this row can move?**
 *
 * The two new items are the whole of WCAG 2.2 SC 2.5.7 Dragging Movements for this grid,
 * and they are ordinary tap targets rather than a gesture. What a frame can show and a test
 * cannot is whether their DISABLED state reads as unavailable rather than as broken, which
 * matters more here than it did on the pin list: the option grid's dead item used to be
 * Remove, at the foot of the menu, and now a dead item sits in the MIDDLE of the list on
 * every first and last row.
 *
 * So there is a frame of each arrangement: all five live on a middle row, Move up dead at
 * position three of five on the first row, and a one-option grid where three of the five
 * are dead at once.
 *
 * ## One frame per `test`, so a re-shoot can be one frame
 *
 * The shape issue 559's gate set. Each test writes one state at both required widths
 * (`captureInto` shoots 390 and 1280), so `--grep menu-first` re-shoots exactly that state
 * and nothing else. The fixture question is built once in `beforeAll` on a page of its own.
 *
 * ## Every frame asserts its own caption before the shutter
 *
 * A frame captioned "Move up dimmed" that photographed a live control is worse than no
 * frame at all, so each test asserts the disabled/enabled state it is about to claim, and
 * the menu's visibility, before it shoots.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate680");
const capture = captureInto("docs/gates/pr-680");
const RUN = Date.now().toString(36).slice(-5);

/** Set by `beforeAll`: the shared sign-in and the question the frames are shot against. */
let totpSecret = "";
let questionId = "";

/** The three option labels the fixture question carries, in the order they are drawn. */
const FIRST = "Yes, always";
const MIDDLE = "No, never";
const LAST = "Maybe later";

function item(page: Page, label: string): Locator {
  return page.getByRole("menuitem", { name: label, exact: true });
}

/** Sign in and land on the fixture question's editor, with its option grid drawn. */
async function openEditor(page: Page): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/questions/${questionId}`);
  await expect(page.locator(".qcms-opt-grid")).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  // Question ids are never reused (R6) and the harness database outlives a run, so the
  // slug carries a per-run suffix or the second local run fails on QUESTION_ID_REUSED.
  await createDraft(page, `gate680-options-${RUN}`, "Single choice");
  await addOption(page, LAST);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  questionId = new URL(page.url()).pathname.split("/")[2] ?? "";
  expect(questionId).toMatch(/^q_/);
  await page.close();
});

/** A middle row: both moves live, in the order all three POCs draw them. */
test("menu-middle", async ({ page }) => {
  test.setTimeout(300_000);
  await openEditor(page);
  await openRowMenuByPointer(page, 1);
  await expect(item(page, `Move ${MIDDLE} up`)).toBeEnabled();
  await expect(item(page, `Move ${MIDDLE} down`)).toBeEnabled();
  await capture(page, "menu-middle");
});

/** The first row: Move up dead, at position three of five, with two live items after it. */
test("menu-first", async ({ page }) => {
  test.setTimeout(300_000);
  await openEditor(page);
  await openRowMenuByPointer(page, 0);
  await expect(item(page, `Move ${FIRST} up`)).toBeDisabled();
  await expect(item(page, `Move ${FIRST} down`)).toBeEnabled();
  await expect(item(page, `Remove option ${FIRST}`)).toBeEnabled();
  await capture(page, "menu-first");
});

/** A one-option grid: neither move exists, and neither does Remove. */
test("menu-single", async ({ page }) => {
  test.setTimeout(300_000);
  await openEditor(page);
  // Down to one option through the same pointer path an author would use, which is also
  // what makes the frame a state the app can actually be in rather than a mock.
  const lastMenu = await openRowMenuByPointer(page, 2);
  await lastMenu.getByRole("menuitem", { name: `Remove option ${LAST}`, exact: true }).click();
  const middleMenu = await openRowMenuByPointer(page, 1);
  await middleMenu.getByRole("menuitem", { name: `Remove option ${MIDDLE}`, exact: true }).click();
  await expect(page.locator("[data-option-index]")).toHaveCount(1);

  await openRowMenuByPointer(page, 0);
  await expect(item(page, `Move ${FIRST} up`)).toBeDisabled();
  await expect(item(page, `Move ${FIRST} down`)).toBeDisabled();
  await expect(item(page, `Remove option ${FIRST}`)).toBeDisabled();
  await capture(page, "menu-single");
});
