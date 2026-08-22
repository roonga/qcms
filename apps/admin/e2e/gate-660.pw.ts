import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addStep, createForm, openStep, pickerChoice, waitForSaved } from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/**
 * Screenshot evidence for issue 660's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-660.pw.ts
 * ```
 *
 * ## One frame per `test`, so a re-shoot can be one frame
 *
 * The shape issue 559's gate set: every frame is its own test named after the file it
 * writes, so `--grep chosen-1280` re-shoots exactly that one. The fixture is built once in
 * the first test, which is what lets a single-frame run still have a form to point at.
 *
 * ## What the Code Owner is being asked to approve
 *
 * The dialog is the multi-select variant of
 * `plan/admin-shell-poc/add-question-poc.html`, which is a two-dialog POC: a strict
 * one-at-a-time variant and this one, behind a variant toggle. The frames are paired
 * deliberately - an EMPTY selection and a THREE-question selection at each width - because
 * the change this issue makes is only visible in the second of each pair: the running
 * tally, the pins it names, and a primary button whose label carries the count.
 *
 * The 390 pair is the one that shows the layout decision. The POC's multi variant is a
 * two-pane master-detail with the chosen list beside a paginated list; this dialog is one
 * column at every width the admin supports, so the pane sits under the table rather than
 * beside it.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-660";
const EMAIL = uniqueAdminEmail("gate660");
const RUN = Date.now().toString(36).slice(-5);

const ALPHA = `g660-cover-${RUN}`;
const BETA = `g660-count-${RUN}`;
const GAMMA = `g660-notes-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

/** Set by the fixture test, which the frames sign in with and navigate to. */
let totpSecret = "";
let builderPath = "";

/**
 * Open the picker on the fixture form at `width`, optionally with three versions chosen.
 *
 * The viewport is set BEFORE the navigation rather than after it, which is issue 575's
 * lesson: loading at the target width cannot sample a mid-reflow frame.
 */
async function capture(page: Page, name: string, width: number, chosen: boolean): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(builderPath);
  await openStep(page, "Only step");
  await waitForHydration(page);
  await hideDevChrome(page);

  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  if (chosen) {
    await pickerChoice(dialog, questionIdFor(GAMMA), 1).check();
    await pickerChoice(dialog, questionIdFor(ALPHA), 2).check();
    await pickerChoice(dialog, questionIdFor(BETA), 1).check();
    await expect(dialog.getByTestId("qcms-picker-chosen")).toContainText("Chosen (3)");
    await expect(dialog.getByRole("button", { name: "Add 3 questions to step" })).toBeEnabled();
    // The last tick leaves a focus ring on a checkbox, which is chrome the reviewer is not
    // being asked about. Blurring is the whole of the cleanup: nothing else moved.
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
  } else {
    await expect(dialog.getByTestId("qcms-picker-chosen")).toContainText("Chosen (0)");
  }

  // A full-page PNG is sized to the DOCUMENT, so a screen that scrolls sideways produces a
  // file wider than the width in its own name and misdescribes itself to a reviewer who
  // cannot measure a PNG in a GitHub diff.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect
    .soft(scrollWidth, `the ${name} frame fits its ${String(width)}px viewport`)
    .toBeLessThanOrEqual(width);

  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true, caret: "initial" });
}

test("builds the fixture the frames are shot against", async ({ page }) => {
  test.setTimeout(600_000);
  await createTestAdmin(EMAIL);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  // ALPHA is published twice, so the frames show a question whose two versions are
  // separate rows: choosing one of them withdraws the other, which is the rule the
  // chosen-state frames are also evidence for.
  await createDraft(page, ALPHA, "Single choice");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2$/);
  await confirmLifecycle(page, /^Publish version 2$/, "Publish");

  await createDraft(page, BETA, "Number");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, GAMMA, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await createForm(page, `gate660-${RUN}`, "Vehicle insurance");
  builderPath = new URL(page.url()).pathname;
  await addStep(page, "Only step");
  await waitForSaved(page);
});

/** The dialog as it opens: the chosen pane already present, the primary not yet pressable. */
test("picker-390", async ({ page }) => {
  await capture(page, "picker-390", 390, false);
});

/** THE CHANGE, at the narrow width: the tally, the named pins, "Add 3 questions to step". */
test("picker-chosen-390", async ({ page }) => {
  await capture(page, "picker-chosen-390", 390, true);
});

/** The dialog as it opens, at the Code Owner's standing wide width. */
test("picker-1280", async ({ page }) => {
  await capture(page, "picker-1280", 1280, false);
});

/** THE CHANGE, at the wide width, including the withdrawn sibling version's State cell. */
test("picker-chosen-1280", async ({ page }) => {
  await capture(page, "picker-chosen-1280", 1280, true);
});
