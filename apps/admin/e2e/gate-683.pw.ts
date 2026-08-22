import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { readSetupKey, submitSignIn, submitTotp } from "./support/flow.js";

/**
 * Screenshot evidence for issue 683's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-683.pw.ts
 * ```
 *
 * ## One frame per `test`, so a re-shoot can be one frame
 *
 * The shape issue 559's capture set: every frame is its own test named after the file it
 * writes, so `--grep copied-1280` re-shoots exactly that one rather than fifteen to replace
 * two.
 *
 * ## Why the post-copy and failed frames are the point of this set
 *
 * The idle frames show a button, which the acceptance criteria already state. What a reviewer
 * cannot check any other way is what the status line **says** once it has something to say,
 * and that it says something at all when the write does not happen. Those two are the whole
 * risk of this change: a copy control that fails silently leaves an operator believing they
 * hold the credential of last resort when they do not.
 *
 * Each frame enrolls its own admin, because the reveal is reachable exactly once per issued
 * set. The codes in the frames belong to throwaway accounts in the harness database, created
 * and abandoned inside the run.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-683";

/** Enroll a brand-new admin and stop on the one-time reveal. */
async function landOnTheReveal(page: Page, label: string): Promise<void> {
  const email = uniqueAdminEmail(label);
  await createTestAdmin(email);
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  await submitTotp(page, await readSetupKey(page));
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
}

async function shoot(page: Page, name: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await waitForHydration(page);
  await hideDevChrome(page);
  // A full-page PNG is sized to the DOCUMENT, so a screen that scrolls sideways produces a
  // file wider than the width in its own name and misdescribes itself to a reviewer who
  // cannot measure a PNG in a GitHub diff.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect
    .soft(scrollWidth, `the ${name} frame fits its ${String(width)}px viewport`)
    .toBeLessThanOrEqual(width);
  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true, caret: "initial" });
}

/** The reveal as it arrives: the codes, the copy control, and an empty status line. */
async function idle(page: Page, name: string, width: number, label: string): Promise<void> {
  await landOnTheReveal(page, label);
  await expect(page.getByRole("button", { name: "Copy codes" })).toBeVisible();
  await expect(page.getByTestId("qcms-recovery-copy-status")).toHaveText("");
  await shoot(page, name, width);
}

/** The state a reviewer cannot otherwise check: the status line after a successful copy. */
async function copied(page: Page, name: string, width: number, label: string): Promise<void> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await landOnTheReveal(page, label);
  await page.getByRole("button", { name: "Copy codes" }).click();
  await expect(page.getByTestId("qcms-recovery-copy-status")).toHaveText("Codes copied.");
  await shoot(page, name, width);
}

/** The other half of the deliverable: what the operator is told when the write cannot happen. */
async function failed(page: Page, name: string, width: number, label: string): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => undefined });
  });
  await landOnTheReveal(page, label);
  await page.getByRole("button", { name: "Copy codes" }).click();
  await expect(page.getByTestId("qcms-recovery-copy-status")).toHaveText(
    "Could not copy automatically. Select the codes above and copy manually.",
  );
  await shoot(page, name, width);
}

test("reveal-390", async ({ page }) => {
  test.setTimeout(180_000);
  await idle(page, "reveal-390", 390, "g683a");
});

test("reveal-1280", async ({ page }) => {
  test.setTimeout(180_000);
  await idle(page, "reveal-1280", 1280, "g683b");
});

test("copied-390", async ({ page }) => {
  test.setTimeout(180_000);
  await copied(page, "copied-390", 390, "g683c");
});

test("copied-1280", async ({ page }) => {
  test.setTimeout(180_000);
  await copied(page, "copied-1280", 1280, "g683d");
});

test("failed-390", async ({ page }) => {
  test.setTimeout(180_000);
  await failed(page, "failed-390", 390, "g683e");
});

test("failed-1280", async ({ page }) => {
  test.setTimeout(180_000);
  await failed(page, "failed-1280", 1280, "g683f");
});
